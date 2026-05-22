#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Unified pipeline: OpenPose JSON -> Excel export, and ST-GCN prediction on Excel.

This file merges logic from:
- sub_phase/tools/openpose_json_to_excel.py
- sub_phase/tools/stgcn18_predict_openpose_excel.py

It supports two subcommands:

1) Export OpenPose JSON(s) to Excel

    python3 sub_phase/tools/openpose_excel_stgcn_pipeline.py to-excel \
      --input /path/to/openpose_frames/ \
      --output sub_phase/exports/sample.xlsx \
      --format wide

2) Predict ASD/Typical from Excel exports using a trained ST-GCN checkpoint

    python3 sub_phase/tools/openpose_excel_stgcn_pipeline.py predict \
      --checkpoint /path/to/best_model.pth \
      --input sub_phase/exports_excels \
      --output sub_phase/exports/preds.csv

3) Predict directly from OpenPose JSON frames (no Excel intermediate)

        python3 sub_phase/tools/openpose_excel_stgcn_pipeline.py json-predict \
            --checkpoint /path/to/best_model.pth \
            --input /path/to/openpose_frames_or_root \
            --output sub_phase/exports/preds.csv \
            --recursive

Backwards-compatible wrappers remain in the original two files.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np


# Reduce noisy TensorFlow/XLA logs if TensorFlow gets pulled indirectly.
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

# Allow running from anywhere while importing repo-local modules.
_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


# =========================
# Part A: JSON -> Excel
# =========================

DEFAULT_REMOVE_KP_17 = [15, 16, 17, 18, 20, 21, 23, 24]


@dataclass(frozen=True)
class FrameKeypoints:
    frame_index: int
    keypoints: np.ndarray  # (J, 3) -> x,y,score


def _natural_key(p: Path) -> Tuple:
    parts = re.split(r"(\d+)", p.name)
    key: List[object] = []
    for part in parts:
        if part.isdigit():
            key.append(int(part))
        else:
            key.append(part)
    return tuple(key)


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _extract_pose_keypoints_2d(obj: dict) -> List[List[float]]:
    people = obj.get("people") or []
    out: List[List[float]] = []
    for person in people:
        arr = person.get("pose_keypoints_2d")
        if isinstance(arr, list) and len(arr) >= 3:
            out.append(arr)
    return out


def _score_person(pose_kp: List[float]) -> float:
    a = np.asarray(pose_kp, dtype=np.float32)
    if a.size % 3 != 0:
        return float("-inf")
    conf = a.reshape(-1, 3)[:, 2]
    if conf.size == 0:
        return float("-inf")
    return float(np.nanmean(conf))


def _select_person(people_kps: List[List[float]], strategy: str) -> Optional[List[float]]:
    if not people_kps:
        return None
    if strategy == "first":
        return people_kps[0]
    if strategy == "best_score":
        return max(people_kps, key=_score_person)
    raise ValueError(f"Unknown person selection strategy: {strategy}")


def _to_j3(pose_kp: Sequence[float]) -> np.ndarray:
    a = np.asarray(pose_kp, dtype=np.float32)
    if a.size % 3 != 0:
        raise ValueError(f"pose_keypoints_2d length must be multiple of 3, got {a.size}")
    return a.reshape(-1, 3)


def _apply_remove_indices(j3: np.ndarray, remove: Sequence[int]) -> np.ndarray:
    if not remove:
        return j3
    J = j3.shape[0]
    remove_set = {i for i in remove if 0 <= i < J}
    keep = [i for i in range(J) if i not in remove_set]
    return j3[keep]


def read_sequence_from_path(
    path: Path,
    *,
    person_select: str,
    remove_kp: Sequence[int],
    max_frames: Optional[int] = None,
) -> List[FrameKeypoints]:
    if path.is_file():
        files = [path]
    else:
        files = sorted([p for p in path.iterdir() if p.suffix.lower() == ".json"], key=_natural_key)

    if max_frames is not None:
        files = files[: max_frames]

    frames: List[FrameKeypoints] = []
    for i, fp in enumerate(files):
        obj = _load_json(fp)
        people = _extract_pose_keypoints_2d(obj)
        sel = _select_person(people, person_select)
        if sel is None:
            continue
        j3 = _to_j3(sel)
        j3 = _apply_remove_indices(j3, remove_kp)
        frames.append(FrameKeypoints(frame_index=i, keypoints=j3))
    return frames


def discover_sample_dirs(root: Path, recursive: bool) -> List[Path]:
    if root.is_file():
        return [root]

    if not recursive:
        return [root]

    sample_dirs: List[Path] = []
    for d in sorted([p for p in root.rglob("*") if p.is_dir()]):
        if any(f.suffix.lower() == ".json" for f in d.iterdir()):
            sample_dirs.append(d)

    if any(f.suffix.lower() == ".json" for f in root.iterdir()):
        sample_dirs.insert(0, root)

    seen = set()
    uniq: List[Path] = []
    for p in sample_dirs:
        if p not in seen:
            uniq.append(p)
            seen.add(p)
    return uniq


def frames_to_wide_rows(frames: List[FrameKeypoints], include_score: bool) -> List[dict]:
    rows: List[dict] = []
    if not frames:
        return rows
    J = frames[0].keypoints.shape[0]
    for fr in frames:
        row = {"frame": fr.frame_index}
        for j in range(J):
            row[f"kp{j}_x"] = float(fr.keypoints[j, 0])
            row[f"kp{j}_y"] = float(fr.keypoints[j, 1])
            if include_score:
                row[f"kp{j}_c"] = float(fr.keypoints[j, 2])
        rows.append(row)
    return rows


def frames_to_long_rows(frames: List[FrameKeypoints]) -> List[dict]:
    rows: List[dict] = []
    for fr in frames:
        J = fr.keypoints.shape[0]
        for j in range(J):
            rows.append(
                {
                    "frame": fr.frame_index,
                    "joint": j,
                    "x": float(fr.keypoints[j, 0]),
                    "y": float(fr.keypoints[j, 1]),
                    "conf": float(fr.keypoints[j, 2]),
                }
            )
    return rows


def _write_excel_single(out_path: Path, sheet_name: str, rows: List[dict]) -> None:
    try:
        import pandas as pd
    except Exception as e:  # pragma: no cover
        raise RuntimeError("Missing pandas. Install: pip install pandas openpyxl") from e

    out_path.parent.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows)

    try:
        with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name=sheet_name[:31] or "Sheet1")
    except ModuleNotFoundError as e:  # pragma: no cover
        raise RuntimeError("Missing Excel engine. Install: pip install openpyxl") from e


def export_openpose_json_to_excel(
    *,
    input_path: Path,
    output_path: Path,
    recursive: bool,
    row_format: str,
    person_select: str,
    keypoints: int,
    remove_kp: Optional[Sequence[int]],
    max_frames: Optional[int],
    include_score: bool,
) -> List[Path]:
    sample_paths = discover_sample_dirs(input_path, recursive=recursive)

    if remove_kp is None:
        remove_kp2: Sequence[int] = DEFAULT_REMOVE_KP_17 if keypoints == 17 else []
    else:
        remove_kp2 = list(remove_kp)

    written: List[Path] = []

    if len(sample_paths) == 1:
        sample = sample_paths[0]

        if output_path.suffix.lower() != ".xlsx":
            out_dir = output_path
            out_dir.mkdir(parents=True, exist_ok=True)
            name = sample.stem if sample.is_file() else sample.name
            dst = out_dir / f"{name}.xlsx"
        else:
            dst = output_path
            name = sample.stem if sample.is_file() else sample.name

        frames = read_sequence_from_path(
            sample,
            person_select=person_select,
            remove_kp=remove_kp2,
            max_frames=max_frames,
        )
        rows = frames_to_wide_rows(frames, include_score=include_score) if row_format == "wide" else frames_to_long_rows(frames)
        _write_excel_single(dst, sheet_name=name, rows=rows)
        written.append(dst)
        return written

    if output_path.suffix.lower() == ".xlsx":
        out_dir = output_path.with_suffix("")
    else:
        out_dir = output_path
    out_dir.mkdir(parents=True, exist_ok=True)

    for sample in sample_paths:
        frames = read_sequence_from_path(
            sample,
            person_select=person_select,
            remove_kp=remove_kp2,
            max_frames=max_frames,
        )
        rows = frames_to_wide_rows(frames, include_score=include_score) if row_format == "wide" else frames_to_long_rows(frames)
        name = sample.stem if sample.is_file() else sample.name
        dst = out_dir / f"{name}.xlsx"
        _write_excel_single(dst, sheet_name=name, rows=rows)
        written.append(dst)

    return written


# =========================
# Part B: Excel -> ST-GCN prediction
# =========================

DEFAULT_REMOVE_TO_18 = [1, 9, 10, 11, 12, 13, 14]
DEFAULT_REMOVE_TO_17 = [1, 9, 10, 11, 12, 13, 14, 15]

# Matches default in converter (25 -> 17)
DEFAULT_EXCEL_REMOVED_KP = [15, 16, 17, 18, 20, 21, 23, 24]

# OpenPose BODY_25 indices
OP_NOSE = 0
OP_NECK = 1
OP_R_SHOULDER = 2
OP_R_ELBOW = 3
OP_R_WRIST = 4
OP_L_SHOULDER = 5
OP_L_ELBOW = 6
OP_L_WRIST = 7
OP_MID_HIP = 8
OP_R_HIP = 9
OP_R_KNEE = 10
OP_R_ANKLE = 11
OP_L_HIP = 12
OP_L_KNEE = 13
OP_L_ANKLE = 14
OP_L_BIG_TOE = 19
OP_L_HEEL = 21
OP_R_BIG_TOE = 22
OP_R_HEEL = 24


def _openpose25_to_kinect25(seq_op25: np.ndarray) -> np.ndarray:
    if seq_op25.ndim != 3 or seq_op25.shape[1] != 25 or seq_op25.shape[2] != 2:
        raise ValueError(f"Expected (T,25,2) OpenPose input, got {seq_op25.shape}")

    T = seq_op25.shape[0]
    out = np.zeros((T, 25, 2), dtype=np.float32)

    def take(i: int) -> np.ndarray:
        return seq_op25[:, i, :]

    # Kinect25 indices (per .KINECT25)
    K_HEAD = 0
    K_NECK = 1
    K_SPINE_SHOULDER = 2
    K_SHOULDER_L = 3
    K_SHOULDER_R = 4
    K_ELBOW_L = 5
    K_ELBOW_R = 6
    K_WRIST_L = 7
    K_WRIST_R = 8
    K_SPINE_MID = 15
    K_SPINE_BASE = 16
    K_HIP_L = 17
    K_HIP_R = 18
    K_KNEE_L = 19
    K_KNEE_R = 20
    K_ANKLE_L = 21
    K_ANKLE_R = 22
    K_FOOT_L = 23
    K_FOOT_R = 24

    out[:, K_HEAD, :] = take(OP_NOSE)
    out[:, K_NECK, :] = take(OP_NECK)
    out[:, K_SPINE_SHOULDER, :] = take(OP_NECK)
    out[:, K_SHOULDER_L, :] = take(OP_L_SHOULDER)
    out[:, K_SHOULDER_R, :] = take(OP_R_SHOULDER)
    out[:, K_ELBOW_L, :] = take(OP_L_ELBOW)
    out[:, K_ELBOW_R, :] = take(OP_R_ELBOW)
    out[:, K_WRIST_L, :] = take(OP_L_WRIST)
    out[:, K_WRIST_R, :] = take(OP_R_WRIST)

    out[:, K_SPINE_BASE, :] = take(OP_MID_HIP)
    out[:, K_SPINE_MID, :] = 0.5 * (take(OP_NECK) + take(OP_MID_HIP))

    out[:, K_HIP_L, :] = take(OP_L_HIP)
    out[:, K_HIP_R, :] = take(OP_R_HIP)
    out[:, K_KNEE_L, :] = take(OP_L_KNEE)
    out[:, K_KNEE_R, :] = take(OP_R_KNEE)
    out[:, K_ANKLE_L, :] = take(OP_L_ANKLE)
    out[:, K_ANKLE_R, :] = take(OP_R_ANKLE)

    foot_l = take(OP_L_BIG_TOE)
    if np.allclose(foot_l, 0.0):
        foot_l = take(OP_L_HEEL)
    if np.allclose(foot_l, 0.0):
        foot_l = take(OP_L_ANKLE)
    out[:, K_FOOT_L, :] = foot_l

    foot_r = take(OP_R_BIG_TOE)
    if np.allclose(foot_r, 0.0):
        foot_r = take(OP_R_HEEL)
    if np.allclose(foot_r, 0.0):
        foot_r = take(OP_R_ANKLE)
    out[:, K_FOOT_R, :] = foot_r

    return out


def _discover_excels(input_path: Path) -> List[Path]:
    if input_path.is_file():
        return [input_path]
    return sorted([p for p in input_path.rglob("*.xlsx") if p.is_file()])


def _parse_wide_excel(path: Path, *, include_score: bool = False) -> Tuple[np.ndarray, Optional[np.ndarray]]:
    try:
        import pandas as pd
    except Exception as e:  # pragma: no cover
        raise RuntimeError("Missing pandas. Install: pip install pandas openpyxl") from e

    df = pd.read_excel(path)
    if df.empty:
        raise ValueError(f"Empty Excel: {path}")

    pat = re.compile(r"^kp(\d+)_(x|y|c)$")
    joints: Dict[int, Dict[str, str]] = {}
    for col in df.columns:
        m = pat.match(str(col))
        if not m:
            continue
        j = int(m.group(1))
        t = m.group(2)
        joints.setdefault(j, {})[t] = str(col)

    if not joints:
        raise ValueError(f"Not a wide-format Excel (missing kp{{i}}_x/kp{{i}}_y): {path}")

    joint_ids = sorted(joints.keys())
    J = joint_ids[-1] + 1
    T = len(df)

    xy = np.zeros((T, J, 2), dtype=np.float32)
    conf = np.zeros((T, J), dtype=np.float32) if include_score else None

    for j in joint_ids:
        cols = joints[j]
        if "x" in cols:
            xy[:, j, 0] = df[cols["x"]].astype(np.float32).to_numpy()
        if "y" in cols:
            xy[:, j, 1] = df[cols["y"]].astype(np.float32).to_numpy()
        if include_score and conf is not None and "c" in cols:
            conf[:, j] = df[cols["c"]].astype(np.float32).to_numpy()

    xy[~np.isfinite(xy)] = 0.0
    if conf is not None:
        conf[~np.isfinite(conf)] = 0.0

    return xy, conf


def _trim_all_zero_ends(seq: np.ndarray) -> np.ndarray:
    if seq.size == 0:
        return seq
    seq2 = seq.copy()
    seq2[~np.isfinite(seq2)] = 0.0
    energy = np.sum(np.abs(seq2), axis=(1, 2))
    nz = np.where(energy > 0.0)[0]
    if nz.size == 0:
        return seq[:0]
    return seq[nz[0] : nz[-1] + 1]


def _remove_joint_indices(seq: np.ndarray, remove: Sequence[int]) -> np.ndarray:
    if not remove:
        return seq
    _, J, _ = seq.shape
    remove_set = {i for i in remove if 0 <= i < J}
    keep = [i for i in range(J) if i not in remove_set]
    return seq[:, keep, :]


def _expand_back_to_total_joints(
    seq_reduced: np.ndarray,
    *,
    total_joints: int,
    removed_kp: Sequence[int],
) -> np.ndarray:
    T, J, C = seq_reduced.shape
    if C != 2:
        raise ValueError(f"Expected C=2, got C={C}")

    removed_set = {i for i in removed_kp if 0 <= i < total_joints}
    keep = [i for i in range(total_joints) if i not in removed_set]
    if len(keep) != J:
        raise ValueError(
            f"Cannot expand: J={J} but keep={len(keep)} from removed_kp={list(removed_kp)}"
        )

    out = np.zeros((T, total_joints, 2), dtype=seq_reduced.dtype)
    for new_j, orig_j in enumerate(keep):
        out[:, orig_j, :] = seq_reduced[:, new_j, :]
    return out


def _resample_time_linear(seq: np.ndarray, L: int) -> np.ndarray:
    T = seq.shape[0]
    if L is None or L <= 0 or T == L:
        return seq
    if T <= 1:
        return np.repeat(seq, repeats=L, axis=0)

    x_old = np.linspace(0.0, 1.0, num=T, dtype=np.float32)
    x_new = np.linspace(0.0, 1.0, num=L, dtype=np.float32)

    V, C = seq.shape[1], seq.shape[2]
    out = np.zeros((L, V, C), dtype=np.float32)
    for v in range(V):
        for c in range(C):
            out[:, v, c] = np.interp(x_new, x_old, seq[:, v, c]).astype(np.float32)
    return out


def _apply_training_normalization(seq: np.ndarray, normalization: str, *, num_joints: int) -> np.ndarray:
    from ST_GCN import (
        normalize_by_bbox,
        normalize_by_rotation,
        normalize_by_scale,
        normalize_by_spine_base,
        normalize_combined_bbox_rotate,
        normalize_combined_bbox_zscore,
        normalize_combined_spinebase_zscore,
        normalize_zscore,
    )

    if normalization in (None, "", "original"):
        return seq

    if num_joints == 17:
        spine_base_idx, spine_shoulder_idx = 8, 1
    elif num_joints == 18:
        spine_base_idx, spine_shoulder_idx = 9, 1
    else:
        spine_base_idx, spine_shoulder_idx = 16, 2

    if normalization == "spine_base":
        return normalize_by_spine_base(seq, spine_base_idx)
    if normalization == "scale":
        return normalize_by_scale(seq, spine_base_idx, spine_shoulder_idx)
    if normalization == "rotate":
        return normalize_by_rotation(seq, spine_base_idx, spine_shoulder_idx)
    if normalization == "bbox":
        return normalize_by_bbox(seq)
    if normalization == "zscore":
        return normalize_zscore(seq)
    if normalization == "combined_bbox_rotate":
        return normalize_combined_bbox_rotate(seq, spine_base_idx, spine_shoulder_idx)
    if normalization == "combined_bbox_zscore":
        return normalize_combined_bbox_zscore(seq)
    if normalization == "combined_spinebase_zscore":
        return normalize_combined_spinebase_zscore(seq, spine_base_idx)

    raise ValueError(
        f"Unknown normalization={normalization!r}. "
        "Expected one of: original/spine_base/scale/rotate/bbox/zscore/combined_bbox_rotate/combined_bbox_zscore/combined_spinebase_zscore"
    )


def _load_stgcn_from_checkpoint(checkpoint_path: Path):
    import torch

    from ST_GCN import Graph, ST_GCN

    ckpt = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    cfg = ckpt.get("config") or {}

    num_joints = int(ckpt.get("num_joints", 18))
    if num_joints not in (17, 18, 25):
        raise ValueError(f"Unsupported checkpoint num_joints={num_joints} (expected 17/18/25)")

    include_dynamics = bool(cfg.get("include_dynamics", False))
    dynamic_fusion = str(cfg.get("dynamic_fusion", "none"))
    dynamic_features = cfg.get("dynamic_features") or []
    if isinstance(dynamic_features, str):
        dynamic_features = [dynamic_features]
    dynamic_features = list(dynamic_features)

    if include_dynamics and dynamic_fusion not in ("concat", "none"):
        raise ValueError(f"Unsupported dynamic_fusion={dynamic_fusion!r} (expected concat/none)")

    in_channels = 2
    if include_dynamics and dynamic_fusion != "none":
        supported = {"velocity", "acceleration", "motion_energy"}
        unsupported = [f for f in dynamic_features if f not in supported]
        if unsupported:
            raise ValueError(
                f"Unsupported dynamic features in checkpoint: {unsupported} (supported: {sorted(supported)})"
            )
        if "velocity" in dynamic_features:
            in_channels += 2
        if "acceleration" in dynamic_features:
            in_channels += 2
        if "motion_energy" in dynamic_features:
            in_channels += 1

    edge_importance = bool(cfg.get("edge_importance", True))
    dropout = float(cfg.get("dropout", 0.2))

    if num_joints == 17:
        graph = Graph(layout="kinect17")
    elif num_joints == 18:
        graph = Graph(layout="kinect23")
    else:
        graph = Graph(layout="openpose25")

    model = ST_GCN(
        in_channels=in_channels,
        num_class=2,
        A=graph.A,
        edge_importance_weighting=edge_importance,
        dropout=dropout,
    )

    model.load_state_dict(ckpt["model_state_dict"], strict=True)
    model.eval()
    return model, ckpt


def _predict_one(
    model,
    seq_feat: np.ndarray,
    device: str,
    *,
    temperature: float = 1.0,
) -> Tuple[int, float, np.ndarray, np.ndarray]:
    import torch

    x = torch.from_numpy(seq_feat).float().unsqueeze(0)  # (1,T,V,C)
    x = x.permute(0, 3, 1, 2).contiguous()  # (1,C,T,V)
    x = x.to(device)

    with torch.no_grad():
        logits_t = model(x)
        logits = logits_t[0].detach().cpu().numpy()
        t = float(temperature)
        if not np.isfinite(t) or t <= 0:
            raise ValueError(f"temperature must be > 0, got {temperature}")
        probs = torch.softmax(logits_t / t, dim=1)[0].detach().cpu().numpy()

    pred = int(np.argmax(probs))
    p_asd = float(probs[1])
    return pred, p_asd, probs, logits


def predict_from_excels(
    *,
    checkpoint: Path,
    input_path: Path,
    output_csv: Path,
    seq_len: int,
    input_layout: str,
    normalization: Optional[str],
    trim_zero_ends: bool,
    threshold: float,
    temperature: float,
    device: str,
    debug: bool,
    remove_to_18: bool,
    remove_to_17: bool,
    remove_kp: Optional[Sequence[int]],
    excel_removed_kp: Optional[Sequence[int]],
    expect_joints: Optional[int],
) -> None:
    import torch

    device2 = device
    if device2.startswith("cuda") and not torch.cuda.is_available():
        device2 = "cpu"

    model, ckpt = _load_stgcn_from_checkpoint(checkpoint)
    model = model.to(device2)

    cfg = ckpt.get("config") or {}
    include_dynamics = bool(cfg.get("include_dynamics", False))
    dynamic_fusion = str(cfg.get("dynamic_fusion", "none"))
    dynamic_features = cfg.get("dynamic_features") or []
    if isinstance(dynamic_features, str):
        dynamic_features = [dynamic_features]
    dynamic_features = list(dynamic_features)
    fps = float(cfg.get("fps", 30.0))

    ckpt_num_joints = int(ckpt.get("num_joints", 18))

    normalization2 = normalization
    if normalization2 is None:
        normalization2 = str(cfg.get("normalization", "original"))

    excels = _discover_excels(input_path)
    if not excels:
        raise FileNotFoundError(f"No .xlsx found under: {input_path}")

    output_csv.parent.mkdir(parents=True, exist_ok=True)

    rows: List[Dict[str, object]] = []
    for xlsx in excels:
        seq_xy, _ = _parse_wide_excel(xlsx, include_score=False)
        T_orig = int(seq_xy.shape[0])

        if trim_zero_ends:
            seq_xy = _trim_all_zero_ends(seq_xy)
            if seq_xy.shape[0] == 0:
                seq_xy = np.zeros((1, seq_xy.shape[1], 2), dtype=np.float32)

        expect_j = ckpt_num_joints if expect_joints is None else int(expect_joints)

        if input_layout == "openpose":
            if seq_xy.shape[1] != 25:
                removed = DEFAULT_EXCEL_REMOVED_KP if excel_removed_kp is None else list(excel_removed_kp)
                seq_xy = _expand_back_to_total_joints(seq_xy, total_joints=25, removed_kp=removed)
            seq_xy = _openpose25_to_kinect25(seq_xy)

        if remove_kp is not None:
            seq_xy = _remove_joint_indices(seq_xy, list(remove_kp))
        elif seq_xy.shape[1] == 25 and expect_j in (17, 18):
            if remove_to_17:
                seq_xy = _remove_joint_indices(seq_xy, DEFAULT_REMOVE_TO_17)
            elif remove_to_18:
                seq_xy = _remove_joint_indices(seq_xy, DEFAULT_REMOVE_TO_18)
            else:
                preset = DEFAULT_REMOVE_TO_17 if expect_j == 17 else DEFAULT_REMOVE_TO_18
                seq_xy = _remove_joint_indices(seq_xy, preset)

        got_j = int(seq_xy.shape[1])
        if got_j != expect_j:
            raise ValueError(
                f"{xlsx} has J={got_j} joints after processing; expected {expect_j}. "
                "(Use --remove-to-17/--remove-to-18/--remove-kp, or --excel-removed-kp to expand.)"
            )

        seq_xy = _apply_training_normalization(seq_xy, normalization2, num_joints=expect_j)

        feats: List[np.ndarray] = [seq_xy]
        if include_dynamics and dynamic_fusion != "none":
            from ST_GCN import (
                compute_acceleration,
                compute_motion_energy,
                compute_velocity,
            )

            if "velocity" in dynamic_features:
                feats.append(compute_velocity(seq_xy, fps=fps).astype(np.float32))
            if "acceleration" in dynamic_features:
                feats.append(compute_acceleration(seq_xy, fps=fps).astype(np.float32))
            if "motion_energy" in dynamic_features:
                me = compute_motion_energy(seq_xy, fps=fps).astype(np.float32)
                feats.append(me[..., None])

        seq_feat = np.concatenate(feats, axis=2)
        seq_feat = _resample_time_linear(seq_feat, seq_len)

        pred, p_asd, probs, logits = _predict_one(model, seq_feat, device=device2, temperature=temperature)
        label = 1 if p_asd >= float(threshold) else 0

        rows.append(
            {
                "file": str(xlsx),
                "T_in": T_orig,
                "J": got_j,
                "p_typical": float(probs[0]),
                "p_asd": float(probs[1]),
                "logit_typical": float(logits[0]),
                "logit_asd": float(logits[1]),
                "pred_argmax": int(pred),
                "label_threshold": int(label),
                "threshold": float(threshold),
                "temperature": float(temperature),
            }
        )

        if debug:
            seq_stats = {
                "T_after_trim": int(seq_xy.shape[0]),
                "x_min": float(np.min(seq_xy[..., 0])),
                "x_max": float(np.max(seq_xy[..., 0])),
                "y_min": float(np.min(seq_xy[..., 1])),
                "y_max": float(np.max(seq_xy[..., 1])),
                "abs_mean": float(np.mean(np.abs(seq_xy))),
            }
            print(
                f"[DEBUG] {xlsx.name} norm={normalization2} joints={got_j} "
                f"T={seq_feat.shape[0]} C={seq_feat.shape[2]} stats={seq_stats} logits={logits} probs={probs}"
            )

    fieldnames = [
        "file",
        "T_in",
        "J",
        "p_typical",
        "p_asd",
        "logit_typical",
        "logit_asd",
        "pred_argmax",
        "label_threshold",
        "threshold",
        "temperature",
    ]
    with output_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow(r)


def _frames_to_seq_xy(frames: List[FrameKeypoints]) -> np.ndarray:
    """Convert FrameKeypoints list -> (T,J,2) array."""
    if not frames:
        return np.zeros((0, 25, 2), dtype=np.float32)
    J = int(frames[0].keypoints.shape[0])
    T = int(len(frames))
    seq = np.zeros((T, J, 2), dtype=np.float32)
    for t, fr in enumerate(frames):
        j3 = fr.keypoints
        seq[t, :, 0] = j3[:, 0]
        seq[t, :, 1] = j3[:, 1]
    seq[~np.isfinite(seq)] = 0.0
    return seq


def _predict_sequence(
    *,
    model,
    ckpt: dict,
    seq_xy: np.ndarray,
    sample_id: str,
    seq_len: int,
    input_layout: str,
    normalization: Optional[str],
    trim_zero_ends: bool,
    threshold: float,
    temperature: float,
    device: str,
    debug: bool,
    remove_to_18: bool,
    remove_to_17: bool,
    remove_kp: Optional[Sequence[int]],
    excel_removed_kp: Optional[Sequence[int]],
    expect_joints: Optional[int],
) -> Dict[str, object]:
    cfg = ckpt.get("config") or {}
    include_dynamics = bool(cfg.get("include_dynamics", False))
    dynamic_fusion = str(cfg.get("dynamic_fusion", "none"))
    dynamic_features = cfg.get("dynamic_features") or []
    if isinstance(dynamic_features, str):
        dynamic_features = [dynamic_features]
    dynamic_features = list(dynamic_features)
    fps = float(cfg.get("fps", 30.0))

    ckpt_num_joints = int(ckpt.get("num_joints", 18))
    normalization2 = normalization
    if normalization2 is None:
        normalization2 = str(cfg.get("normalization", "original"))

    T_orig = int(seq_xy.shape[0])
    if trim_zero_ends:
        seq_xy = _trim_all_zero_ends(seq_xy)
        if seq_xy.shape[0] == 0:
            seq_xy = np.zeros((1, seq_xy.shape[1], 2), dtype=np.float32)

    expect_j = ckpt_num_joints if expect_joints is None else int(expect_joints)

    if input_layout == "openpose":
        if seq_xy.shape[1] != 25:
            removed = DEFAULT_EXCEL_REMOVED_KP if excel_removed_kp is None else list(excel_removed_kp)
            seq_xy = _expand_back_to_total_joints(seq_xy, total_joints=25, removed_kp=removed)
        seq_xy = _openpose25_to_kinect25(seq_xy)

    if remove_kp is not None:
        seq_xy = _remove_joint_indices(seq_xy, list(remove_kp))
    elif seq_xy.shape[1] == 25 and expect_j in (17, 18):
        if remove_to_17:
            seq_xy = _remove_joint_indices(seq_xy, DEFAULT_REMOVE_TO_17)
        elif remove_to_18:
            seq_xy = _remove_joint_indices(seq_xy, DEFAULT_REMOVE_TO_18)
        else:
            preset = DEFAULT_REMOVE_TO_17 if expect_j == 17 else DEFAULT_REMOVE_TO_18
            seq_xy = _remove_joint_indices(seq_xy, preset)

    got_j = int(seq_xy.shape[1])
    if got_j != expect_j:
        raise ValueError(
            f"{sample_id} has J={got_j} joints after processing; expected {expect_j}. "
            "(Use --remove-to-17/--remove-to-18/--remove-kp, or --excel-removed-kp to expand.)"
        )

    seq_xy = _apply_training_normalization(seq_xy, normalization2, num_joints=expect_j)

    feats: List[np.ndarray] = [seq_xy]
    if include_dynamics and dynamic_fusion != "none":
        from ST_GCN import (
            compute_acceleration,
            compute_motion_energy,
            compute_velocity,
        )

        if "velocity" in dynamic_features:
            feats.append(compute_velocity(seq_xy, fps=fps).astype(np.float32))
        if "acceleration" in dynamic_features:
            feats.append(compute_acceleration(seq_xy, fps=fps).astype(np.float32))
        if "motion_energy" in dynamic_features:
            me = compute_motion_energy(seq_xy, fps=fps).astype(np.float32)
            feats.append(me[..., None])

    seq_feat = np.concatenate(feats, axis=2)
    seq_feat = _resample_time_linear(seq_feat, seq_len)

    pred, p_asd, probs, logits = _predict_one(model, seq_feat, device=device, temperature=temperature)
    label = 1 if p_asd >= float(threshold) else 0

    if debug:
        seq_stats = {
            "T_after_trim": int(seq_xy.shape[0]),
            "x_min": float(np.min(seq_xy[..., 0])),
            "x_max": float(np.max(seq_xy[..., 0])),
            "y_min": float(np.max(seq_xy[..., 1] * 0 + np.min(seq_xy[..., 1]))),
            "y_max": float(np.max(seq_xy[..., 1])),
            "abs_mean": float(np.mean(np.abs(seq_xy))),
        }
        print(
            f"[DEBUG] {Path(sample_id).name} norm={normalization2} joints={got_j} "
            f"T={seq_feat.shape[0]} C={seq_feat.shape[2]} stats={seq_stats} logits={logits} probs={probs}"
        )

    return {
        "file": sample_id,
        "T_in": T_orig,
        "J": got_j,
        "p_typical": float(probs[0]),
        "p_asd": float(probs[1]),
        "logit_typical": float(logits[0]),
        "logit_asd": float(logits[1]),
        "pred_argmax": int(pred),
        "label_threshold": int(label),
        "threshold": float(threshold),
        "temperature": float(temperature),
    }


def predict_from_openpose_json(
    *,
    checkpoint: Path,
    input_path: Path,
    output_csv: Path,
    recursive: bool,
    person_select: str,
    max_frames: Optional[int],
    seq_len: int,
    input_layout: str,
    normalization: Optional[str],
    trim_zero_ends: bool,
    threshold: float,
    temperature: float,
    device: str,
    debug: bool,
    remove_to_18: bool,
    remove_to_17: bool,
    remove_kp: Optional[Sequence[int]],
    excel_removed_kp: Optional[Sequence[int]],
    expect_joints: Optional[int],
) -> None:
    import torch

    device2 = device
    if device2.startswith("cuda") and not torch.cuda.is_available():
        device2 = "cpu"

    model, ckpt = _load_stgcn_from_checkpoint(checkpoint)
    model = model.to(device2)

    samples = discover_sample_dirs(input_path, recursive=recursive)
    if not samples:
        raise FileNotFoundError(f"No JSON samples found under: {input_path}")

    output_csv.parent.mkdir(parents=True, exist_ok=True)

    rows: List[Dict[str, object]] = []
    for sample in samples:
        frames = read_sequence_from_path(
            sample,
            person_select=person_select,
            remove_kp=[],
            max_frames=max_frames,
        )
        seq_xy = _frames_to_seq_xy(frames)
        if seq_xy.shape[0] == 0:
            seq_xy = np.zeros((1, 25, 2), dtype=np.float32)

        rows.append(
            _predict_sequence(
                model=model,
                ckpt=ckpt,
                seq_xy=seq_xy,
                sample_id=str(sample),
                seq_len=seq_len,
                input_layout=input_layout,
                normalization=normalization,
                trim_zero_ends=trim_zero_ends,
                threshold=threshold,
                temperature=temperature,
                device=device2,
                debug=debug,
                remove_to_18=remove_to_18,
                remove_to_17=remove_to_17,
                remove_kp=remove_kp,
                excel_removed_kp=excel_removed_kp,
                expect_joints=expect_joints,
            )
        )

    fieldnames = [
        "file",
        "T_in",
        "J",
        "p_typical",
        "p_asd",
        "logit_typical",
        "logit_asd",
        "pred_argmax",
        "label_threshold",
        "threshold",
        "temperature",
    ]
    with output_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow(r)


# =========================
# CLI
# =========================


def _build_to_excel_parser(sub: Optional[argparse._SubParsersAction] = None) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(add_help=(sub is None))
    parser.add_argument("--input", required=True, type=str, help="Input JSON file or directory")
    parser.add_argument(
        "--output",
        required=True,
        type=str,
        help="Output .xlsx file (single) or output directory (multiple samples)",
    )
    parser.add_argument("--recursive", action="store_true", help="Discover sample folders recursively")
    parser.add_argument(
        "--format",
        type=str,
        default="wide",
        choices=["wide", "long"],
        help="Excel row format",
    )
    parser.add_argument(
        "--person-select",
        type=str,
        default="best_score",
        choices=["best_score", "first"],
        help="Which person to choose when multiple people are detected",
    )
    parser.add_argument(
        "--keypoints",
        type=int,
        default=25,
        choices=[17, 25],
        help="How many keypoints to export. Default: 25 (OpenPose BODY_25)",
    )
    parser.add_argument(
        "--remove-kp",
        type=int,
        nargs="*",
        default=None,
        help=(
            "Keypoint indices to remove (0-based). "
            "If omitted: uses a default list only when --keypoints 17; otherwise removes none. "
            "Pass an empty list to force no removal: --remove-kp"
        ),
    )
    parser.add_argument("--max-frames", type=int, default=None, help="Limit number of frames")
    parser.add_argument(
        "--no-score",
        action="store_true",
        help="For wide format: omit confidence columns",
    )

    if sub is not None:
        sub.add_parser("to-excel", parents=[parser], help="Convert OpenPose JSON outputs to Excel")

    return parser


def _build_predict_parser(sub: Optional[argparse._SubParsersAction] = None) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(add_help=(sub is None))
    parser.add_argument("--checkpoint", required=True, type=str)
    parser.add_argument("--input", required=True, type=str)
    parser.add_argument("--output", required=True, type=str)

    parser.add_argument("--seq-len", type=int, default=128)
    parser.add_argument(
        "--input-layout",
        choices=["openpose", "kinect"],
        default="openpose",
        help=(
            "Layout of joints in the Excel. 'openpose' means BODY_25 indexing (converter outputs). "
            "We will expand reduced Excels back to 25 using --excel-removed-kp, convert OpenPose->Kinect ordering, then reduce to checkpoint joints. "
            "Use 'kinect' only if your Excel is already in Kinect25 ordering."
        ),
    )
    parser.add_argument(
        "--normalization",
        type=str,
        default=None,
        help=(
            "Normalization to apply before resample. If omitted, uses checkpoint config['normalization'] (if present) else 'original'. "
            "Supported: original, spine_base, scale, rotate, bbox, zscore, combined_bbox_rotate, combined_bbox_zscore, combined_spinebase_zscore"
        ),
    )
    parser.add_argument("--trim-zero-ends", action="store_true", help="Trim leading/trailing all-zero frames (match training).")
    parser.add_argument(
        "--no-trim-zero-ends",
        dest="trim_zero_ends",
        action="store_false",
        help="Disable trimming leading/trailing all-zero frames.",
    )
    parser.set_defaults(trim_zero_ends=True)
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument(
        "--temperature",
        type=float,
        default=1.0,
        help="Softmax temperature >1.0 makes probabilities less extreme (calibration). Default 1.0.",
    )
    parser.add_argument("--device", type=str, default="cuda")
    parser.add_argument("--debug", action="store_true")

    parser.add_argument("--remove-to-18", action="store_true")
    parser.add_argument("--remove-to-17", action="store_true")
    parser.add_argument("--remove-kp", type=int, nargs="*", default=None)

    parser.add_argument(
        "--excel-removed-kp",
        type=int,
        nargs="*",
        default=None,
        help=(
            "If Excel has reduced joints (e.g., 17), provide the indices removed from 25 so we can expand back to 25 then reduce. "
            f"Default when auto-expanding: {DEFAULT_EXCEL_REMOVED_KP}"
        ),
    )
    parser.add_argument("--expect-joints", type=int, default=None)

    if sub is not None:
        sub.add_parser("predict", parents=[parser], help="Predict using ST-GCN from Excel exports")

    return parser


def _build_json_predict_parser(sub: Optional[argparse._SubParsersAction] = None) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(add_help=(sub is None))
    parser.add_argument("--checkpoint", required=True, type=str)
    parser.add_argument("--input", required=True, type=str, help="Input JSON file, directory, or root folder")
    parser.add_argument("--output", required=True, type=str, help="Output predictions CSV")
    parser.add_argument("--recursive", action="store_true", help="Discover sample folders recursively")
    parser.add_argument(
        "--person-select",
        type=str,
        default="best_score",
        choices=["best_score", "first"],
        help="Which person to choose when multiple people are detected",
    )
    parser.add_argument("--max-frames", type=int, default=None, help="Limit number of frames")

    # Predict options (same as predict)
    parser.add_argument("--seq-len", type=int, default=128)
    parser.add_argument(
        "--input-layout",
        choices=["openpose", "kinect"],
        default="openpose",
        help=(
            "Layout of joints in the JSON/sequence. 'openpose' means BODY_25 indexing. "
            "We will convert OpenPose->Kinect ordering, then reduce to checkpoint joints if needed."
        ),
    )
    parser.add_argument(
        "--normalization",
        type=str,
        default=None,
        help=(
            "Normalization to apply before resample. If omitted, uses checkpoint config['normalization'] (if present) else 'original'."
        ),
    )
    parser.add_argument("--trim-zero-ends", action="store_true")
    parser.add_argument("--no-trim-zero-ends", dest="trim_zero_ends", action="store_false")
    parser.set_defaults(trim_zero_ends=True)
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--temperature", type=float, default=1.0)
    parser.add_argument("--device", type=str, default="cuda")
    parser.add_argument("--debug", action="store_true")
    parser.add_argument("--remove-to-18", action="store_true")
    parser.add_argument("--remove-to-17", action="store_true")
    parser.add_argument("--remove-kp", type=int, nargs="*", default=None)
    parser.add_argument(
        "--excel-removed-kp",
        type=int,
        nargs="*",
        default=None,
        help=(
            "Kept for parity with Excel flow; used only if sequence isn't 25 joints and needs expanding. "
            f"Default when auto-expanding: {DEFAULT_EXCEL_REMOVED_KP}"
        ),
    )
    parser.add_argument("--expect-joints", type=int, default=None)

    if sub is not None:
        sub.add_parser("json-predict", parents=[parser], help="Predict directly from OpenPose JSON (no Excel)")
    return parser


def main_to_excel(argv: Optional[Sequence[str]] = None) -> None:
    parser = _build_to_excel_parser()
    args = parser.parse_args(argv)

    written = export_openpose_json_to_excel(
        input_path=Path(args.input),
        output_path=Path(args.output),
        recursive=bool(args.recursive),
        row_format=str(args.format),
        person_select=str(args.person_select),
        keypoints=int(args.keypoints),
        remove_kp=args.remove_kp,
        max_frames=args.max_frames,
        include_score=(not bool(args.no_score)),
    )

    for p in written:
        print(f"Wrote: {p}")


def main_predict(argv: Optional[Sequence[str]] = None) -> None:
    parser = _build_predict_parser()
    args = parser.parse_args(argv)

    predict_from_excels(
        checkpoint=Path(args.checkpoint),
        input_path=Path(args.input),
        output_csv=Path(args.output),
        seq_len=int(args.seq_len),
        input_layout=str(args.input_layout),
        normalization=args.normalization,
        trim_zero_ends=bool(args.trim_zero_ends),
        threshold=float(args.threshold),
        temperature=float(args.temperature),
        device=str(args.device),
        debug=bool(args.debug),
        remove_to_18=bool(args.remove_to_18),
        remove_to_17=bool(args.remove_to_17),
        remove_kp=args.remove_kp,
        excel_removed_kp=args.excel_removed_kp,
        expect_joints=args.expect_joints,
    )

    print(f"Wrote predictions: {Path(args.output)}")


def main_json_predict(argv: Optional[Sequence[str]] = None) -> None:
    parser = _build_json_predict_parser()
    args = parser.parse_args(argv)

    predict_from_openpose_json(
        checkpoint=Path(args.checkpoint),
        input_path=Path(args.input),
        output_csv=Path(args.output),
        recursive=bool(args.recursive),
        person_select=str(args.person_select),
        max_frames=args.max_frames,
        seq_len=int(args.seq_len),
        input_layout=str(args.input_layout),
        normalization=args.normalization,
        trim_zero_ends=bool(args.trim_zero_ends),
        threshold=float(args.threshold),
        temperature=float(args.temperature),
        device=str(args.device),
        debug=bool(args.debug),
        remove_to_18=bool(args.remove_to_18),
        remove_to_17=bool(args.remove_to_17),
        remove_kp=args.remove_kp,
        excel_removed_kp=args.excel_removed_kp,
        expect_joints=args.expect_joints,
    )

    print(f"Wrote predictions: {Path(args.output)}")


def main(argv: Optional[Sequence[str]] = None) -> None:
    if argv is None:
        argv = sys.argv[1:]

    if not argv or argv[0] in ("-h", "--help"):
        parser = argparse.ArgumentParser(
            description="Unified OpenPose JSON->Excel + ST-GCN prediction pipeline",
        )
        sub = parser.add_subparsers(dest="cmd")
        _build_to_excel_parser(sub)
        _build_predict_parser(sub)
        _build_json_predict_parser(sub)
        parser.print_help()
        return

    cmd = argv[0]
    rest = list(argv[1:])

    if cmd == "to-excel":
        main_to_excel(rest)
    elif cmd == "predict":
        main_predict(rest)
    elif cmd == "json-predict":
        main_json_predict(rest)
    else:
        raise SystemExit(f"Unknown command: {cmd}")


if __name__ == "__main__":
    main()
