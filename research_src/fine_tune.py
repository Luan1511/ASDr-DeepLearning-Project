"""
fine_tune.py
============
Script dùng để bóc 30% data làm tập train (để fine-tune), 
và 70% data làm tập test. Sau đó fine-tune model checkpoint có sẵn.

Cách dùng:
----------
  python3 sub_phase/tools/fine_tune.py \\
      --ckpt  /home/nhomk23/workspace/NCKH_25-26/Training_logs/experiments_STGCN_Normalizations/stgcn_bbox_no_head_neck_seed42_20260428_033403/checkpoints/best_model.pth \\
      --autism-dir  sub_phase/exports_excels/Dataset_video/Autism \\
      --typical-dir sub_phase/exports_excels/Dataset_video/Typical \\
      --epochs 20 \\
      --lr 5e-5
"""

from __future__ import annotations
import sys
import argparse
from pathlib import Path
import time
from typing import Dict, List, Sequence

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader

# ── PATCH sys.argv trước khi import các script training ────────────────────────
_orig_argv = sys.argv[:]
sys.argv = sys.argv[:1]

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ULTIMATE_TRAINING_OPENPOSE_STGCN import (
    AugmentConfig,
    DEFAULT_EXCEL_REMOVED_KP,
    _apply_normalization,
    _augment_spatial,
    _augment_slicing,
    _expand_reduced_to_body25,
    _openpose25_to_kinect25,
    _parse_wide_excel,
    _resample_nearest,
    _split_paths,
    _trim_all_zero_ends,
)
from ULTIMATE_FINAL_TRAINING_ROUND import Graph, ST_GCN, compute_acceleration, compute_motion_energy, compute_velocity

sys.argv = _orig_argv

from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score


REMOVE_18_INDICES = (1, 9, 10, 11, 12, 13, 14)
REMOVE_17_INDICES = (1, 9, 10, 11, 12, 13, 14, 15)


def _reduce_kinect25(seq: np.ndarray, keypoints: int) -> np.ndarray:
    if keypoints == 25:
        return seq
    if keypoints == 18:
        remove = set(REMOVE_18_INDICES)
    elif keypoints == 17:
        remove = set(REMOVE_17_INDICES)
    else:
        raise ValueError(f"Unsupported keypoints: {keypoints}")
    keep = [idx for idx in range(seq.shape[1]) if idx not in remove]
    return seq[:, keep, :]


class FineTuneExcelDataset(Dataset):
    def __init__(
        self,
        paths: Sequence[Path],
        labels: Sequence[int],
        seq_len: int,
        normalization: str,
        keypoints: int,
        include_dynamics: bool,
        dynamic_features: Sequence[str],
        fps: float,
        train: bool,
        augment: AugmentConfig,
        seed: int,
    ) -> None:
        self.paths = list(paths)
        self.labels = list(labels)
        self.seq_len = int(seq_len)
        self.normalization = str(normalization)
        self.keypoints = int(keypoints)
        if self.keypoints not in (17, 18, 25):
            raise ValueError(f"keypoints must be 17, 18 or 25, got {self.keypoints}")
        self.include_dynamics = bool(include_dynamics)
        self.dynamic_features = [str(s) for s in dynamic_features]
        self.fps = float(fps)
        self.train = bool(train)
        self.augment = augment
        self.seed = int(seed)

    def __len__(self) -> int:
        return len(self.paths)

    def _build_channels(self, seq: np.ndarray) -> np.ndarray:
        feats: List[np.ndarray] = [seq]
        if self.include_dynamics:
            dyn = {s.lower().strip() for s in self.dynamic_features}
            if "velocity" in dyn:
                feats.append(compute_velocity(seq, fps=self.fps))
            if "acceleration" in dyn:
                feats.append(compute_acceleration(seq, fps=self.fps))
            if "motion_energy" in dyn:
                feats.append(compute_motion_energy(seq, fps=self.fps)[:, :, None])

        x = np.concatenate(feats, axis=2)
        return np.transpose(x, (2, 0, 1))

    def __getitem__(self, idx: int) -> Dict[str, torch.Tensor]:
        path = self.paths[idx]
        y = int(self.labels[idx])

        xy, _conf = _parse_wide_excel(path, include_score=False)
        xy = xy.astype(np.float32)
        xy = _trim_all_zero_ends(xy)

        if xy.shape[1] == 17:
            xy = _expand_reduced_to_body25(xy, DEFAULT_EXCEL_REMOVED_KP)
        if xy.shape[1] != 25:
            raise ValueError(f"Expected 25 (or reduced 17) joints in {path}, got {xy.shape}")

        xy = _openpose25_to_kinect25(xy)
        xy = _reduce_kinect25(xy, self.keypoints)

        rng = np.random.default_rng(self.seed + idx)
        if self.train:
            xy = _augment_slicing(xy, rng, self.augment)
        xy = _resample_nearest(xy, self.seq_len)
        xy = _apply_normalization(xy, self.normalization)
        if self.train:
            xy = _augment_spatial(xy, rng, self.augment)

        x = self._build_channels(xy)
        return {"x": torch.from_numpy(x).float(), "y": torch.tensor(y, dtype=torch.long)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True, help="Đường dẫn đến best_model.pth cần fine-tune")
    ap.add_argument("--autism-dir", default="sub_phase/exports_excels/Dataset_video/Autism")
    ap.add_argument("--typical-dir", default="sub_phase/exports_excels/Dataset_video/Typical")
    ap.add_argument("--train-ratio", type=float, default=0.3, help="Tỉ lệ data dùng để fine-tune")
    ap.add_argument("--val-ratio", type=float, default=0.0, help="Tỉ lệ validation (mặc định 0.0)")
    ap.add_argument("--epochs", type=int, default=20, help="Số epoch để fine-tune")
    ap.add_argument("--lr", type=float, default=5e-5, help="Learning rate cho fine-tune")
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--device", default="auto")
    ap.add_argument("--out-dir", default="Training_logs/finetuned_models", help="Thư mục lưu model fine-tune")
    args = ap.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu") if args.device == "auto" else torch.device(args.device)
    print(f"🖥  Device: {device}")

    # 1. Load checkpoint và config
    ckpt_path = Path(args.ckpt)
    if not ckpt_path.exists():
        print(f"❌ Không tìm thấy checkpoint: {ckpt_path}")
        sys.exit(1)
        
    print(f"📦 Đang load checkpoint: {ckpt_path.name}...")
    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    cfg_dict = ckpt["config"]
    num_joints = int(ckpt.get("num_joints") or ckpt["model_state_dict"]["A"].shape[-1])
    if num_joints not in (17, 18, 25):
        print(f"❌ Checkpoint dùng số joints không hỗ trợ: {num_joints}")
        sys.exit(1)
    print(f"🔎 Checkpoint expects {num_joints} joints")
    
    # 2. Chuẩn bị dữ liệu
    print("📁 Đang chuẩn bị dữ liệu...")
    autism_paths = sorted([p for p in Path(args.autism_dir).glob("*.xlsx") if p.is_file()])
    typical_paths = sorted([p for p in Path(args.typical_dir).glob("*.xlsx") if p.is_file()])
    
    if not autism_paths or not typical_paths:
        print("❌ Không tìm thấy file dữ liệu (.xlsx). Vui lòng kiểm tra lại đường dẫn.")
        sys.exit(1)
        
    seed = 44
    splits = _split_paths(
        autism_paths, typical_paths, 
        seed=seed, 
        train_ratio=args.train_ratio, 
        val_ratio=args.val_ratio
    )
    
    train_paths, train_labels = splits["train"]
    test_paths, test_labels = splits["test"]
    
    print(f"📊 Phân chia tập dữ liệu (Train {args.train_ratio*100:.0f}% / Test {(1-args.train_ratio-args.val_ratio)*100:.0f}%):")
    print(f"   Train size: {len(train_paths)}")
    print(f"   Test size:  {len(test_paths)}")
    
    aug = AugmentConfig()
    dyn_feats = cfg_dict.get("dynamic_features", [])
    if isinstance(dyn_feats, str): dyn_feats = [dyn_feats]

    kps = num_joints
        
    train_ds = FineTuneExcelDataset(
        train_paths, train_labels,
        seq_len=int(cfg_dict.get("seq_len", 128)),
        normalization=str(cfg_dict.get("normalization", "original")),
        keypoints=kps,
        include_dynamics=bool(cfg_dict.get("include_dynamics", False)),
        dynamic_features=list(dyn_feats),
        fps=float(cfg_dict.get("fps", 30.0)),
        train=True, augment=aug, seed=seed
    )
    
    test_ds = FineTuneExcelDataset(
        test_paths, test_labels,
        seq_len=int(cfg_dict.get("seq_len", 128)),
        normalization=str(cfg_dict.get("normalization", "original")),
        keypoints=kps,
        include_dynamics=bool(cfg_dict.get("include_dynamics", False)),
        dynamic_features=list(dyn_feats),
        fps=float(cfg_dict.get("fps", 30.0)),
        train=False, augment=aug, seed=seed
    )
    
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True, num_workers=0)
    test_loader = DataLoader(test_ds, batch_size=args.batch_size, shuffle=False, num_workers=0)
    
    # 3. Build model
    sample_x = train_ds[0]["x"]
    in_channels = int(sample_x.shape[0])
    
    layout = {17: "kinect17", 18: "kinect23", 25: "openpose25"}[kps]
    if ckpt.get("layout"):
        layout = ckpt["layout"]
    
    graph = Graph(layout=layout)
    model = ST_GCN(
        in_channels=in_channels,
        num_class=2,
        A=graph.A,
        edge_importance_weighting=True,
        dropout=float(cfg_dict.get("dropout", 0.3))
    )
    
    # Nạp weights từ checkpoint
    model.load_state_dict(ckpt["model_state_dict"])
    model.to(device)
    
    # 4. Optimizer & Loss
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    loss_fn = nn.CrossEntropyLoss()
    
    # Đánh giá trước khi fine-tune
    print("\n🔍 Đánh giá model trên Test Set TRƯỚC KHI fine-tune...")
    evaluate(model, test_loader, device)

    # 5. Training loop
    print("\n🚀 BẮT ĐẦU FINE-TUNE...")
    best_test_acc = 0.0
    best_state = None
    
    for epoch in range(1, args.epochs + 1):
        model.train()
        total_loss = 0.0
        
        for batch in train_loader:
            x, y = batch["x"].to(device), batch["y"].to(device)
            optimizer.zero_grad()
            logits = model(x)
            loss = loss_fn(logits, y)
            loss.backward()
            optimizer.step()
            total_loss += loss.item() * x.size(0)
            
        avg_train_loss = total_loss / len(train_ds)
        
        # Đánh giá test set sau mỗi epoch
        test_metrics = evaluate(model, test_loader, device, verbose=False)
        test_acc = test_metrics["acc"]
        
        print(f"Epoch {epoch:2d}/{args.epochs:2d} | Train Loss: {avg_train_loss:.4f} | Test Acc: {test_acc*100:.2f}% | Test F1: {test_metrics['f1']*100:.2f}%")
        
        if test_acc > best_test_acc:
            best_test_acc = test_acc
            best_state = {
                "epoch": epoch,
                "model_state_dict": model.state_dict(),
                "config": cfg_dict,
                "in_channels": in_channels,
                "layout": layout,
                "test_metrics": test_metrics
            }
            
    # 6. Lưu kết quả
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    save_path = out_dir / f"finetuned_{ckpt_path.name}"
    
    if best_state:
        torch.save(best_state, save_path)
        print(f"\n💾 Đã lưu best fine-tuned model (Test Acc: {best_test_acc*100:.2f}%) tại:")
        print(f"   {save_path}")
        print("\n🔍 Đánh giá chi tiết model SAU KHI fine-tune (Best Epoch):")
        model.load_state_dict(best_state["model_state_dict"])
        evaluate(model, test_loader, device, verbose=True)


@torch.no_grad()
def evaluate(model, loader, device, verbose=True):
    model.eval()
    y_true, y_pred = [], []
    for batch in loader:
        x, y = batch["x"].to(device), batch["y"].cpu().numpy()
        logits = model(x)
        preds = torch.argmax(logits, dim=1).cpu().numpy()
        y_true.extend(y.tolist())
        y_pred.extend(preds.tolist())
        
    y_true, y_pred = np.array(y_true), np.array(y_pred)
    acc = accuracy_score(y_true, y_pred)
    pre = precision_score(y_true, y_pred, average="macro", zero_division=0)
    rec = recall_score(y_true, y_pred, average="macro", zero_division=0)
    f1 = f1_score(y_true, y_pred, average="macro", zero_division=0)
    
    if verbose:
        print(f"   Accuracy : {acc*100:.2f}%")
        print(f"   Precision: {pre*100:.2f}%")
        print(f"   Recall   : {rec*100:.2f}%")
        print(f"   F1-Score : {f1*100:.2f}%")
        
    return {"acc": acc, "pre": pre, "rec": rec, "f1": f1}


if __name__ == "__main__":
    main()
