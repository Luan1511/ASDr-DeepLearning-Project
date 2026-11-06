#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tạo file chia tập (splits.json) chuẩn hóa, sạch rò rỉ cho bộ dữ liệu Kinect25_ASD.

Khắc phục 3 lỗi đã xác định từ phiên kiểm toán 29/10:
  1. Gộp/Loại bỏ 7 nhóm thư mục trùng lặp (KINECT_DUP_DROP: 3 ASD, 9 Typical).
  2. Loại bỏ dữ liệu hỏng (KINECT_BROKEN: ASD 8 với toạ độ 2D hỏng).
  3. Cân bằng độ tuổi (mặc định --age-filter ge5):
     Toàn bộ 46 trẻ ASD đều >= 5 tuổi (5-15 tuổi, trung vị 9.0).
     Nhóm Typical có 7 trẻ <= 4 tuổi (2-4 tuổi) tạo ra biến gây nhiễu tuổi.
     Lọc Typical >= 5 tuổi (34 trẻ, trung vị 7.0, khoảng 5-14 tuổi) giúp 2 nhóm
     cân bằng lứa tuổi đi học, triệt tiêu lối tắt tuổi tác.

Đầu ra:
  splits_kinect_clean_age_matched.json (hoặc tên tùy chọn)
  Tương thích chuẩn định dạng splits của calibrate_evaluate.py và fine_tune.py.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import pandas as pd

# Các thư mục trùng lặp đã xác định từ so sánh hash toạ độ và nội dung
KINECT_DUP_DROP: Set[Tuple[str, int]] = {
    ("ASD", 34),   # trùng ASD 1
    ("ASD", 18),   # trùng ASD 7
    ("ASD", 40),   # trùng ASD 30
    ("Typical", 7),   # trùng Typical 1
    ("Typical", 16),  # trùng Typical 1
    ("Typical", 20),  # trùng Typical 1
    ("Typical", 29),  # trùng Typical 1
    ("Typical", 26),  # trùng Typical 2
    ("Typical", 40),  # trùng Typical 2
    ("Typical", 23),  # trùng Typical 4
    ("Typical", 28),  # trùng Typical 4
    ("Typical", 14),  # trùng Typical 13
}

# Mẫu hỏng toạ độ
KINECT_BROKEN: Set[Tuple[str, int]] = {
    ("ASD", 8),    # toạ độ 2D bị lỗi, tỉ lệ co chân/thân vọt lên 52.7
}


def parse_args():
    parser = argparse.ArgumentParser(description="Tạo split sạch rò rỉ cho Kinect25_ASD")
    parser.add_argument(
        "--data-root",
        type=str,
        default="Datas/Kinect25_ASD/Kinect25_ASD_NoVideos",
        help="Thư mục gốc chứa bộ Kinect25_ASD_NoVideos",
    )
    parser.add_argument(
        "--metadata",
        type=str,
        default="research_src/eval_runs/2026-10-29_data_audit/metadata_linked.csv",
        help="Đường dẫn file metadata_linked.csv",
    )
    parser.add_argument(
        "--age-filter",
        type=str,
        default="ge5",
        choices=["ge5", "all"],
        help="ge5: chỉ giữ trẻ >= 5 tuổi (cân bằng 2 nhóm); all: giữ mọi độ tuổi",
    )
    parser.add_argument(
        "--train-ratio",
        type=float,
        default=0.70,
        help="Tỷ lệ train (mặc định 0.70)",
    )
    parser.add_argument(
        "--val-ratio",
        type=float,
        default=0.15,
        help="Tỷ lệ validation (mặc định 0.15)",
    )
    parser.add_argument(
        "--test-ratio",
        type=float,
        default=0.15,
        help="Tỷ lệ test (mặc định 0.15)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed cho phân chia stratified (mặc định 42)",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="File JSON xuất ra (mặc định tự đặt theo cấu hình)",
    )
    return parser.parse_args()


def load_metadata(meta_path: Path) -> pd.DataFrame:
    if not meta_path.is_file():
        # Thử tìm tương đối quanh repo Main
        alt = Path("E:/JupyterWorkspace/NCKH/Main/research_src/eval_runs/2026-10-29_data_audit/metadata_linked.csv")
        if alt.is_file():
            meta_path = alt
        else:
            raise FileNotFoundError(f"Không tìm thấy file metadata tại: {meta_path}")
    return pd.read_csv(meta_path)


def collect_subjects(
    data_root: Path,
    meta_df: pd.DataFrame,
    age_filter: str,
) -> Tuple[List[int], List[int], Dict[str, dict]]:
    """Lọc danh sách subject ASD và Typical sạch."""
    typ_meta = meta_df[meta_df["label"] == "Typical"].set_index("subject")
    asd_meta = meta_df[meta_df["label"] == "ASD"].set_index("subject")

    asd_subs = [
        s for s in range(1, 51)
        if ("ASD", s) not in KINECT_DUP_DROP and ("ASD", s) not in KINECT_BROKEN
    ]

    typ_subs = [
        s for s in range(1, 51)
        if ("Typical", s) not in KINECT_DUP_DROP
    ]

    if age_filter == "ge5":
        typ_subs = [s for s in typ_subs if typ_meta.loc[s, "age"] >= 5.0]

    # Thu thập metadata từng subject
    subject_info: Dict[str, dict] = {}
    for s in asd_subs:
        sid = f"ASD_{s}"
        subject_info[sid] = {
            "label_name": "ASD",
            "label": 1,
            "raw_id": s,
            "sex": str(asd_meta.loc[s, "sex"]),
            "age": float(asd_meta.loc[s, "age"]),
            "height_m": float(asd_meta.loc[s, "kinect_height_m"]),
        }
    for s in typ_subs:
        sid = f"Typical_{s}"
        subject_info[sid] = {
            "label_name": "Typical",
            "label": 0,
            "raw_id": s,
            "sex": str(typ_meta.loc[s, "sex"]),
            "age": float(typ_meta.loc[s, "age"]),
            "height_m": float(typ_meta.loc[s, "kinect_height_m"]),
        }

    return sorted(asd_subs), sorted(typ_subs), subject_info


def split_subjects_stratified(
    subs: List[int],
    prefix: str,
    train_ratio: float,
    val_ratio: float,
    seed: int,
) -> Tuple[List[str], List[str], List[str]]:
    """Chia danh sách subject thành 3 tập train, val, test."""
    rng = random.Random(seed)
    shuffled = subs[:]
    rng.shuffle(shuffled)

    n = len(shuffled)
    n_train = int(round(n * train_ratio))
    n_val = int(round(n * val_ratio))

    tr = [f"{prefix}_{s}" for s in shuffled[:n_train]]
    va = [f"{prefix}_{s}" for s in shuffled[n_train : n_train + n_val]]
    te = [f"{prefix}_{s}" for s in shuffled[n_train + n_val :]]
    return sorted(tr), sorted(va), sorted(te)


def collect_samples_for_subject(
    data_root: Path,
    label_name: str,
    raw_id: int,
    sid: str,
    split_name: str,
) -> List[dict]:
    """Tìm tất cả clip (gốc + augmentation) của 1 subject."""
    sub_folder = (
        data_root / "Autism/children with ASD" / str(raw_id)
        if label_name == "ASD"
        else data_root / "Typical" / str(raw_id)
    )

    samples = []
    # 1 clip video gốc
    f2d = sub_folder / "video/8_2d.xlsx"
    f3d = sub_folder / "video/8.xlsx"
    if f2d.is_file():
        samples.append({
            "path": f2d.relative_to(data_root).as_posix(),
            "path_3d": f3d.relative_to(data_root).as_posix() if f3d.is_file() else None,
            "subject_id": sid,
            "label": 1 if label_name == "ASD" else 0,
            "variant_kind": "video",
            "variant_id": "8",
            "split": split_name,
        })

    # 7 clip augmentation
    for aug in range(1, 8):
        a2d = sub_folder / f"augmentation/{aug}/{aug}_2d.xlsx"
        a3d = sub_folder / f"augmentation/{aug}/{aug}.xlsx"
        if a2d.is_file():
            samples.append({
                "path": a2d.relative_to(data_root).as_posix(),
                "path_3d": a3d.relative_to(data_root).as_posix() if a3d.is_file() else None,
                "subject_id": sid,
                "label": 1 if label_name == "ASD" else 0,
                "variant_kind": "augmentation",
                "variant_id": str(aug),
                "split": split_name,
            })

    return samples


def main():
    args = parse_args()
    data_root = Path(args.data_root)
    if not data_root.is_dir():
        alt = Path("E:/Scientific research 2025-2026/Linux_src_2/NCKH_25-26") / args.data_root
        if alt.is_dir():
            data_root = alt
        else:
            print(f"Lỗi: Không tìm thấy data-root tại {data_root}")
            sys.exit(1)

    meta_df = load_metadata(Path(args.metadata))
    asd_subs, typ_subs, subject_info = collect_subjects(data_root, meta_df, args.age_filter)

    print("=" * 70)
    print("TẠO TẬP CHIA TRAIN/VAL/TEST SẠCH RÒ RỈ - KINECT25_ASD")
    print("=" * 70)
    print(f"Data root: {data_root}")
    print(f"Cấu hình tuổi: {args.age_filter} ({'Lọc Typical >= 5 tuổi' if args.age_filter == 'ge5' else 'Tất cả độ tuổi'})")
    print(f"Số subject ASD sạch: {len(asd_subs)}")
    print(f"Số subject Typical sạch: {len(typ_subs)}")
    print(f"Tổng số subject: {len(asd_subs) + len(typ_subs)}")

    # Chia train/val/test cho từng nhóm
    asd_tr, asd_va, asd_te = split_subjects_stratified(
        asd_subs, "ASD", args.train_ratio, args.val_ratio, args.seed
    )
    typ_tr, typ_va, typ_te = split_subjects_stratified(
        typ_subs, "Typical", args.train_ratio, args.val_ratio, args.seed
    )

    splits_subjects = {
        "train": sorted(asd_tr + typ_tr),
        "val": sorted(asd_va + typ_va),
        "test": sorted(asd_te + typ_te),
    }

    # Gom toàn bộ samples
    all_samples: List[dict] = []
    for split_name in ("train", "val", "test"):
        for sid in splits_subjects[split_name]:
            info = subject_info[sid]
            smps = collect_samples_for_subject(
                data_root, info["label_name"], info["raw_id"], sid, split_name
            )
            all_samples.extend(smps)

    # Thống kê nhân khẩu học từng split
    demographics = {}
    print("\nThống kê phân bố theo split:")
    print(f"{'Split':<8} | {'ASD sub':<8} {'ASD clip':<9} {'Typ sub':<8} {'Typ clip':<9} | {'Tuổi ASD (mean)':<16} {'Tuổi Typ (mean)':<16}")
    print("-" * 75)
    for sp in ("train", "val", "test"):
        sp_subs = splits_subjects[sp]
        sp_asd = [s for s in sp_subs if s.startswith("ASD_")]
        sp_typ = [s for s in sp_subs if s.startswith("Typical_")]

        sp_samples = [s for s in all_samples if s["split"] == sp]
        asd_clips = len([s for s in sp_samples if s["label"] == 1])
        typ_clips = len([s for s in sp_samples if s["label"] == 0])

        asd_ages = [subject_info[s]["age"] for s in sp_asd]
        typ_ages = [subject_info[s]["age"] for s in sp_typ]

        mean_asd_age = sum(asd_ages) / len(asd_ages) if asd_ages else 0.0
        mean_typ_age = sum(typ_ages) / len(typ_ages) if typ_ages else 0.0

        print(f"{sp:<8} | {len(sp_asd):<8} {asd_clips:<9} {len(sp_typ):<8} {typ_clips:<9} | {mean_asd_age:<16.2f} {mean_typ_age:<16.2f}")

        demographics[sp] = {
            "n_subjects": len(sp_subs),
            "n_samples": len(sp_samples),
            "asd_subjects": len(sp_asd),
            "asd_samples": asd_clips,
            "typical_subjects": len(sp_typ),
            "typical_samples": typ_clips,
            "asd_age_mean": round(mean_asd_age, 2),
            "typical_age_mean": round(mean_typ_age, 2),
        }

    # Xuất file JSON
    out_name = (
        args.output
        if args.output
        else f"splits_kinect_clean_{args.age_filter}_seed{args.seed}.json"
    )
    out_path = Path(out_name)
    if not out_path.is_absolute():
        out_path = Path.cwd() / out_path

    doc = {
        "metadata": {
            "created_at": datetime.now().isoformat(),
            "source_dataset": "Datas/Kinect25_ASD/Kinect25_ASD_NoVideos",
            "age_filter": args.age_filter,
            "seed": args.seed,
            "train_ratio": args.train_ratio,
            "val_ratio": args.val_ratio,
            "test_ratio": args.test_ratio,
            "dropped_duplicates": [f"{k[0]}_{k[1]}" for k in sorted(KINECT_DUP_DROP)],
            "dropped_broken": [f"{k[0]}_{k[1]}" for k in sorted(KINECT_BROKEN)],
            "demographics": demographics,
        },
        "subjects": splits_subjects,
        "subject_info": subject_info,
        "samples": all_samples,
    }

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)

    print("-" * 75)
    print(f"Đã lưu file split thành công tại: {out_path}")
    print(f"Tổng số mẫu trong JSON: {len(all_samples)}")


if __name__ == "__main__":
    main()
