#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Subject-level split, calibration and ONE-SHOT test evaluation for the
ST-GCN ASD screening model (AIMBRACE / ASDr).

The model (OpenPose BODY_25 -> ST-GCN, Typical=0 / ASD=1) is a reference-only
screening aid, never a diagnosis.

Subcommands
-----------
split      Stratified SUBJECT-level train/val/test split         -> splits.json
calibrate  Fit temperature T (NLL) + choose thresholds on VAL      -> calibration.json
evaluate   Apply a frozen calibration to TEST predictions, ONCE    -> test_results.json

Workflow (details and caveats: research_src/EVALUATION.md)::

    python research_src/calibrate_evaluate.py split --root DATA --output splits.json
    python research_src/predict_dataset.py --checkpoint CKPT --splits splits.json --output preds.csv
    python research_src/calibrate_evaluate.py calibrate --predictions preds.csv \
        --checkpoint CKPT --output calibration.json
    python research_src/calibrate_evaluate.py evaluate --predictions preds.csv \
        --calibration calibration.json --output test_results.json

Conventions
-----------
* A sample is one recording (one walking video); a subject is one child.
  No subject may appear in two splits.
* Sample probability: p_asd = softmax(logits / T)[ASD]. Subject score: the MEAN
  calibrated p_asd over the subject's samples.
* A subject is flagged ASD when score >= threshold. Thresholds are chosen among
  the observed validation subject scores.
* Risk tiers: LOW < threshold <= MEDIUM < high_risk_threshold <= HIGH.

All maths is pure numpy (no scipy / sklearn), so results are identical on the
local machine (numpy 2.x) and on the GPU server (numpy 1.24).
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import random
import re
import sys
import warnings
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

import numpy as np


SPLIT_NAMES: Tuple[str, str, str] = ("train", "val", "test")
LABEL_NAMES: Dict[int, str] = {0: "Typical", 1: "ASD"}
DEFAULT_RATIOS: Tuple[float, float, float] = (0.6, 0.2, 0.2)
DEFAULT_SEED = 42

# Default subject regex. It is matched (re.search) against the sample path
# RELATIVE TO ITS CLASS FOLDER, "/"-separated, with the file extension removed;
# for flat class folders that is simply the file / directory name. The first
# capture group is the subject id. Default: the first path component.
#   "video_12.xlsx"             -> "video_12"  (Dataset_video: one video per child)
#   "12/video/3_2d.xlsx"        -> "12"        (nested layout: first folder = subject)
#   "136/keypoints_body25.json" -> "136"       (API storage layout)
#   "S01_walk2.xlsx"            -> "S01_walk2" (several videos per child? then pass
#                                               e.g. --subject-regex '^([^_]+)_')
DEFAULT_SUBJECT_REGEX = r"^([^/]+)"

API_KEYPOINTS_JSON = "keypoints_body25.json"
OPENPOSE_FRAME_SUFFIX = "_keypoints.json"

TEMPERATURE_BOUNDS: Tuple[float, float] = (0.05, 20.0)
ECE_BINS = 10
TIERS: Tuple[str, str, str] = ("LOW", "MEDIUM", "HIGH")
METRIC_KEYS: Tuple[str, ...] = (
    "auc",
    "sensitivity",
    "specificity",
    "ppv",
    "npv",
    "f1",
    "accuracy",
    "brier",
    "ece",
)

_LABEL_ALIASES = {"0": 0, "1": 1, "typical": 0, "asd": 1, "autism": 1}


class EvaluationWarning(UserWarning):
    """Non-fatal data or metric problem (e.g. AUC undefined for a single class)."""


class LeakageError(ValueError):
    """Test subjects overlap with the subjects used for calibration (val)."""


def _warn(msg: str) -> None:
    warnings.warn(msg, EvaluationWarning, stacklevel=2)


# =========================
# Small utilities
# =========================


def now_iso() -> str:
    """Local time with UTC offset, e.g. 2026-10-05T10:12:33+07:00."""
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def sha256_file(path: Path, chunk_size: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(chunk_size), b""):
            h.update(block)
    return h.hexdigest()


def _json_default(obj):
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        return float(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, Path):
        return obj.as_posix()
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def write_json(path: Path, obj: Mapping) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False, default=_json_default)
        f.write("\n")


def read_json(path: Path) -> dict:
    with Path(path).open("r", encoding="utf-8") as f:
        return json.load(f)


def parse_label(value) -> int:
    """0/1 or Typical/ASD/Autism (case-insensitive) -> 0/1."""
    if isinstance(value, (bool, np.bool_)):
        raise ValueError(f"Unrecognised label {value!r}; expected 0/1 or Typical/ASD/Autism")
    if isinstance(value, (int, np.integer)) and int(value) in (0, 1):
        return int(value)
    text = str(value).strip().lower()
    if text in _LABEL_ALIASES:
        return _LABEL_ALIASES[text]
    try:
        num = float(text)
    except ValueError:
        num = None
    if num is not None and num in (0.0, 1.0):
        return int(num)
    raise ValueError(f"Unrecognised label {value!r}; expected 0/1 or Typical/ASD/Autism")


def label_from_class_folder(name: str) -> Optional[int]:
    """'Autism'/'ASD...' -> 1, '...typical...' -> 0, otherwise (or both) None."""
    low = name.lower()
    is_asd = ("autism" in low) or ("asd" in low)
    is_typical = "typical" in low
    if is_asd == is_typical:
        return None
    return 1 if is_asd else 0


def compile_subject_regex(pattern: str) -> "re.Pattern[str]":
    rx = re.compile(pattern)
    if rx.groups < 1:
        raise ValueError(f"--subject-regex {pattern!r} needs a capture group (the subject id)")
    return rx


def extract_subject_id(name: str, regex) -> str:
    rx = compile_subject_regex(regex) if isinstance(regex, str) else regex
    m = rx.search(name)
    if m is None or not m.group(1):
        raise ValueError(f"--subject-regex {rx.pattern!r} captured no subject id from {name!r}")
    return m.group(1)


def subject_match_name(rel_path: str, is_file: bool) -> str:
    """String the subject regex is matched against: the "/"-separated path
    relative to the class folder, without the file extension."""
    if is_file:
        suffix = Path(rel_path).suffix
        if suffix:
            return rel_path[: -len(suffix)]
    return rel_path


def _resolve_path(path_str: str, base_dir: Path) -> Path:
    p = Path(path_str).expanduser()
    if not p.is_absolute():
        p = base_dir / p
    return p.resolve()


def _fmt(x, nd: int = 3) -> str:
    return "n/a" if x is None else f"{x:.{nd}f}"


# =========================
# Metrics (pure numpy)
# =========================


def _as_1d_float(x) -> np.ndarray:
    arr = np.asarray(x, dtype=np.float64).reshape(-1)
    if not np.all(np.isfinite(arr)):
        raise ValueError("scores/probabilities must be finite")
    return arr


def _as_1d_label(y) -> np.ndarray:
    arr = np.asarray(y).reshape(-1).astype(np.int64)
    if arr.size and not np.all((arr == 0) | (arr == 1)):
        raise ValueError("labels must be 0 (Typical) or 1 (ASD)")
    return arr


def _safe_div(num: float, den: float) -> Optional[float]:
    return None if den == 0 else float(num) / float(den)


def average_ranks(x) -> np.ndarray:
    """1-based ranks; tied values get the mean of their ranks (like scipy.stats.rankdata)."""
    arr = _as_1d_float(x)
    if arr.size == 0:
        return arr.copy()
    _, inverse, counts = np.unique(arr, return_inverse=True, return_counts=True)
    inverse = np.asarray(inverse).reshape(-1)
    last_rank = np.cumsum(counts).astype(np.float64)
    mean_rank = last_rank - (counts - 1) / 2.0
    return mean_rank[inverse]


def roc_auc(y_true, scores, warn: bool = True) -> Optional[float]:
    """ROC AUC via the Mann-Whitney U statistic (average ranks for ties).

    Equals P(score_pos > score_neg) + 0.5 * P(score_pos == score_neg).
    Returns None (with a warning) when only one class is present.
    """
    y = _as_1d_label(y_true)
    s = _as_1d_float(scores)
    if y.shape != s.shape:
        raise ValueError(f"y_true and scores differ in length ({y.size} vs {s.size})")
    n_pos = int(y.sum())
    n_neg = int(y.size - n_pos)
    if n_pos == 0 or n_neg == 0:
        if warn:
            _warn(f"AUC undefined: only one class present (n_pos={n_pos}, n_neg={n_neg})")
        return None
    ranks = average_ranks(s)
    u_stat = float(ranks[y == 1].sum()) - n_pos * (n_pos + 1) / 2.0
    return u_stat / (n_pos * n_neg)


def expected_calibration_error(y_true, p, n_bins: int = ECE_BINS) -> Optional[float]:
    """ECE of the positive-class probability with equal-width bins on [0, 1].

    ECE = sum_b (n_b / n) * |mean(y in b) - mean(p in b)|, bins
    [k/n_bins, (k+1)/n_bins), the last bin also contains 1.0.
    """
    y = _as_1d_label(y_true)
    prob = _as_1d_float(p)
    if y.shape != prob.shape:
        raise ValueError(f"y_true and p differ in length ({y.size} vs {prob.size})")
    if y.size == 0:
        return None
    if np.any((prob < 0.0) | (prob > 1.0)):
        raise ValueError("probabilities must lie in [0, 1]")
    idx = np.minimum((prob * n_bins).astype(np.int64), n_bins - 1)
    ece = 0.0
    for b in range(n_bins):
        mask = idx == b
        n_b = int(mask.sum())
        if n_b:
            ece += n_b / y.size * abs(float(y[mask].mean()) - float(prob[mask].mean()))
    return float(ece)


def confusion_counts(y_true, p, threshold: float) -> Dict[str, int]:
    y = _as_1d_label(y_true)
    prob = _as_1d_float(p)
    pred = prob >= float(threshold)
    return {
        "tp": int(np.sum(pred & (y == 1))),
        "fp": int(np.sum(pred & (y == 0))),
        "tn": int(np.sum(~pred & (y == 0))),
        "fn": int(np.sum(~pred & (y == 1))),
    }


def binary_metrics(
    y_true,
    p,
    threshold: float,
    n_bins: int = ECE_BINS,
    warn: bool = True,
) -> Dict[str, Optional[float]]:
    """Metrics at `threshold` (positive = ASD when p >= threshold).

    Undefined ratios (zero denominator) are None; AUC is None for one class.
    """
    y = _as_1d_label(y_true)
    prob = _as_1d_float(p)
    if y.shape != prob.shape:
        raise ValueError(f"y_true and p differ in length ({y.size} vs {prob.size})")
    c = confusion_counts(y, prob, threshold)
    tp, fp, tn, fn = c["tp"], c["fp"], c["tn"], c["fn"]
    n = int(y.size)
    return {
        "auc": roc_auc(y, prob, warn=warn) if n else None,
        "sensitivity": _safe_div(tp, tp + fn),
        "specificity": _safe_div(tn, tn + fp),
        "ppv": _safe_div(tp, tp + fp),
        "npv": _safe_div(tn, tn + fn),
        "f1": _safe_div(2 * tp, 2 * tp + fp + fn),
        "accuracy": _safe_div(tp + tn, n),
        "brier": float(np.mean((prob - y) ** 2)) if n else None,
        "ece": expected_calibration_error(y, prob, n_bins) if n else None,
        "n_subjects": n,
        "n_pos": int(tp + fn),
        "n_neg": int(tn + fp),
    }


def confusion_matrix_dict(y_true, p, threshold: float) -> Dict[str, object]:
    c = confusion_counts(y_true, p, threshold)
    return {
        **c,
        "matrix": [[c["tn"], c["fp"]], [c["fn"], c["tp"]]],
        "layout": "rows = true label (0=Typical, 1=ASD), cols = predicted label",
    }


# =========================
# Temperature scaling
# =========================


def _logit_margin(logits) -> np.ndarray:
    z = np.asarray(logits, dtype=np.float64)
    if z.ndim != 2 or z.shape[1] != 2:
        raise ValueError(f"logits must have shape (n, 2) = [logit_typical, logit_asd], got {z.shape}")
    if not np.all(np.isfinite(z)):
        raise ValueError("logits must be finite")
    return z[:, 1] - z[:, 0]


def _sigmoid(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x, dtype=np.float64)
    out = np.empty_like(x)
    pos = x >= 0
    out[pos] = 1.0 / (1.0 + np.exp(-x[pos]))
    ex = np.exp(x[~pos])
    out[~pos] = ex / (1.0 + ex)
    return out


def _check_temperature(temperature: float) -> float:
    t = float(temperature)
    if not math.isfinite(t) or t <= 0:
        raise ValueError(f"temperature must be > 0, got {temperature!r}")
    return t


def calibrated_p_asd(logits, temperature: float) -> np.ndarray:
    """softmax(logits / T)[:, ASD]; for two classes == sigmoid((z_asd - z_typical) / T)."""
    t = _check_temperature(temperature)
    return _sigmoid(_logit_margin(logits) / t)


def nll_binary(logits, labels, temperature: float) -> float:
    """Mean sample-level negative log-likelihood of softmax(logits / T)."""
    t = _check_temperature(temperature)
    d = _logit_margin(logits) / t
    y = _as_1d_label(labels)
    if y.shape != d.shape:
        raise ValueError(f"labels and logits differ in length ({y.size} vs {d.size})")
    # -log p(y): softplus(-d) for y=1, softplus(d) for y=0 (numerically stable).
    return float(np.mean(np.logaddexp(0.0, np.where(y == 1, -d, d))))


def fit_temperature(
    logits,
    labels,
    bounds: Tuple[float, float] = TEMPERATURE_BOUNDS,
    grid_size: int = 241,
    tol: float = 1e-7,
) -> float:
    """Temperature T minimising the sample-level NLL, searched on log T in `bounds`.

    NLL is convex in 1/T, hence unimodal in log T: a coarse log-grid brackets
    the minimum and golden-section search refines it. Returns 1.0 when the
    logits carry no information (flat objective). A result on a bound means
    the optimum lies outside the search range (e.g. perfectly separable data).
    """
    _logit_margin(logits)  # validates the shape early
    lo, hi = math.log(bounds[0]), math.log(bounds[1])
    if not lo < hi:
        raise ValueError(f"invalid temperature bounds {bounds}")

    def objective(u: float) -> float:
        return nll_binary(logits, labels, math.exp(u))

    grid = np.linspace(lo, hi, int(grid_size))
    values = np.array([objective(float(u)) for u in grid])
    if float(values.max() - values.min()) < 1e-12:
        return 1.0
    k = int(np.argmin(values))
    a = float(grid[max(k - 1, 0)])
    b = float(grid[min(k + 1, len(grid) - 1)])

    inv_phi = (math.sqrt(5.0) - 1.0) / 2.0
    c = b - inv_phi * (b - a)
    d = a + inv_phi * (b - a)
    fc, fd = objective(c), objective(d)
    while b - a > tol:
        if fc <= fd:
            b, d, fd = d, c, fc
            c = b - inv_phi * (b - a)
            fc = objective(c)
        else:
            a, c, fc = c, d, fd
            d = a + inv_phi * (b - a)
            fd = objective(d)
    u_best = 0.5 * (a + b)
    if objective(u_best) > float(values[k]):
        u_best = float(grid[k])
    return float(math.exp(u_best))


# =========================
# Thresholds and risk tiers
# =========================


def _check_both_classes(y: np.ndarray, what: str) -> Tuple[int, int]:
    n_pos = int(y.sum())
    n_neg = int(y.size - n_pos)
    if n_pos == 0 or n_neg == 0:
        raise ValueError(f"{what} needs both classes (got n_pos={n_pos}, n_neg={n_neg})")
    return n_pos, n_neg


def select_threshold_youden(y_true, p) -> float:
    """Observed score maximising Youden's J = sens + spec - 1 (tie -> higher sensitivity)."""
    y = _as_1d_label(y_true)
    prob = _as_1d_float(p)
    n_pos, n_neg = _check_both_classes(y, "Youden's J")
    best_t, best_key = None, None
    for t in np.unique(prob):
        pred = prob >= t
        tp = int(np.sum(pred & (y == 1)))
        tn = int(np.sum(~pred & (y == 0)))
        # J = tp/n_pos + tn/n_neg - 1, compared exactly in integers; tie -> more TPs.
        key = (tp * n_neg + tn * n_pos, tp)
        if best_key is None or key > best_key:
            best_key, best_t = key, float(t)
    return float(best_t)


def select_threshold_for_sensitivity(y_true, p, target: float) -> float:
    """Largest observed score whose sensitivity is still >= target."""
    if not 0.0 < float(target) <= 1.0:
        raise ValueError(f"target sensitivity must be in (0, 1], got {target}")
    y = _as_1d_label(y_true)
    prob = _as_1d_float(p)
    n_pos = int(y.sum())
    if n_pos == 0:
        raise ValueError("sensitivity strategy needs at least one ASD subject")
    best = None
    for t in np.unique(prob):  # ascending; sensitivity is non-increasing
        tp = int(np.sum((prob >= t) & (y == 1)))
        if tp / n_pos >= float(target) - 1e-12:
            best = float(t)
    return float(best)


def select_high_risk_threshold(
    y_true,
    p,
    threshold: float,
    min_specificity: float,
) -> Tuple[float, bool]:
    """Smallest observed score >= threshold with specificity >= min_specificity.

    Returns (threshold, False) when no observed score reaches the target.
    """
    if not 0.0 < float(min_specificity) <= 1.0:
        raise ValueError(f"min specificity must be in (0, 1], got {min_specificity}")
    y = _as_1d_label(y_true)
    prob = _as_1d_float(p)
    n_neg = int(np.sum(y == 0))
    if n_neg == 0:
        return float(threshold), False
    for t in np.unique(prob):  # ascending; specificity is non-decreasing
        if t < threshold:
            continue
        tn = int(np.sum((prob < t) & (y == 0)))
        if tn / n_neg >= float(min_specificity) - 1e-12:
            return float(t), True
    return float(threshold), False


def risk_tier(p: float, threshold: float, high_risk_threshold: float) -> str:
    """LOW < threshold <= MEDIUM < high_risk_threshold <= HIGH."""
    if p >= high_risk_threshold:
        return "HIGH"
    if p >= threshold:
        return "MEDIUM"
    return "LOW"


def risk_tier_counts(y_true, p, threshold: float, high_risk_threshold: float) -> Dict[str, Dict[str, int]]:
    y = _as_1d_label(y_true)
    prob = _as_1d_float(p)
    out = {LABEL_NAMES[c]: {t: 0 for t in TIERS} for c in (0, 1)}
    for yi, pi in zip(y, prob):
        out[LABEL_NAMES[int(yi)]][risk_tier(float(pi), threshold, high_risk_threshold)] += 1
    return out


# =========================
# Subject aggregation, bootstrap, leakage
# =========================


def aggregate_by_subject(
    subject_ids: Sequence[str],
    labels,
    p,
) -> Tuple[List[str], np.ndarray, np.ndarray, np.ndarray]:
    """Mean p per subject -> (sorted ids, labels, mean p, n samples per subject)."""
    y = _as_1d_label(labels)
    prob = _as_1d_float(p)
    if not len(subject_ids) == y.size == prob.size:
        raise ValueError("subject_ids, labels and p must have the same length")
    sums: Dict[str, float] = {}
    counts: Dict[str, int] = {}
    label_of: Dict[str, int] = {}
    for sid, yi, pi in zip(subject_ids, y, prob):
        if sid in label_of and label_of[sid] != int(yi):
            raise ValueError(f"subject {sid!r} has samples with both labels")
        label_of[sid] = int(yi)
        sums[sid] = sums.get(sid, 0.0) + float(pi)
        counts[sid] = counts.get(sid, 0) + 1
    ids = sorted(label_of)
    return (
        ids,
        np.array([label_of[s] for s in ids], dtype=np.int64),
        np.array([sums[s] / counts[s] for s in ids], dtype=np.float64),
        np.array([counts[s] for s in ids], dtype=np.int64),
    )


def bootstrap_cis(
    y_true,
    p,
    threshold: float,
    n_boot: int = 2000,
    seed: int = DEFAULT_SEED,
    alpha: float = 0.05,
    n_bins: int = ECE_BINS,
    min_valid_fraction: float = 0.5,
) -> Dict[str, Dict[str, Optional[float]]]:
    """Percentile bootstrap CIs at the subject level.

    Subjects are resampled with replacement WITHIN each class (stratified, as
    in pROC's default), so class counts stay fixed. numpy's legacy RandomState
    is used on purpose: its stream is frozen across numpy versions, so a seed
    gives the same CIs on numpy 1.24 and 2.x. A CI is None when fewer than
    `min_valid_fraction` of the resamples define the metric.
    """
    y = _as_1d_label(y_true)
    prob = _as_1d_float(p)
    if y.size == 0:
        raise ValueError("bootstrap needs at least one subject")
    rs = np.random.RandomState(int(seed))
    groups = [g for g in (np.flatnonzero(y == 1), np.flatnonzero(y == 0)) if g.size]
    values: Dict[str, List[float]] = {k: [] for k in METRIC_KEYS}
    for _ in range(int(n_boot)):
        idx = np.concatenate([g[rs.randint(0, g.size, size=g.size, dtype=np.int64)] for g in groups])
        m = binary_metrics(y[idx], prob[idx], threshold, n_bins=n_bins, warn=False)
        for k in METRIC_KEYS:
            if m[k] is not None:
                values[k].append(float(m[k]))
    out: Dict[str, Dict[str, Optional[float]]] = {}
    for k in METRIC_KEYS:
        v = np.asarray(values[k], dtype=np.float64)
        if v.size == 0 or v.size < min_valid_fraction * int(n_boot):
            out[k] = {"low": None, "high": None, "n_valid": int(v.size)}
        else:
            lo, hi = np.percentile(v, [100.0 * alpha / 2.0, 100.0 * (1.0 - alpha / 2.0)])
            out[k] = {"low": float(lo), "high": float(hi), "n_valid": int(v.size)}
    return out


def check_no_leakage(test_subjects: Iterable[str], val_subjects: Iterable[str]) -> None:
    """Raise LeakageError if a test subject was used for calibration."""
    overlap = sorted(set(test_subjects) & set(val_subjects))
    if overlap:
        shown = ", ".join(overlap[:10]) + (" ..." if len(overlap) > 10 else "")
        raise LeakageError(
            f"{len(overlap)} test subject(s) were used for calibration (val_subjects in "
            f"calibration.json): {shown}. Evaluate on held-out test subjects only."
        )


# =========================
# Split
# =========================


def normalize_ratios(ratios: Sequence[float]) -> Tuple[float, float, float]:
    r = [float(x) for x in ratios]
    if len(r) != 3 or any((not math.isfinite(x)) or x < 0 for x in r) or sum(r) <= 0:
        raise ValueError(f"ratios must be 3 non-negative numbers (train val test), got {list(ratios)}")
    total = sum(r)
    return (r[0] / total, r[1] / total, r[2] / total)


def allocate_counts(n: int, ratios: Sequence[float]) -> List[int]:
    """Largest-remainder allocation of n subjects to the splits.

    Every split with a positive ratio receives at least one subject when n allows.
    """
    r = np.asarray(normalize_ratios(ratios), dtype=np.float64)
    raw = n * r
    counts = np.floor(raw + 1e-9).astype(np.int64)
    remainder = int(n - counts.sum())
    order = sorted(
        (i for i in range(len(r)) if r[i] > 0),
        key=lambda i: (-(raw[i] - counts[i]), i),
    )
    for i in order[:remainder]:
        counts[i] += 1
    positive = [i for i in range(len(r)) if r[i] > 0]
    if n >= len(positive):
        for i in positive:
            if counts[i] == 0:
                donor = max(positive, key=lambda j: (counts[j], -j))
                counts[donor] -= 1
                counts[i] += 1
    return [int(c) for c in counts]


def subject_labels(samples: Sequence[Mapping]) -> Dict[str, int]:
    """subject_id -> label; raises if a subject carries both labels."""
    out: Dict[str, int] = {}
    mixed: List[str] = []
    for s in samples:
        sid, lab = str(s["subject_id"]), int(s["label"])
        if sid in out and out[sid] != lab:
            mixed.append(sid)
        out.setdefault(sid, lab)
    if mixed:
        raise ValueError(f"subject(s) with both labels: {sorted(set(mixed))[:10]}")
    return out


def stratified_subject_split(
    labels_by_subject: Mapping[str, int],
    ratios: Sequence[float] = DEFAULT_RATIOS,
    seed: int = DEFAULT_SEED,
) -> Dict[str, List[str]]:
    """Shuffle each class's subjects (sorted first, so input order is irrelevant)
    and cut them by `ratios` into train/val/test."""
    rng = random.Random(int(seed))
    out: Dict[str, List[str]] = {name: [] for name in SPLIT_NAMES}
    for label in (0, 1):
        subs = sorted(s for s, lab in labels_by_subject.items() if int(lab) == label)
        rng.shuffle(subs)
        start = 0
        for name, cnt in zip(SPLIT_NAMES, allocate_counts(len(subs), ratios)):
            out[name].extend(subs[start : start + cnt])
            start += cnt
    for name in SPLIT_NAMES:
        out[name].sort()
    return out


def read_manifest(path: Path) -> List[Dict[str, object]]:
    """Manifest CSV with columns path,subject_id,label (+ optional split).

    Relative paths are resolved against the manifest's own folder.
    """
    path = Path(path)
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fields = [(c or "").strip() for c in (reader.fieldnames or [])]
        missing = {"path", "subject_id", "label"} - set(fields)
        if missing:
            raise ValueError(f"{path}: manifest is missing column(s) {sorted(missing)}")
        rows: List[Dict[str, object]] = []
        for lineno, raw in enumerate(reader, start=2):
            row = {(k or "").strip(): (v or "").strip() for k, v in raw.items()}
            if not row.get("path") or not row.get("subject_id"):
                raise ValueError(f"{path}:{lineno}: empty path or subject_id")
            try:
                label = parse_label(row["label"])
            except ValueError as e:
                raise ValueError(f"{path}:{lineno}: {e}") from None
            split = row.get("split", "").lower()
            if split and split not in SPLIT_NAMES:
                raise ValueError(f"{path}:{lineno}: unknown split {row['split']!r}")
            rows.append(
                {
                    "path": _resolve_path(str(row["path"]), path.parent).as_posix(),
                    "subject_id": str(row["subject_id"]),
                    "label": label,
                    "split": split,
                }
            )
    if not rows:
        raise ValueError(f"{path}: manifest has no rows")
    return rows


def discover_class_samples(class_dir: Path) -> List[Path]:
    """Samples under one class folder: *.xlsx files, API keypoints_body25.json
    files, and directories that directly contain raw OpenPose *_keypoints.json
    frames. A frame directory next to a keypoints_body25.json (API storage
    layout <id>/{keypoints_body25.json, openpose_json/}) is the same recording
    and is skipped."""
    found: List[Path] = []
    for p in sorted(class_dir.rglob("*")):
        if p.is_file():
            if p.name.startswith("~$"):
                continue  # Excel lock files
            if p.suffix.lower() == ".xlsx" or p.name == API_KEYPOINTS_JSON:
                found.append(p)
        elif p.is_dir():
            has_frames = any(
                f.is_file() and f.name.endswith(OPENPOSE_FRAME_SUFFIX) for f in p.iterdir()
            )
            if has_frames and not (p.parent / API_KEYPOINTS_JSON).is_file():
                found.append(p)
    return found


def scan_root(root: Path, subject_regex: str = DEFAULT_SUBJECT_REGEX) -> Tuple[List[Dict[str, object]], Dict]:
    """Scan <root>/<ClassFolder>/... ; class from the folder name.

    subject_id = "<ClassFolder>/<first capture group of subject_regex>", the
    regex being applied to subject_match_name() of the sample (path relative to
    the class folder, extension removed). The class prefix keeps e.g.
    Autism/video_1 and Typical/video_1 apart.
    """
    root = Path(root)
    if not root.is_dir():
        raise FileNotFoundError(f"--root is not a directory: {root}")
    rx = compile_subject_regex(subject_regex)
    samples: List[Dict[str, object]] = []
    info: Dict[str, object] = {"class_folders": {}, "ignored_folders": []}
    for class_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        label = label_from_class_folder(class_dir.name)
        if label is None:
            info["ignored_folders"].append(class_dir.name)
            continue
        found = discover_class_samples(class_dir)
        info["class_folders"][class_dir.name] = {"label": label, "n_samples": len(found)}
        for p in found:
            rel = p.relative_to(class_dir).as_posix()
            match_name = subject_match_name(rel, p.is_file())
            samples.append(
                {
                    "path": p.resolve().as_posix(),
                    "subject_id": f"{class_dir.name}/{extract_subject_id(match_name, rx)}",
                    "label": label,
                    "rel": f"{class_dir.name}/{match_name}",
                }
            )
    if not info["class_folders"]:
        raise ValueError(
            f"No class folders under {root} (folder names must contain 'autism'/'asd' or 'typical')"
        )
    if not samples:
        raise ValueError(f"No samples (*.xlsx, {API_KEYPOINTS_JSON}, OpenPose frame dirs) under {root}")
    return samples, info


def describe_grouping(samples: Sequence[Mapping], max_examples: int = 8) -> List[str]:
    lines: List[str] = []
    by_label: Dict[int, Dict[str, List[Mapping]]] = {0: {}, 1: {}}
    for s in samples:
        by_label[int(s["label"])].setdefault(str(s["subject_id"]), []).append(s)
    for label in (1, 0):
        subs = by_label[label]
        if not subs:
            lines.append(f"  {LABEL_NAMES[label]:<8}: 0 samples")
            continue
        sizes = sorted(len(v) for v in subs.values())
        lines.append(
            f"  {LABEL_NAMES[label]:<8}: {sum(sizes)} samples from {len(subs)} subjects "
            f"(samples/subject: min {sizes[0]}, median {float(np.median(sizes)):g}, max {sizes[-1]})"
        )
    lines.append("  examples (sample -> subject_id):")
    per_class = max(1, max_examples // 2)
    for label in (1, 0):
        shown = [s for s in samples if int(s["label"]) == label][:per_class]
        for s in shown:
            lines.append(f"    {s.get('rel', s['path'])} -> {s['subject_id']}")
    return lines


def grouping_warnings(samples: Sequence[Mapping]) -> Tuple[List[str], List[str]]:
    """(warnings, notes) about a suspicious subject grouping."""
    warns: List[str] = []
    notes: List[str] = []
    for label in (1, 0):
        sizes: Dict[str, int] = {}
        for s in samples:
            if int(s["label"]) == label:
                sizes[str(s["subject_id"])] = sizes.get(str(s["subject_id"]), 0) + 1
        name = LABEL_NAMES[label]
        n_subjects, n_samples = len(sizes), sum(sizes.values())
        if n_subjects == 0:
            warns.append(f"no {name} samples at all")
            continue
        if n_subjects < 5:
            warns.append(f"only {n_subjects} {name} subject(s); splits and metrics will be very unstable")
        if n_samples > 1 and n_subjects == n_samples:
            notes.append(
                f"every {name} sample is its own subject; if a child has several recordings, they must "
                "share one subject_id (--subject-regex with --root, or the manifest's subject_id column)"
            )
        top_sid, top_n = max(sizes.items(), key=lambda kv: kv[1])
        if n_subjects >= 3 and top_n > 0.5 * n_samples:
            warns.append(
                f"subject {top_sid!r} holds {top_n}/{n_samples} {name} samples; check --subject-regex"
            )
    return warns, notes


def validate_splits(doc: Mapping) -> List[str]:
    """Raise on subject overlap / inconsistent samples; return warnings
    (e.g. a split that lacks a class)."""
    subjects = doc["subjects"]
    owner: Dict[str, str] = {}
    for name in SPLIT_NAMES:
        for sid in subjects.get(name, []):
            if sid in owner:
                raise ValueError(f"subject {sid!r} is in both {owner[sid]!r} and {name!r} splits")
            owner[sid] = name
    present: Dict[str, set] = {name: set() for name in SPLIT_NAMES}
    for s in doc["samples"]:
        sid, split = str(s["subject_id"]), str(s["split"])
        if owner.get(sid) != split:
            raise ValueError(f"sample {s['path']!r}: split {split!r} != split of its subject {sid!r}")
        present[split].add(int(s["label"]))
    warns: List[str] = []
    for name in SPLIT_NAMES:
        for label in (0, 1):
            if label not in present[name]:
                warns.append(f"split {name!r} has no {LABEL_NAMES[label]} subject")
    return warns


def make_splits(
    samples: Sequence[Mapping],
    ratios: Sequence[float] = DEFAULT_RATIOS,
    seed: int = DEFAULT_SEED,
    source: Optional[Mapping] = None,
) -> Dict[str, object]:
    ratios_n = normalize_ratios(ratios)
    seen: Dict[str, Tuple[str, int]] = {}
    unique: List[Mapping] = []
    for s in samples:
        key = str(s["path"])
        val = (str(s["subject_id"]), int(s["label"]))
        if key in seen:
            if seen[key] != val:
                raise ValueError(f"path listed twice with different subject/label: {key}")
            _warn(f"duplicate sample ignored: {key}")
            continue
        seen[key] = val
        unique.append(s)
    if not unique:
        raise ValueError("no samples to split")
    labels_of = subject_labels(unique)
    assignment = stratified_subject_split(labels_of, ratios_n, seed)
    split_of = {sid: name for name, subs in assignment.items() for sid in subs}
    out_samples = sorted(
        (
            {
                "path": str(s["path"]),
                "subject_id": str(s["subject_id"]),
                "label": int(s["label"]),
                "split": split_of[str(s["subject_id"])],
            }
            for s in unique
        ),
        key=lambda r: r["path"],
    )
    counts = {
        name: {
            "subjects": {
                LABEL_NAMES[c]: sum(1 for sid in assignment[name] if labels_of[sid] == c) for c in (1, 0)
            },
            "samples": {
                LABEL_NAMES[c]: sum(1 for x in out_samples if x["split"] == name and x["label"] == c)
                for c in (1, 0)
            },
        }
        for name in SPLIT_NAMES
    }
    doc: Dict[str, object] = {
        "version": 1,
        "seed": int(seed),
        "ratios": dict(zip(SPLIT_NAMES, ratios_n)),
        "created_at": now_iso(),
        "source": dict(source or {}),
        "subjects": assignment,
        "samples": out_samples,
        "counts": counts,
    }
    for w in validate_splits(doc):
        _warn(w)
    return doc


def load_splits(path: Path) -> Dict[str, object]:
    """Read + validate splits.json; relative sample paths are resolved against
    the folder of splits.json."""
    path = Path(path)
    doc = read_json(path)
    for key in ("subjects", "samples"):
        if key not in doc:
            raise ValueError(f"{path}: not a splits.json (missing {key!r})")
    samples = []
    for s in doc["samples"]:
        split = str(s["split"]).lower()
        if split not in SPLIT_NAMES:
            raise ValueError(f"{path}: unknown split {s['split']!r}")
        samples.append(
            {
                "path": _resolve_path(str(s["path"]), path.parent).as_posix(),
                "subject_id": str(s["subject_id"]),
                "label": parse_label(s["label"]),
                "split": split,
            }
        )
    doc = dict(doc)
    doc["samples"] = samples
    for w in validate_splits(doc):
        _warn(w)
    return doc


def run_split(
    output: Optional[Path],
    manifest: Optional[Path] = None,
    root: Optional[Path] = None,
    subject_regex: str = DEFAULT_SUBJECT_REGEX,
    ratios: Sequence[float] = DEFAULT_RATIOS,
    seed: int = DEFAULT_SEED,
    verbose: bool = True,
) -> Dict[str, object]:
    if (manifest is None) == (root is None):
        raise ValueError("give exactly one of --manifest or --root")
    if any(float(r) <= 0 for r in ratios):
        raise ValueError(f"all three split ratios must be > 0, got {list(ratios)}")
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always", EvaluationWarning)
        if manifest is not None:
            samples = read_manifest(Path(manifest))
            source: Dict[str, object] = {"manifest": Path(manifest).resolve().as_posix()}
            header = [f"Manifest {manifest}: {len(samples)} samples"]
        else:
            samples, info = scan_root(Path(root), subject_regex)
            source = {"root": Path(root).resolve().as_posix(), "subject_regex": subject_regex}
            header = [f"Scanned {root}: {len(samples)} samples"]
            for name, ci in info["class_folders"].items():
                header.append(
                    f"  class folder {name!r} -> label {ci['label']} ({LABEL_NAMES[ci['label']]}): "
                    f"{ci['n_samples']} samples"
                )
            if info["ignored_folders"]:
                header.append(f"  ignored folders (no class keyword): {info['ignored_folders']}")
            header.append(
                f"  subject regex: {subject_regex!r} (searched in the path relative to the class folder, "
                "extension removed; shown below)"
            )
        warns, notes = grouping_warnings(samples)
        for w in warns:
            _warn(w)
        doc = make_splits(samples, ratios, seed, source)
    messages = [str(w.message) for w in caught if issubclass(w.category, EvaluationWarning)]
    doc["warnings"] = messages
    if verbose:
        for line in header + ["Subject grouping:"] + describe_grouping(samples):
            print(line)
        for n in notes:
            print(f"NOTE: {n}")
        for m in messages:
            print(f"WARNING: {m}", file=sys.stderr)
        r = doc["ratios"]
        print(f"Split (seed {doc['seed']}, ratios {r['train']:.2f}/{r['val']:.2f}/{r['test']:.2f}):")
        for name in SPLIT_NAMES:
            c = doc["counts"][name]
            n_sub = sum(c["subjects"].values())
            n_smp = sum(c["samples"].values())
            print(
                f"  {name:<5}: {n_sub:3d} subjects (ASD {c['subjects']['ASD']} / Typical "
                f"{c['subjects']['Typical']}), {n_smp} samples"
            )
    if output is not None:
        write_json(Path(output), doc)
        if verbose:
            print(f"Wrote {output}")
    return doc


# =========================
# Predictions CSV
# =========================


@dataclass
class PredictionSet:
    subject_ids: List[str]
    labels: np.ndarray
    logits: np.ndarray  # (n, 2) = [logit_typical, logit_asd]
    info: Dict[str, object] = field(default_factory=dict)


def predictions_meta_path(csv_path: Path) -> Path:
    """Sidecar written by predict_dataset.py: <predictions.csv>.meta.json."""
    return Path(str(csv_path) + ".meta.json")


def read_predictions_meta(csv_path: Path) -> Optional[dict]:
    meta = predictions_meta_path(csv_path)
    return read_json(meta) if meta.is_file() else None


def load_predictions(csv_path: Path, split: str, all_rows: bool = False) -> PredictionSet:
    """Rows of a predictions CSV (subject_id,label,logit_typical,logit_asd[,path,split,error]).

    With a `split` column only rows of `split` are used unless all_rows=True.
    Rows with a non-empty `error` or non-finite logits are skipped (warning).
    """
    csv_path = Path(csv_path)
    with csv_path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fields = [(c or "").strip() for c in (reader.fieldnames or [])]
        missing = {"subject_id", "label", "logit_typical", "logit_asd"} - set(fields)
        if missing:
            raise ValueError(f"{csv_path}: missing column(s) {sorted(missing)}")
        rows = [{(k or "").strip(): (v or "").strip() for k, v in r.items()} for r in reader]

    has_split = "split" in fields
    if has_split and not all_rows:
        rows = [r for r in rows if r.get("split", "").lower() == split]
        rows_used = f"split=={split}"
        if not rows:
            raise ValueError(f"{csv_path}: no rows with split == {split!r} (use --all-rows to use every row)")
    elif has_split:
        rows_used = "all_rows"
        _warn(f"--all-rows: using every row of {csv_path.name}, whatever its split")
    else:
        rows_used = "all (no split column)"
        _warn(f"{csv_path.name} has no 'split' column: assuming every row is {split} data")

    subject_ids: List[str] = []
    labels: List[int] = []
    logits: List[Tuple[float, float]] = []
    n_error = n_invalid = 0
    for i, r in enumerate(rows):
        if r.get("error"):
            n_error += 1
            continue
        try:
            z = (float(r["logit_typical"]), float(r["logit_asd"]))
        except ValueError:
            z = (math.nan, math.nan)
        if not (math.isfinite(z[0]) and math.isfinite(z[1])):
            n_invalid += 1
            continue
        if not r["subject_id"]:
            raise ValueError(f"{csv_path}: empty subject_id in a {split} row ({r.get('path', i)})")
        subject_ids.append(r["subject_id"])
        labels.append(parse_label(r["label"]))
        logits.append(z)
    if n_error:
        _warn(f"skipped {n_error} row(s) with a prediction error in {csv_path.name}")
    if n_invalid:
        _warn(f"skipped {n_invalid} row(s) with missing/non-finite logits in {csv_path.name}")
    if not subject_ids:
        raise ValueError(f"{csv_path}: no usable {split} rows")
    info = {
        "predictions_csv": csv_path.resolve().as_posix(),
        "rows_used": rows_used,
        "n_samples": len(subject_ids),
        "n_skipped_error": n_error,
        "n_skipped_invalid": n_invalid,
    }
    return PredictionSet(
        subject_ids=subject_ids,
        labels=np.asarray(labels, dtype=np.int64),
        logits=np.asarray(logits, dtype=np.float64).reshape(-1, 2),
        info=info,
    )


# =========================
# Calibrate
# =========================


def run_calibrate(
    predictions: Path,
    output: Optional[Path],
    checkpoint: Optional[Path] = None,
    all_rows: bool = False,
    threshold_strategy: str = "youden",
    target_sensitivity: float = 0.9,
    high_risk_specificity: float = 0.95,
    verbose: bool = True,
) -> Dict[str, object]:
    """Fit T and thresholds on VALIDATION predictions -> calibration.json."""
    if threshold_strategy not in ("youden", "sensitivity"):
        raise ValueError(f"unknown threshold strategy {threshold_strategy!r}")
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always", EvaluationWarning)
        ps = load_predictions(Path(predictions), "val", all_rows=all_rows)

        # Checkpoint identity: --checkpoint, cross-checked with predict_dataset's sidecar.
        meta = read_predictions_meta(Path(predictions))
        meta_sha = (meta or {}).get("checkpoint_sha256")
        if checkpoint is not None:
            ckpt_sha: Optional[str] = sha256_file(Path(checkpoint))
            sha_source: Optional[str] = "--checkpoint"
            if meta_sha and meta_sha != ckpt_sha:
                raise ValueError(
                    f"{predictions} was produced by a different checkpoint "
                    f"(sha256 {meta_sha[:12]}...) than --checkpoint ({ckpt_sha[:12]}...)"
                )
        elif meta_sha:
            ckpt_sha, sha_source = str(meta_sha), "predictions_meta"
        else:
            ckpt_sha, sha_source = None, None
            _warn(
                "checkpoint_sha256 is null (no --checkpoint, no predictions meta): the ML server cannot tell "
                "which checkpoint this calibration belongs to and would apply it to ANY checkpoint; "
                "pass --checkpoint"
            )

        temperature = fit_temperature(ps.logits, ps.labels)
        if temperature <= TEMPERATURE_BOUNDS[0] * 1.001 or temperature >= TEMPERATURE_BOUNDS[1] * 0.999:
            _warn(f"temperature {temperature:.4g} is at the search bound {TEMPERATURE_BOUNDS}")
        p_sample = calibrated_p_asd(ps.logits, temperature)
        val_ids, y, p_subj, _ = aggregate_by_subject(ps.subject_ids, ps.labels, p_sample)
        _check_both_classes(y, "threshold calibration on val subjects")
        if y.size < 10:
            _warn(f"only {y.size} validation subjects: thresholds will be very noisy")

        if threshold_strategy == "youden":
            threshold = select_threshold_youden(y, p_subj)
            thr_method = "youden_j"
        else:
            threshold = select_threshold_for_sensitivity(y, p_subj, target_sensitivity)
            thr_method = f"sensitivity>={target_sensitivity:g}"
        high, achieved = select_high_risk_threshold(y, p_subj, threshold, high_risk_specificity)
        if not achieved:
            _warn(
                f"no val threshold >= {threshold:.4f} reaches specificity >= {high_risk_specificity:g}; "
                "high_risk_threshold = threshold"
            )

        suffix = "allrows" if ps.info["rows_used"] == "all_rows" else "val"
        val_metrics = binary_metrics(y, p_subj, threshold)
        sample_metrics = binary_metrics(ps.labels, p_sample, threshold)
        sample_metrics["n_samples"] = sample_metrics.pop("n_subjects")
        doc: Dict[str, object] = {
            "version": 1,
            "created_at": now_iso(),
            "checkpoint_sha256": ckpt_sha,
            "temperature": float(temperature),
            "threshold": float(threshold),
            "high_risk_threshold": float(high),
            "high_risk_threshold_achieved": bool(achieved),
            "method": {
                "temperature": f"nll_{suffix}",
                "threshold": f"{thr_method}_{suffix}",
                "high_risk": f"specificity>={high_risk_specificity:g}_{suffix}",
            },
            "aggregation": "subject_mean",
            "val_subjects": list(val_ids),
            "val_metrics": val_metrics,
            "checkpoint_sha256_source": sha_source,
            "decision_rule": "ASD flag if mean calibrated p_asd >= threshold; "
            "tiers LOW < threshold <= MEDIUM < high_risk_threshold <= HIGH",
            "temperature_fit": {
                "objective": "sample-level NLL of softmax(logits / T)",
                "bounds": list(TEMPERATURE_BOUNDS),
                "nll_t1": nll_binary(ps.logits, ps.labels, 1.0),
                "nll_calibrated": nll_binary(ps.logits, ps.labels, temperature),
            },
            "val_metrics_sample_level": sample_metrics,
            "data": ps.info,
        }
    messages = [str(w.message) for w in caught if issubclass(w.category, EvaluationWarning)]
    doc["warnings"] = messages
    if verbose:
        for m in messages:
            print(f"WARNING: {m}", file=sys.stderr)
        _print_calibration_summary(doc)
    if output is not None:
        write_json(Path(output), doc)
        if verbose:
            print(f"Wrote {output}")
    return doc


def _metrics_line(m: Mapping) -> str:
    return (
        f"AUC {_fmt(m['auc'])} | sens {_fmt(m['sensitivity'])} | spec {_fmt(m['specificity'])} | "
        f"PPV {_fmt(m['ppv'])} | NPV {_fmt(m['npv'])} | F1 {_fmt(m['f1'])} | acc {_fmt(m['accuracy'])} | "
        f"Brier {_fmt(m['brier'])} | ECE {_fmt(m['ece'])}"
    )


def _print_calibration_summary(doc: Mapping) -> None:
    m, fit, data = doc["val_metrics"], doc["temperature_fit"], doc["data"]
    print("Calibration (validation, subject-level)")
    print(
        f"  rows used: {data['rows_used']} | {data['n_samples']} samples from {m['n_subjects']} subjects "
        f"(ASD {m['n_pos']} / Typical {m['n_neg']})"
    )
    print(f"  temperature T = {doc['temperature']:.4f} (NLL {fit['nll_t1']:.4f} at T=1 -> {fit['nll_calibrated']:.4f})")
    print(
        f"  threshold = {doc['threshold']:.4f} ({doc['method']['threshold']}) | high_risk_threshold = "
        f"{doc['high_risk_threshold']:.4f} ({doc['method']['high_risk']}, "
        f"{'achieved' if doc['high_risk_threshold_achieved'] else 'NOT achieved'})"
    )
    print(f"  val @ threshold: {_metrics_line(m)}")
    sha = doc["checkpoint_sha256"]
    print(f"  checkpoint_sha256: {sha if sha else 'null'}")


# =========================
# Evaluate (test, ONCE)
# =========================


def load_calibration(path: Path) -> Dict[str, object]:
    cal = read_json(Path(path))
    for key in ("temperature", "threshold", "high_risk_threshold", "val_subjects"):
        if key not in cal:
            raise ValueError(f"{path}: not a calibration.json (missing {key!r})")
    _check_temperature(cal["temperature"])
    if float(cal["high_risk_threshold"]) < float(cal["threshold"]):
        raise ValueError(f"{path}: high_risk_threshold < threshold")
    return cal


def run_evaluate(
    predictions: Path,
    calibration: Path,
    output: Optional[Path],
    all_rows: bool = False,
    n_bootstrap: int = 2000,
    seed: int = DEFAULT_SEED,
    checkpoint: Optional[Path] = None,
    verbose: bool = True,
) -> Dict[str, object]:
    """Apply a FROZEN calibration.json to TEST predictions.

    The test set must be evaluated ONCE, after every model, preprocessing,
    temperature and threshold choice has been frozen on train/val. Looking at
    these numbers and then going back to change something turns the test set
    into a second validation set; the result is then no longer an unbiased
    estimate and must be reported as such (or a fresh test set collected).
    """
    cal = load_calibration(Path(calibration))
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always", EvaluationWarning)
        ps = load_predictions(Path(predictions), "test", all_rows=all_rows)
        check_no_leakage(ps.subject_ids, [str(s) for s in cal["val_subjects"]])

        cal_sha = cal.get("checkpoint_sha256")
        meta_sha = (read_predictions_meta(Path(predictions)) or {}).get("checkpoint_sha256")
        if cal_sha and meta_sha and cal_sha != meta_sha:
            raise ValueError(
                f"{predictions} was produced by checkpoint {meta_sha[:12]}..., but calibration.json "
                f"belongs to {cal_sha[:12]}..."
            )
        if checkpoint is not None:
            ckpt_sha = sha256_file(Path(checkpoint))
            if cal_sha and ckpt_sha != cal_sha:
                raise ValueError(f"--checkpoint sha256 {ckpt_sha[:12]}... != calibration.json {cal_sha[:12]}...")

        temperature = float(cal["temperature"])
        threshold = float(cal["threshold"])
        high = float(cal["high_risk_threshold"])
        p_sample = calibrated_p_asd(ps.logits, temperature)
        ids, y, p_subj, n_per = aggregate_by_subject(ps.subject_ids, ps.labels, p_sample)
        if y.size < 10:
            _warn(f"only {y.size} test subjects: confidence intervals will be very wide")
        metrics = binary_metrics(y, p_subj, threshold)
        cis = bootstrap_cis(y, p_subj, threshold, n_boot=n_bootstrap, seed=seed)
        sample_metrics = binary_metrics(ps.labels, p_sample, threshold, warn=False)
        sample_metrics["n_samples"] = sample_metrics.pop("n_subjects")
        doc: Dict[str, object] = {
            "version": 1,
            "created_at": now_iso(),
            "note": "Test set evaluated ONCE with a frozen calibration. Subject-level metrics "
            "(mean calibrated p_asd per subject). Reference-only screening tool, not a diagnosis.",
            "calibration_path": Path(calibration).resolve().as_posix(),
            "calibration": cal,
            "checkpoint_sha256": cal_sha,
            "temperature": temperature,
            "threshold": threshold,
            "high_risk_threshold": high,
            "aggregation": "subject_mean",
            "n_subjects": int(y.size),
            "n_pos": int(y.sum()),
            "n_neg": int(y.size - y.sum()),
            "n_samples": int(ps.info["n_samples"]),
            "metrics": metrics,
            "confusion_matrix": confusion_matrix_dict(y, p_subj, threshold),
            "risk_tiers": risk_tier_counts(y, p_subj, threshold, high),
            "ci_95": cis,
            "bootstrap": {
                "n": int(n_bootstrap),
                "seed": int(seed),
                "method": "percentile; subjects resampled with replacement within each class",
            },
            "sample_level_metrics": sample_metrics,
            "sample_level_note": "reference only: samples of one subject are correlated",
            "per_subject": [
                {
                    "subject_id": sid,
                    "label": int(yi),
                    "p_asd": float(pi),
                    "n_samples": int(ni),
                    "predicted": int(pi >= threshold),
                    "tier": risk_tier(float(pi), threshold, high),
                }
                for sid, yi, pi, ni in zip(ids, y, p_subj, n_per)
            ],
            "data": ps.info,
        }
    messages = [str(w.message) for w in caught if issubclass(w.category, EvaluationWarning)]
    doc["warnings"] = messages
    if verbose:
        for m in messages:
            print(f"WARNING: {m}", file=sys.stderr)
        _print_test_summary(doc)
    if output is not None:
        write_json(Path(output), doc)
        if verbose:
            print(f"Wrote {output}")
    return doc


def _print_test_summary(doc: Mapping) -> None:
    m, ci = doc["metrics"], doc["ci_95"]
    print("TEST evaluation (subject-level, evaluate ONCE)")
    print(
        f"  rows used: {doc['data']['rows_used']} | {doc['n_samples']} samples from {doc['n_subjects']} "
        f"subjects (ASD {doc['n_pos']} / Typical {doc['n_neg']})"
    )
    print(
        f"  T = {doc['temperature']:.4f} | threshold = {doc['threshold']:.4f} | "
        f"high_risk_threshold = {doc['high_risk_threshold']:.4f}"
    )
    b = doc["bootstrap"]
    print(f"  {'metric':<12} {'value':>7}   95% CI (bootstrap n={b['n']}, seed={b['seed']})")
    for k in METRIC_KEYS:
        lo, hi = ci[k]["low"], ci[k]["high"]
        ci_txt = "n/a" if lo is None else f"[{lo:.3f}, {hi:.3f}]"
        print(f"  {k:<12} {_fmt(m[k]):>7}   {ci_txt}")
    c = doc["confusion_matrix"]
    print(f"  confusion (rows=true, cols=pred): [[TN {c['tn']}, FP {c['fp']}], [FN {c['fn']}, TP {c['tp']}]]")
    print(f"  {'risk tiers':<12} {'LOW':>5} {'MEDIUM':>7} {'HIGH':>5}")
    for name in ("Typical", "ASD"):
        t = doc["risk_tiers"][name]
        print(f"    {name:<10} {t['LOW']:>5} {t['MEDIUM']:>7} {t['HIGH']:>5}")


# =========================
# CLI
# =========================


def _format_warning(message, category, filename, lineno, line=None) -> str:
    return f"WARNING: {message}\n"


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description="Subject-level split, calibration and one-shot test evaluation for the ST-GCN ASD screener.",
    )
    sub = ap.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("split", help="stratified subject-level train/val/test split -> splits.json")
    src = sp.add_mutually_exclusive_group(required=True)
    src.add_argument("--manifest", type=Path, help="CSV with columns path,subject_id,label")
    src.add_argument(
        "--root",
        type=Path,
        help="scan <root>/<ClassFolder>/... ('autism'/'asd' in the folder name -> ASD, 'typical' -> Typical)",
    )
    sp.add_argument(
        "--subject-regex",
        default=DEFAULT_SUBJECT_REGEX,
        help="(--root) regex searched in the sample path relative to its class folder ('/'-separated, "
        f"extension removed); first group = subject id. Default {DEFAULT_SUBJECT_REGEX!r} = first path "
        "component, e.g. 'video_12.xlsx' -> 'video_12', '12/video/3_2d.xlsx' -> '12'",
    )
    sp.add_argument("--ratios", type=float, nargs=3, default=list(DEFAULT_RATIOS), metavar=("TRAIN", "VAL", "TEST"))
    sp.add_argument("--seed", type=int, default=DEFAULT_SEED)
    sp.add_argument("--output", type=Path, default=Path("splits.json"))
    sp.add_argument("--dry-run", action="store_true", help="print the grouping/split summary without writing")

    cp = sub.add_parser("calibrate", help="fit temperature + thresholds on VAL predictions -> calibration.json")
    cp.add_argument("--predictions", type=Path, required=True, help="predictions CSV (predict_dataset.py)")
    cp.add_argument("--checkpoint", type=Path, default=None, help="checkpoint file, for checkpoint_sha256")
    cp.add_argument("--output", type=Path, default=Path("calibration.json"))
    cp.add_argument("--all-rows", action="store_true", help="use every row even if a split column exists")
    cp.add_argument("--threshold-strategy", choices=["youden", "sensitivity"], default="youden")
    cp.add_argument("--target-sensitivity", type=float, default=0.9)
    cp.add_argument("--high-risk-specificity", type=float, default=0.95)

    ep = sub.add_parser("evaluate", help="apply calibration.json to TEST predictions, ONCE -> test_results.json")
    ep.add_argument("--predictions", type=Path, required=True)
    ep.add_argument("--calibration", type=Path, required=True)
    ep.add_argument("--output", type=Path, default=Path("test_results.json"))
    ep.add_argument("--all-rows", action="store_true", help="use every row even if a split column exists")
    ep.add_argument("--n-bootstrap", type=int, default=2000)
    ep.add_argument("--seed", type=int, default=DEFAULT_SEED)
    ep.add_argument("--checkpoint", type=Path, default=None, help="optional: verify sha256 against calibration.json")
    ep.add_argument(
        "--force",
        action="store_true",
        help="overwrite an existing output (the test set should be evaluated only once)",
    )
    return ap


def main(argv: Optional[Sequence[str]] = None) -> int:
    warnings.formatwarning = _format_warning
    args = build_parser().parse_args(argv)
    try:
        if args.cmd == "split":
            run_split(
                output=None if args.dry_run else args.output,
                manifest=args.manifest,
                root=args.root,
                subject_regex=args.subject_regex,
                ratios=args.ratios,
                seed=args.seed,
            )
        elif args.cmd == "calibrate":
            run_calibrate(
                predictions=args.predictions,
                output=args.output,
                checkpoint=args.checkpoint,
                all_rows=args.all_rows,
                threshold_strategy=args.threshold_strategy,
                target_sensitivity=args.target_sensitivity,
                high_risk_specificity=args.high_risk_specificity,
            )
        elif args.cmd == "evaluate":
            if args.output.exists() and not args.force:
                raise ValueError(
                    f"{args.output} already exists. The test set should be evaluated ONCE; pass --force "
                    "only if you really re-evaluate (and report that the test set was re-used)."
                )
            run_evaluate(
                predictions=args.predictions,
                calibration=args.calibration,
                output=args.output,
                all_rows=args.all_rows,
                n_bootstrap=args.n_bootstrap,
                seed=args.seed,
                checkpoint=args.checkpoint,
            )
    except LeakageError as e:
        print(f"ERROR (leakage): {e}", file=sys.stderr)
        return 2
    except (ValueError, FileNotFoundError, KeyError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
