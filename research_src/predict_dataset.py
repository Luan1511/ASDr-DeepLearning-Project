#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Run the DEPLOYED ST-GCN preprocessing + inference over a dataset and write a
predictions CSV for calibrate_evaluate.py (calibrate / evaluate).

Every sample goes through the exact code path of the ML server:
API/services/stgcn_service.py::STGCNPredictor, built with the same arguments as
API/server_openpose.py::startup(), called with temperature=1.0 so the CSV holds
RAW logits (calibration happens later, on validation predictions only).

Accepted sample paths (from splits.json or a manifest CSV):
  (a) API keypoints file, e.g. storage/asd_subjects/<id>/keypoints_body25.json
      {..., "frames": [{frame_index, people: [{person_id, body25: [{id, x, y, confidence}]}]}]}
      -> STGCNPredictor.predict_from_api_frames
  (b) directory of raw OpenPose *_keypoints.json frames -> converted to API
      frames exactly like server_openpose.read_openpose_json
      -> STGCNPredictor.predict_from_api_frames
      (a subject folder holding keypoints_body25.json or openpose_json/ also works)
  (c) wide Excel export (kp{j}_x / kp{j}_y [/ kp{j}_c]) -> _parse_wide_excel
      -> the same _predict_sequence call STGCNPredictor makes

Output columns: path,subject_id,label,split,logit_typical,logit_asd,p_asd_t1,T_in,J,error
A failed sample keeps its row with `error` filled; calibrate/evaluate skip it
with a warning. A sidecar <output>.meta.json records the checkpoint sha256 so
calibrate/evaluate can detect predictions made with a different checkpoint.

Usage:
    python research_src/predict_dataset.py --checkpoint best.pth --splits splits.json \
        --only-splits val test --device cuda --output preds.csv
    python research_src/predict_dataset.py --checkpoint best.pth --manifest manifest.csv \
        --device cpu --output preds.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

_THIS_DIR = Path(__file__).resolve().parent
if str(_THIS_DIR) not in sys.path:
    sys.path.insert(0, str(_THIS_DIR))

import calibrate_evaluate as ce  # noqa: E402  (shared manifest/splits/sha helpers)

DEFAULT_API_DIR = _THIS_DIR.parent / "API"

# Keep in sync with API/server_openpose.py::startup() (device is a CLI option).
SERVER_PREDICTOR_KWARGS = {"seq_len": 128, "input_layout": "openpose", "normalization": None}
RAW_TEMPERATURE = 1.0
UNUSED_THRESHOLD = 0.5  # label_threshold is not used: only logits are kept

OUTPUT_COLUMNS = [
    "path",
    "subject_id",
    "label",
    "split",
    "logit_typical",
    "logit_asd",
    "p_asd_t1",
    "T_in",
    "J",
    "error",
]


def import_api(api_dir: Path):
    """Put API/ on sys.path and import the server's predictor + pipeline helpers."""
    api_dir = Path(api_dir).resolve()
    if not (api_dir / "services" / "stgcn_service.py").is_file():
        raise FileNotFoundError(f"API folder not found (no services/stgcn_service.py): {api_dir}")
    if str(api_dir) not in sys.path:
        sys.path.insert(0, str(api_dir))
    from services.stgcn_service import STGCNPredictor  # noqa: E402
    import openpose_excel_stgcn_pipeline as pipeline  # noqa: E402

    return STGCNPredictor, pipeline


# =========================
# Sample readers
# =========================


def read_openpose_dir_as_api_frames(output_dir: Path) -> List[dict]:
    """Mirror of API/server_openpose.py::read_openpose_json (kept in sync by hand:
    server_openpose imports FastAPI and creates storage folders at import time)."""
    frames = []
    json_files = sorted(Path(output_dir).glob("*_keypoints.json"))

    for frame_idx, json_path in enumerate(json_files):
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        people = data.get("people", [])
        frame_people = []

        for person_idx, person in enumerate(people):
            keypoints = person.get("pose_keypoints_2d", [])
            points = []

            for i in range(0, len(keypoints), 3):
                if i + 2 >= len(keypoints):
                    continue

                points.append(
                    {
                        "id": i // 3,
                        "x": float(keypoints[i]),
                        "y": float(keypoints[i + 1]),
                        "confidence": float(keypoints[i + 2]),
                    }
                )

            frame_people.append({"person_id": person_idx, "body25": points})

        frames.append({"frame_index": frame_idx, "people": frame_people})

    return frames


def load_api_frames_json(path: Path) -> List[dict]:
    """frames list of an API keypoints file (server: keypoint_payload.get("frames", []))."""
    with open(path, "r", encoding="utf-8") as f:
        payload = json.load(f)
    if isinstance(payload, dict):
        if "frames" not in payload and "people" in payload:
            raise ValueError("this is a single raw OpenPose frame file; pass its directory instead")
        frames = payload.get("frames", [])
    elif isinstance(payload, list):
        frames = payload
    else:
        raise ValueError(f"unexpected JSON payload type {type(payload).__name__}")
    if not frames:
        raise ValueError("no frames found in keypoints JSON")
    return frames


def resolve_sample(path: Path) -> Tuple[str, Path]:
    """-> (kind, source) with kind in {"api_json", "openpose_dir", "excel"}."""
    path = Path(path)
    if path.is_file():
        suffix = path.suffix.lower()
        if suffix in (".xlsx", ".xls"):
            return "excel", path
        if suffix == ".json":
            return "api_json", path
        raise ValueError(f"unsupported sample file type: {path.name}")
    if path.is_dir():
        if any(path.glob("*_keypoints.json")):
            return "openpose_dir", path
        if (path / ce.API_KEYPOINTS_JSON).is_file():
            return "api_json", path / ce.API_KEYPOINTS_JSON
        nested = path / "openpose_json"
        if nested.is_dir() and any(nested.glob("*_keypoints.json")):
            return "openpose_dir", nested
        raise ValueError(f"directory has no *_keypoints.json frames nor {ce.API_KEYPOINTS_JSON}: {path}")
    raise FileNotFoundError(f"sample path not found: {path}")


# =========================
# Prediction (server code path)
# =========================


def predict_seq_like_server(predictor, pipeline, seq_xy, sample_id: str) -> Dict[str, object]:
    """Same _predict_sequence call as STGCNPredictor.predict_from_api_frames,
    for sequences that do not come from API frames (wide Excel)."""
    if seq_xy.shape[0] == 0:
        raise ValueError("no valid frame/keypoint to predict")
    return pipeline._predict_sequence(
        model=predictor.model,
        ckpt=predictor.ckpt,
        seq_xy=seq_xy,
        sample_id=sample_id,
        seq_len=predictor.seq_len,
        input_layout=predictor.input_layout,
        normalization=predictor.normalization,
        trim_zero_ends=True,
        threshold=UNUSED_THRESHOLD,
        temperature=RAW_TEMPERATURE,
        device=predictor.device,
        debug=False,
        remove_to_18=False,
        remove_to_17=False,
        remove_kp=None,
        excel_removed_kp=None,
        expect_joints=None,
    )


def predict_sample(predictor, pipeline, path: Path) -> Dict[str, object]:
    kind, src = resolve_sample(path)
    if kind == "excel":
        seq_xy, _ = pipeline._parse_wide_excel(src, include_score=False)
        return predict_seq_like_server(predictor, pipeline, seq_xy, str(path))
    if kind == "api_json":
        frames = load_api_frames_json(src)
    else:
        frames = read_openpose_dir_as_api_frames(src)
        if not frames:
            raise ValueError(f"no *_keypoints.json frames in {src}")
    return predictor.predict_from_api_frames(
        frames=frames,
        sample_id=str(path),
        threshold=UNUSED_THRESHOLD,
        temperature=RAW_TEMPERATURE,
    )


# =========================
# Sample list
# =========================


def load_samples(splits: Optional[Path], manifest: Optional[Path]) -> List[Dict[str, object]]:
    if splits is not None:
        doc = ce.load_splits(Path(splits))
        return [dict(s) for s in doc["samples"]]
    return ce.read_manifest(Path(manifest))


def _one_line(text: str, limit: int = 500) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 3] + "..."


def run_predictions(
    checkpoint: Path,
    output: Path,
    splits: Optional[Path] = None,
    manifest: Optional[Path] = None,
    device: str = "cuda",
    only_splits: Optional[Sequence[str]] = None,
    api_dir: Path = DEFAULT_API_DIR,
) -> Tuple[int, int]:
    """Predict every sample; returns (n_ok, n_error)."""
    if (splits is None) == (manifest is None):
        raise ValueError("give exactly one of --splits or --manifest")
    checkpoint = Path(checkpoint)
    if not checkpoint.is_file():
        raise FileNotFoundError(f"checkpoint not found: {checkpoint}")

    samples = load_samples(splits, manifest)
    if only_splits:
        wanted = set(only_splits)
        samples = [s for s in samples if s.get("split") in wanted]
    if not samples:
        raise ValueError("no samples to predict (check --only-splits)")

    STGCNPredictor, pipeline = import_api(api_dir)
    checkpoint_sha256 = ce.sha256_file(checkpoint)  # hash the exact bytes that get loaded
    predictor = STGCNPredictor(checkpoint_path=checkpoint, device=device, **SERVER_PREDICTOR_KWARGS)
    cfg = predictor.ckpt.get("config") or {}
    num_joints = int(predictor.ckpt.get("num_joints", 18))
    normalization = (
        SERVER_PREDICTOR_KWARGS["normalization"]
        if SERVER_PREDICTOR_KWARGS["normalization"] is not None
        else str(cfg.get("normalization", "original"))
    )
    print(
        f"Checkpoint {checkpoint.name}: num_joints={num_joints}, normalization={normalization}, "
        f"device={predictor.device}, seq_len={predictor.seq_len}, temperature={RAW_TEMPERATURE}"
    )

    rows: List[Dict[str, object]] = []
    n_ok = n_err = 0
    t0 = time.time()
    for i, s in enumerate(samples, start=1):
        row: Dict[str, object] = {c: "" for c in OUTPUT_COLUMNS}
        row.update(
            path=s["path"],
            subject_id=s["subject_id"],
            label=int(s["label"]),
            split=s.get("split", "") or "",
        )
        try:
            res = predict_sample(predictor, pipeline, Path(str(s["path"])))
            row.update(
                logit_typical=float(res["logit_typical"]),
                logit_asd=float(res["logit_asd"]),
                p_asd_t1=float(res["p_asd"]),
                T_in=int(res["T_in"]),
                J=int(res["J"]),
            )
            n_ok += 1
            status = f"OK  p_asd_t1={row['p_asd_t1']:.4f}"
        except Exception as e:  # keep going: the failed sample keeps a row with `error`
            row["error"] = _one_line(f"{type(e).__name__}: {e}")
            n_err += 1
            status = f"ERR {row['error']}"
        rows.append(row)
        print(f"[{i}/{len(samples)}] {status} | {s['path']}")

    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=OUTPUT_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)

    meta = {
        "version": 1,
        "created_at": ce.now_iso(),
        "checkpoint": checkpoint.resolve().as_posix(),
        "checkpoint_sha256": checkpoint_sha256,
        "num_joints": num_joints,
        "normalization": normalization,
        "seq_len": predictor.seq_len,
        "input_layout": predictor.input_layout,
        "temperature": RAW_TEMPERATURE,
        "device": str(predictor.device),
        "api_dir": Path(api_dir).resolve().as_posix(),
        "source": {"splits": Path(splits).resolve().as_posix()} if splits is not None
        else {"manifest": Path(manifest).resolve().as_posix()},
        "only_splits": list(only_splits) if only_splits else None,
        "n_rows": len(rows),
        "n_errors": n_err,
    }
    ce.write_json(ce.predictions_meta_path(output), meta)

    per_split: Dict[str, List[int]] = {}
    for r in rows:
        per_split.setdefault(str(r["split"]) or "-", [0, 0])[0 if not r["error"] else 1] += 1
    print(f"Done in {time.time() - t0:.1f}s: {n_ok} ok, {n_err} failed")
    for name, (ok, bad) in sorted(per_split.items()):
        print(f"  split {name}: {ok} ok, {bad} failed")
    if n_err:
        print(f"WARNING: {n_err} sample(s) failed; their rows have `error` set and will be skipped", file=sys.stderr)
    for group in duplicate_recording_groups(rows):
        listing = "; ".join(f"{r['subject_id']} [{r['split'] or '-'}] {r['path']}" for r in group)
        print(
            "WARNING: identical predictions under different subject ids (same recording twice? "
            f"give them one subject_id, or drop one): {listing}",
            file=sys.stderr,
        )
    print(f"Wrote {output} (+ {ce.predictions_meta_path(output).name})")
    return n_ok, n_err


def duplicate_recording_groups(rows: Sequence[Dict[str, object]]) -> List[List[Dict[str, object]]]:
    """Groups of successful rows with bit-identical (logits, T_in) but different
    subject ids: almost surely the same recording listed twice (e.g. one video
    uploaded under two ids), which leaks across splits if the ids differ."""
    groups: Dict[Tuple, List[Dict[str, object]]] = {}
    for r in rows:
        if not r["error"]:
            groups.setdefault((r["logit_typical"], r["logit_asd"], r["T_in"]), []).append(r)
    return [g for g in groups.values() if len({str(r["subject_id"]) for r in g}) > 1]


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description="Predict a dataset with the DEPLOYED ST-GCN preprocessing (raw logits, T=1) -> predictions CSV",
    )
    ap.add_argument("--checkpoint", type=Path, required=True)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--splits", type=Path, help="splits.json from calibrate_evaluate.py split")
    src.add_argument("--manifest", type=Path, help="CSV with columns path,subject_id,label[,split]")
    ap.add_argument("--output", type=Path, required=True, help="predictions CSV to write")
    ap.add_argument("--device", default="cuda", help="cpu | cuda | cuda:N (falls back to cpu without CUDA)")
    ap.add_argument(
        "--only-splits",
        nargs="+",
        choices=list(ce.SPLIT_NAMES),
        default=None,
        help="predict only these splits (e.g. val test)",
    )
    ap.add_argument("--api-dir", type=Path, default=DEFAULT_API_DIR, help="folder with services/stgcn_service.py")
    return ap


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if not re.fullmatch(r"cpu|cuda(:\d+)?", args.device):
        print(f"ERROR: --device must be cpu, cuda or cuda:N (got {args.device!r})", file=sys.stderr)
        return 1
    try:
        n_ok, _ = run_predictions(
            checkpoint=args.checkpoint,
            output=args.output,
            splits=args.splits,
            manifest=args.manifest,
            device=args.device,
            only_splits=args.only_splits,
            api_dir=args.api_dir,
        )
    except (ValueError, FileNotFoundError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    return 0 if n_ok > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
