#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Script chẩn đoán chi tiết một lần chạy huấn luyện ST-GCN.

Tính năng:
1. Tự động tìm thư mục experiment mới nhất trong Training_logs/
2. Đọc checkpoint best_model.pth và phân tích lịch sử training (phát hiện overfit).
3. Đánh giá lại trên Val và Test với xác suất mềm Softmax:
   - Tính ROC-AUC trên Val và Test.
   - Thử nghiệm dải ngưỡng quyết định (threshold sweeping).
   - Tối ưu hóa ngưỡng Youden Index trên Val và áp dụng lên Test.
4. Phân tích cấp độ từng Trẻ (Subject-Level Aggregation):
   - Đánh giá theo đa số phiếu / trung bình xác suất của 8 clip mỗi trẻ.
   - Xuất bảng chi tiết 12 trẻ tập Test để tìm ra chính xác trẻ nào bị đoán sai và vì sao.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import numpy as np
import pandas as pd
import torch
import torch.nn.functional as F
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from torch.utils.data import DataLoader

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from ULTIMATE_FINAL_TRAINING_ROUND import (
    Config,
    DynamicFeaturesProcessor,
    Kinect2DNormalizedDataset,
    SampleInfo,
    SplitSets,
    ST_GCN,
    Graph,
    build_index,
    collate_fixedlen,
)


def find_latest_experiment(log_root: Path) -> Path:
    """Tìm experiment mới nhất trong log_root."""
    candidates = []
    for exp_dir in log_root.rglob("*"):
        if exp_dir.is_dir() and (exp_dir / "checkpoints/best_model.pth").is_file():
            candidates.append(exp_dir)
    if not candidates:
        raise FileNotFoundError(f"Không tìm thấy checkpoint best_model.pth nào trong {log_root}")
    candidates.sort(key=lambda p: (p / "checkpoints/best_model.pth").stat().st_mtime, reverse=True)
    return candidates[0]


def parse_args():
    parser = argparse.ArgumentParser(description="Chẩn đoán kết quả huấn luyện ST-GCN")
    parser.add_argument(
        "--exp-dir",
        type=str,
        default=None,
        help="Thư mục experiment cần kiểm tra (mặc định lấy cái mới nhất)",
    )
    parser.add_argument(
        "--log-root",
        type=str,
        default="Training_logs/experiments_STGCN_Normalizations",
        help="Thư mục chứa các experiment",
    )
    parser.add_argument(
        "--data-root",
        type=str,
        default="Datas/Kinect25_ASD/Kinect25_ASD_NoVideos",
        help="Đường dẫn dữ liệu Kinect",
    )
    parser.add_argument(
        "--splits",
        type=str,
        default=None,
        help="File splits.json (nếu trong config không có hoặc muốn đổi)",
    )
    parser.add_argument(
        "--device",
        type=str,
        default="cuda" if torch.cuda.is_available() else "cpu",
        help="cuda hoặc cpu",
    )
    return parser.parse_args()


def load_checkpoint_and_config(ckpt_path: Path):
    checkpoint = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    cfg_dict = checkpoint.get("config", {})
    cfg = Config()
    for k, v in cfg_dict.items():
        setattr(cfg, k, v)
    return checkpoint, cfg


def evaluate_dataset(model, dataset, processor, device, batch_size=48):
    """Chạy suy luận lấy xác suất mềm softmax cho từng mẫu."""
    loader = DataLoader(
        dataset,
        batch_size=batch_size,
        shuffle=False,
        collate_fn=collate_fixedlen,
    )
    model.eval()
    all_probs = []
    all_preds = []
    all_targets = []
    all_subject_ids = []
    all_loss = []
    criterion = torch.nn.CrossEntropyLoss()

    with torch.no_grad():
        for batch in loader:
            x = processor.process_batch(batch).to(device)
            y = batch["label"].to(device)
            outputs = model(x)
            loss = criterion(outputs, y)
            probs = F.softmax(outputs, dim=1)[:, 1]  # P(ASD)
            _, preds = torch.max(outputs, 1)

            all_probs.extend(probs.cpu().numpy())
            all_preds.extend(preds.cpu().numpy())
            all_targets.extend(y.cpu().numpy())
            if "subject_id" in batch:
                all_subject_ids.extend(batch["subject_id"])
            all_loss.append(loss.item())

    return {
        "probs": np.array(all_probs),
        "preds": np.array(all_preds),
        "targets": np.array(all_targets),
        "subject_ids": all_subject_ids,
        "mean_loss": np.mean(all_loss),
    }


def analyze_thresholds(y_true, y_probs, val_y_true=None, val_y_probs=None):
    """Tính các chỉ số ở nhiều ngưỡng khác nhau và tìm ngưỡng Youden tối ưu."""
    results = []
    thresholds = [0.20, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.70]
    
    # Tìm ngưỡng Youden tối ưu trên tập Val nếu có
    optimal_th = 0.50
    if val_y_true is not None and val_y_probs is not None:
        best_j = -1.0
        for th in np.linspace(0.1, 0.9, 81):
            pred = (val_y_probs >= th).astype(int)
            sens = recall_score(val_y_true, pred, zero_division=0)
            tn, fp, fn, tp = confusion_matrix(val_y_true, pred, labels=[0, 1]).ravel()
            spec = tn / (tn + fp) if (tn + fp) > 0 else 0.0
            j = sens + spec - 1.0
            if j > best_j:
                best_j = j
                optimal_th = float(th)

    if optimal_th not in thresholds:
        thresholds.append(optimal_th)
    thresholds.sort()

    for th in thresholds:
        pred = (y_probs >= th).astype(int)
        acc = accuracy_score(y_true, pred)
        prec = precision_score(y_true, pred, zero_division=0)
        rec = recall_score(y_true, pred, zero_division=0)
        f1 = f1_score(y_true, pred, zero_division=0)
        tn, fp, fn, tp = confusion_matrix(y_true, pred, labels=[0, 1]).ravel()
        spec = tn / (tn + fp) if (tn + fp) > 0 else 0.0
        results.append({
            "threshold": round(th, 3),
            "acc": round(acc, 4),
            "prec": round(prec, 4),
            "recall": round(rec, 4),
            "spec": round(spec, 4),
            "f1": round(f1, 4),
            "cm": f"[[{tn} {fp}] [{fn} {tp}]]",
            "is_optimal_val": (abs(th - optimal_th) < 1e-4),
        })

    return results, optimal_th


def main():
    args = parse_args()

    # 1. Xác định thư mục experiment
    if args.exp_dir:
        exp_dir = Path(args.exp_dir)
    else:
        log_root = Path(args.log_root)
        if not log_root.is_dir():
            alt = _HERE / args.log_root
            if alt.is_dir():
                log_root = alt
            else:
                print(f"Lỗi: Không tìm thấy thư mục log tại {log_root}")
                sys.exit(1)
        exp_dir = find_latest_experiment(log_root)

    print("=" * 75)
    print(f"CHẨN ĐOÁN CHI TIẾT EXPERIMENT: {exp_dir.name}")
    print("=" * 75)

    ckpt_path = exp_dir / "checkpoints/best_model.pth"
    checkpoint, cfg = load_checkpoint_and_config(ckpt_path)

    # Ghi đè cấu hình nếu CLI có truyền
    if args.data_root:
        cfg.data_root = args.data_root
    if args.splits:
        cfg.splits = args.splits

    # Kiểm tra splits
    splits_file = getattr(cfg, "splits", None)
    print(f"Cấu hình model:")
    print(f"  - Normalization: {cfg.normalization}")
    print(f"  - Remove head/neck (17 joints): {cfg.remove_head_neck}")
    print(f"  - Virtual camera (Hướng 1): {getattr(cfg, 'virtual_camera', False)}")
    print(f"  - Invariant features (Hướng 2): {getattr(cfg, 'invariant_features', None)}")
    print(f"  - Splits file: {splits_file}")
    print(f"  - Best model lưu tại epoch: {checkpoint.get('epoch', 'N/A')}")
    print(f"  - Best Val Acc trong checkpoint: {checkpoint.get('best_val_acc', 0.0):.4f}")
    print(f"  - Best Val F1 trong checkpoint: {checkpoint.get('best_val_f1', 0.0):.4f}")

    # 2. Phân tích đường cong huấn luyện (Overfit check)
    hist = checkpoint.get("history", {})
    if hist and "train_loss" in hist and len(hist["train_loss"]) > 0:
        total_epochs = len(hist["train_loss"])
        best_ep = checkpoint.get("epoch", total_epochs)
        print(f"\nPhân tích lịch sử Training ({total_epochs} epochs):")
        print(f"  - Epoch 1       : Train Loss = {hist['train_loss'][0]:.4f}, Val Loss = {hist['val_loss'][0]:.4f}")
        print(f"  - Epoch {best_ep:<7} (Best): Train Loss = {hist['train_loss'][best_ep-1]:.4f}, Val Loss = {hist['val_loss'][best_ep-1]:.4f}, Val Acc = {hist['val_acc'][best_ep-1]:.4f}")
        print(f"  - Epoch {total_epochs:<7} (Cuối): Train Loss = {hist['train_loss'][-1]:.4f}, Val Loss = {hist['val_loss'][-1]:.4f}, Val Acc = {hist['val_acc'][-1]:.4f}")
        loss_gap = hist["val_loss"][-1] - hist["train_loss"][-1]
        print(f"  - Chênh lệch Val Loss - Train Loss ở cuối: {loss_gap:.4f}")
        if loss_gap > 0.4:
            print("  ⚠️ CẢNH BÁO: Hiện tượng Overfitting mạnh (Val loss tăng cao trong khi Train loss giảm thấp).")

    # 3. Nạp dữ liệu và kiểm tra trên tập Val & Test
    print(f"\nĐang nạp dữ liệu và chạy suy luận mềm...")
    data_root = Path(cfg.data_root)
    if not data_root.is_dir():
        alt = _HERE / cfg.data_root
        if alt.is_dir():
            data_root = alt
        else:
            print(f"Lỗi: Không tìm thấy data-root tại {data_root}")
            sys.exit(1)

    entries = build_index(data_root)

    # Đọc split
    splits_path = Path(splits_file) if splits_file else None
    if splits_path and not splits_path.is_file():
        alt = _HERE / splits_path
        if alt.is_file():
            splits_path = alt

    if not splits_path or not splits_path.is_file():
        print(f"Lỗi: Không tìm thấy file split: {splits_file}")
        sys.exit(1)

    with open(splits_path, "r", encoding="utf-8") as f:
        split_doc = json.load(f)

    sample_split_map = {
        Path(s["path"]).as_posix().lower(): (s["split"], s.get("subject_id", "unknown"))
        for s in split_doc.get("samples", [])
    }

    train_idx, val_idx, test_idx = [], [], []
    val_sub_ids, test_sub_ids = [], []
    for i, e in enumerate(entries):
        try:
            rel = e.path_2d.relative_to(data_root).as_posix().lower()
        except ValueError:
            rel = e.path_2d.as_posix().lower()
        if rel in sample_split_map:
            sp, sid = sample_split_map[rel]
            if sp == "train":
                train_idx.append(i)
            elif sp == "val":
                val_idx.append(i)
                val_sub_ids.append(sid)
            elif sp == "test":
                test_idx.append(i)
                test_sub_ids.append(sid)

    # Khởi tạo model chuẩn xác theo architecture lúc train
    device = torch.device(args.device)
    num_joints = checkpoint.get("num_joints", 17 if cfg.remove_head_neck else 25)
    if num_joints == 17:
        graph = Graph(layout='kinect17')
    elif num_joints == 18:
        graph = Graph(layout='kinect23')
    else:
        graph = Graph(layout='openpose25')

    in_channels = cfg.get_effective_in_channels()
    model = ST_GCN(
        in_channels=in_channels,
        num_class=cfg.num_class,
        A=graph.A,
        edge_importance_weighting=cfg.edge_importance,
        dropout=cfg.dropout
    ).to(device)
    model.load_state_dict(checkpoint["model_state_dict"])
    processor = DynamicFeaturesProcessor(cfg)

    # Dataset Val & Test (kèm cấu hình camera ảo và invariant nếu có)
    kw_val = {'invariant_features': list(cfg.invariant_features or [])}
    kw_test = {'invariant_features': list(cfg.invariant_features or [])}
    if getattr(cfg, 'virtual_camera', False):
        if getattr(cfg, 'vcam_eval', 'virtual') == 'virtual':
            kw_val.update(virtual_camera=cfg.vcam_config, vcam_mode='fixed', vcam_seed=cfg.split_seed + 0)
            kw_test.update(virtual_camera=cfg.vcam_config, vcam_mode='fixed', vcam_seed=cfg.split_seed + 1)

    val_dataset = Kinect2DNormalizedDataset(
        entries, val_idx, L=cfg.sequence_length,
        normalization=cfg.normalization,
        remove_head_neck=cfg.remove_head_neck,
        include_dynamics=cfg.include_dynamics,
        fps=cfg.fps,
        dynamic_features=cfg.dynamic_features if cfg.include_dynamics else None,
        **kw_val
    )
    test_dataset = Kinect2DNormalizedDataset(
        entries, test_idx, L=cfg.sequence_length,
        normalization=cfg.normalization,
        remove_head_neck=cfg.remove_head_neck,
        include_dynamics=cfg.include_dynamics,
        fps=cfg.fps,
        dynamic_features=cfg.dynamic_features if cfg.include_dynamics else None,
        **kw_test
    )

    val_res = evaluate_dataset(model, val_dataset, processor, device)
    test_res = evaluate_dataset(model, test_dataset, processor, device)

    # 4. AUC và Khảo sát ngưỡng
    val_auc = roc_auc_score(val_res["targets"], val_res["probs"])
    test_auc = roc_auc_score(test_res["targets"], test_res["probs"])

    print("\n" + "=" * 75)
    print(f"KẾT QUẢ ĐÁNH GIÁ MỀM (SOFTMAX PROBABILITY):")
    print("=" * 75)
    print(f"ROC-AUC Val : {val_auc:.4f}")
    print(f"ROC-AUC Test: {test_auc:.4f}")

    th_table, opt_th = analyze_thresholds(
        test_res["targets"], test_res["probs"],
        val_res["targets"], val_res["probs"]
    )

    print(f"\nBảng khảo sát ngưỡng quyết định trên tập TEST:")
    print(f"{'Ngưỡng':<9} | {'Acc':<8} {'Prec':<8} {'Recall':<8} {'Spec':<8} {'F1':<8} | {'Confusion Matrix':<18} | {'Ghi chú'}")
    print("-" * 80)
    for row in th_table:
        note = "<- Ngưỡng tối ưu Youden từ tập Val" if row["is_optimal_val"] else ("<- Ngưỡng cứng argmax" if row["threshold"] == 0.50 else "")
        print(f"{row['threshold']:<9.3f} | {row['acc']:<8.4f} {row['prec']:<8.4f} {row['recall']:<8.4f} {row['spec']:<8.4f} {row['f1']:<8.4f} | {row['cm']:<18} | {note}")

    # 5. Phân tích chi tiết từng Trẻ trong tập Test (Subject-Level Analysis)
    print("\n" + "=" * 75)
    print(f"PHÂN TÍCH CẤP ĐỘ TỪNG TRẺ (SUBJECT-LEVEL) TRÊN TẬP TEST:")
    print("=" * 75)

    sub_info_dict = split_doc.get("subject_info", {})
    df_test = pd.DataFrame({
        "subject_id": test_sub_ids,
        "true_label": test_res["targets"],
        "prob_asd": test_res["probs"],
        "pred_hard": test_res["preds"],
        "pred_opt": (test_res["probs"] >= opt_th).astype(int),
    })

    sub_summary = []
    for sid, group in df_test.groupby("subject_id"):
        true_lbl = group["true_label"].iloc[0]
        label_str = "ASD" if true_lbl == 1 else "Typical"
        n_clips = len(group)
        mean_prob = group["prob_asd"].mean()
        correct_hard = (group["pred_hard"] == true_lbl).sum()
        correct_opt = (group["pred_opt"] == true_lbl).sum()
        sub_pred_hard = 1 if mean_prob >= 0.50 else 0
        sub_pred_opt = 1 if mean_prob >= opt_th else 0

        info = sub_info_dict.get(sid, {})
        age = info.get("age", "N/A")
        sex = info.get("sex", "N/A")

        sub_summary.append({
            "subject_id": sid,
            "label": label_str,
            "true_lbl": true_lbl,
            "age": age,
            "sex": sex,
            "mean_prob": round(mean_prob, 3),
            "clips_correct_th05": f"{correct_hard}/{n_clips}",
            "clips_correct_opt": f"{correct_opt}/{n_clips}",
            "sub_correct_th05": (sub_pred_hard == true_lbl),
            "sub_correct_opt": (sub_pred_opt == true_lbl),
        })

    sub_df = pd.DataFrame(sub_summary).sort_values(by=["true_lbl", "subject_id"], ascending=[False, True])

    print(f"{'Subject':<12} | {'Nhóm':<8} {'Tuổi':<5} {'Giới':<5} | {'Mean P(ASD)':<12} | {'Đúng (th=0.5)':<14} {'Đúng (th=opt)':<14} | {'Đoán th=0.5':<12} {'Đoán th=opt'}")
    print("-" * 95)
    for _, r in sub_df.iterrows():
        status_hard = "ĐÚNG" if r["sub_correct_th05"] else "SAI"
        status_opt = "ĐÚNG" if r["sub_correct_opt"] else "SAI"
        print(f"{r['subject_id']:<12} | {r['label']:<8} {str(r['age']):<5} {str(r['sex']):<5} | {r['mean_prob']:<12.3f} | {r['clips_correct_th05']:<14} {r['clips_correct_opt']:<14} | {status_hard:<12} {status_opt}")

    # Tổng kết Subject-level
    sub_acc_hard = sub_df["sub_correct_th05"].mean()
    sub_acc_opt = sub_df["sub_correct_opt"].mean()
    print("-" * 95)
    print(f"Độ chính xác CẤP ĐỘ TRẺ (12 trẻ):")
    print(f"  - Với ngưỡng cứng 0.50 : {sub_acc_hard * 100:.1f}% ({sub_df['sub_correct_th05'].sum()}/12 trẻ đúng)")
    print(f"  - Với ngưỡng tối ưu {opt_th:.3f}: {sub_acc_opt * 100:.1f}% ({sub_df['sub_correct_opt'].sum()}/12 trẻ đúng)")
    print("=" * 75)


if __name__ == "__main__":
    main()

