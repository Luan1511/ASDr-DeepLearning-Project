"""
fine_tune.py
============
Fine-tune một checkpoint ST-GCN có sẵn trên dữ liệu OpenPose (wide Excel,
`Dataset_video/{Autism,Typical}`).

Giai đoạn 2 — đánh giá lại model (xem research_src/EVALUATION.md):
  * Khuyến nghị: `--splits splits.json` (tạo bằng `calibrate_evaluate.py split`),
    chia theo SUBJECT: train để fine-tune, val để chọn epoch, test chỉ được
    đánh giá MỘT lần ở cuối với trọng số đã chọn.
  * Không có `--splits` (tương thích ngược): giữ split cũ `_split_paths`
    (seed 44, `--train-ratio` cho train, phần còn lại là test), rồi tách một
    tập validation stratified theo subject TỪ tập train (`--val-ratio`, mặc
    định 0.2 số subject của train; subject id lấy từ tên file qua
    `--subject-regex`). Lưu ý: trước đây `--val-ratio` là tỉ lệ trên toàn bộ
    data (mặc định 0.0, và tập val không hề được dùng).
  * Chọn epoch tốt nhất theo MACRO-F1 TRÊN VAL (hòa thì val loss thấp hơn, vẫn
    hòa thì giữ epoch sớm hơn). Epoch 0 (checkpoint gốc) cũng là một ứng viên.
  * Checkpoint lưu thêm `num_joints`; `test_results.json` được ghi cạnh checkpoint.
  * Sửa lỗi: bản cũ giữ `model.state_dict()` (tham chiếu tới tensor đang train)
    nên "best model" thực chất là trọng số của epoch CUỐI.

Lưu ý: metric trong script này dùng tiền xử lý của pipeline training (resample
nearest TRƯỚC chuẩn hóa), tính theo FILE, ngưỡng argmax — KHÁC server deploy.
Số liệu báo cáo phải lấy từ `predict_dataset.py` + `calibrate_evaluate.py evaluate`.

Cách dùng:
----------
  # Khuyến nghị: split theo subject
  python3 sub_phase/tools/fine_tune.py \\
      --ckpt   /home/nhomk23/workspace/NCKH_25-26/Training_logs/experiments_STGCN_Normalizations/stgcn_bbox_no_head_neck_seed42_20260428_033403/checkpoints/best_model.pth \\
      --splits /path/to/eval_run/splits.json \\
      --epochs 20 \\
      --lr 5e-5 \\
      --out-dir /path/to/eval_run/finetuned

  # Tương thích ngược (không có splits.json)
  python3 sub_phase/tools/fine_tune.py \\
      --ckpt  /home/nhomk23/workspace/NCKH_25-26/Training_logs/experiments_STGCN_Normalizations/stgcn_bbox_no_head_neck_seed42_20260428_033403/checkpoints/best_model.pth \\
      --autism-dir  sub_phase/exports_excels/Dataset_video/Autism \\
      --typical-dir sub_phase/exports_excels/Dataset_video/Typical \\
      --epochs 20 \\
      --lr 5e-5

  calibrate_evaluate.py phải nằm cùng thư mục với fine_tune.py.
"""

from __future__ import annotations
import sys
import argparse
import json
from datetime import datetime
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

from sklearn.metrics import accuracy_score, confusion_matrix, precision_score, recall_score, f1_score

# Phase 2: shared subject-level split helpers (calibrate_evaluate.py must sit next to this file).
_THIS_DIR = Path(__file__).resolve().parent
if str(_THIS_DIR) not in sys.path:
    sys.path.insert(0, str(_THIS_DIR))
try:
    import calibrate_evaluate as ce
except ImportError as _e:  # pragma: no cover - deployment error
    raise SystemExit("❌ Cần đặt calibrate_evaluate.py cùng thư mục với fine_tune.py") from _e


REMOVE_18_INDICES = (1, 9, 10, 11, 12, 13, 14)
REMOVE_17_INDICES = (1, 9, 10, 11, 12, 13, 14, 15)

SPLITS = ("train", "val", "test")
SELECTION_METRIC = "val_macro_f1"  # tie -> lower val loss -> earlier epoch


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


# ── Phase 2: data splits ───────────────────────────────────────────────────────


def _data_from_splits_file(splits_path: Path) -> Dict:
    """train/val/test file lists from a subject-level splits.json."""
    doc = ce.load_splits(splits_path)  # validates: no subject in two splits
    data = {name: ([], []) for name in SPLITS}
    subjects = {name: set() for name in SPLITS}
    non_excel: List[str] = []
    for s in doc["samples"]:
        p = Path(s["path"])
        if p.suffix.lower() != ".xlsx":
            non_excel.append(str(p))
            continue
        data[s["split"]][0].append(p)
        data[s["split"]][1].append(int(s["label"]))
        subjects[s["split"]].add(str(s["subject_id"]))
    if non_excel:
        print(f"❌ fine_tune.py chỉ đọc wide Excel (.xlsx); splits.json có {len(non_excel)} mẫu khác, ví dụ: {non_excel[:3]}")
        sys.exit(1)
    missing = [str(p) for name in SPLITS for p in data[name][0] if not p.is_file()]
    if missing:
        print(f"❌ Không tìm thấy {len(missing)} file trong splits.json, ví dụ: {missing[:3]}")
        sys.exit(1)
    return {
        **data,
        "subjects": {name: sorted(v) for name, v in subjects.items()},
        "source": f"splits.json: {Path(splits_path).resolve()}",
    }


def _data_from_legacy_split(args, seed: int) -> Dict:
    """Legacy file split (train/test) + a stratified subject-level val carved out of TRAIN."""
    autism_paths = sorted([p for p in Path(args.autism_dir).glob("*.xlsx") if p.is_file()])
    typical_paths = sorted([p for p in Path(args.typical_dir).glob("*.xlsx") if p.is_file()])

    if not autism_paths or not typical_paths:
        print("❌ Không tìm thấy file dữ liệu (.xlsx). Vui lòng kiểm tra lại đường dẫn.")
        sys.exit(1)
    if not 0.0 < args.val_ratio < 1.0:
        print("❌ --val-ratio phải nằm trong (0, 1): cần tập validation để chọn epoch (hoặc dùng --splits).")
        sys.exit(1)

    # Same legacy call (seed 44 by default) but val_ratio=0.0: the validation set
    # is now carved out of the TRAIN subjects below, so the legacy test set is unchanged.
    splits = _split_paths(
        autism_paths, typical_paths,
        seed=seed,
        train_ratio=args.train_ratio,
        val_ratio=0.0
    )
    train_paths, train_labels = splits["train"]
    test_paths, test_labels = splits["test"]

    rx = ce.compile_subject_regex(args.subject_regex)

    def subject_of(p) -> str:
        # Same convention as `calibrate_evaluate.py split --root`:
        # <ClassFolder>/<regex group 1 of the file name without extension>
        p = Path(p)
        return f"{p.parent.name}/{ce.extract_subject_id(ce.subject_match_name(p.name, True), rx)}"

    train_sids = [subject_of(p) for p in train_paths]
    labels_by_subject = ce.subject_labels(
        [{"subject_id": s, "label": int(y)} for s, y in zip(train_sids, train_labels)]
    )
    assignment = ce.stratified_subject_split(
        labels_by_subject, ratios=(1.0 - args.val_ratio, args.val_ratio, 0.0), seed=seed
    )
    val_subjects = set(assignment["val"])

    data = {name: ([], []) for name in SPLITS}
    for p, y, sid in zip(train_paths, train_labels, train_sids):
        name = "val" if sid in val_subjects else "train"
        data[name][0].append(Path(p))
        data[name][1].append(int(y))
    data["test"] = ([Path(p) for p in test_paths], [int(y) for y in test_labels])

    test_sids = [subject_of(p) for p in test_paths]
    overlap = sorted(set(train_sids) & set(test_sids))
    if overlap:
        print(f"⚠️  {len(overlap)} subject có file ở cả train/val và test (split cũ chia theo FILE?) "
              f"→ số liệu test bị rò rỉ, nên dùng --splits. Ví dụ: {overlap[:5]}")
    return {
        **data,
        "subjects": {
            "train": sorted(set(train_sids) - val_subjects),
            "val": sorted(val_subjects),
            "test": sorted(set(test_sids)),
        },
        "source": (f"legacy _split_paths(seed={seed}, train_ratio={args.train_ratio}) + val carved from "
                   f"train subjects (val_ratio={args.val_ratio}, subject_regex={args.subject_regex!r})"),
    }


def _snapshot_state(model: nn.Module) -> Dict[str, torch.Tensor]:
    # model.state_dict() returns tensors that SHARE storage with the live parameters
    # (they keep changing while training continues): clone to freeze this epoch.
    return {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}


def _is_better(new: Dict, best: Dict) -> bool:
    """Selection rule: higher val macro-F1; tie -> lower val loss; still tied -> keep earlier epoch."""
    if new["f1"] != best["f1"]:
        return new["f1"] > best["f1"]
    return new.get("loss", float("inf")) < best.get("loss", float("inf"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True, help="Đường dẫn đến best_model.pth cần fine-tune")
    ap.add_argument("--splits", default=None,
                    help="splits.json (calibrate_evaluate.py split): train/val/test theo subject. "
                         "Khi có, bỏ qua --autism-dir/--typical-dir/--train-ratio/--val-ratio/--subject-regex")
    ap.add_argument("--autism-dir", default="sub_phase/exports_excels/Dataset_video/Autism")
    ap.add_argument("--typical-dir", default="sub_phase/exports_excels/Dataset_video/Typical")
    ap.add_argument("--train-ratio", type=float, default=0.3,
                    help="(Không có --splits) tỉ lệ data dùng để fine-tune (train + val); phần còn lại là test")
    ap.add_argument("--val-ratio", type=float, default=0.2,
                    help="(Không có --splits) tỉ lệ SUBJECT của tập train tách ra làm validation (stratified). "
                         "Trước đây là tỉ lệ trên toàn bộ data, mặc định 0.0")
    ap.add_argument("--subject-regex", default=ce.DEFAULT_SUBJECT_REGEX,
                    help="(Không có --splits) regex lấy subject id từ tên file đã bỏ đuôi (nhóm bắt đầu tiên). "
                         "Mặc định: cả tên file, vd. video_12.xlsx -> video_12")
    ap.add_argument("--seed", type=int, default=44, help="Seed cho split, tách val, augmentation và torch")
    ap.add_argument("--epochs", type=int, default=20, help="Số epoch để fine-tune")
    ap.add_argument("--lr", type=float, default=5e-5, help="Learning rate cho fine-tune")
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--device", default="auto")
    ap.add_argument("--out-dir", default="Training_logs/finetuned_models", help="Thư mục lưu model fine-tune")
    args = ap.parse_args()

    # Reproducibility: DataLoader shuffling and dropout use the torch RNG.
    seed = int(args.seed)
    torch.manual_seed(seed)
    np.random.seed(seed)

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

    # 2. Chuẩn bị dữ liệu (Phase 2: train / val / test, val dùng để chọn epoch)
    print("📁 Đang chuẩn bị dữ liệu...")
    if args.splits:
        data = _data_from_splits_file(Path(args.splits))
    else:
        data = _data_from_legacy_split(args, seed)

    train_paths, train_labels = data["train"]
    val_paths, val_labels = data["val"]
    test_paths, test_labels = data["test"]
    subjects = data["subjects"]
    for name in SPLITS:
        if not data[name][0]:
            print(f"❌ Tập {name} rỗng — kiểm tra splits.json / --train-ratio / --val-ratio.")
            sys.exit(1)

    print(f"📊 Phân chia tập dữ liệu ({data['source']}):")
    for name, paths in (("Train", train_paths), ("Val", val_paths), ("Test", test_paths)):
        print(f"   {name + ':':<6} {len(paths):4d} file / {len(subjects[name.lower()]):3d} subject")

    aug = AugmentConfig()
    dyn_feats = cfg_dict.get("dynamic_features", [])
    if isinstance(dyn_feats, str): dyn_feats = [dyn_feats]

    kps = num_joints

    def _make_dataset(paths, labels, train: bool) -> FineTuneExcelDataset:
        return FineTuneExcelDataset(
            paths, labels,
            seq_len=int(cfg_dict.get("seq_len", 128)),
            normalization=str(cfg_dict.get("normalization", "original")),
            keypoints=kps,
            include_dynamics=bool(cfg_dict.get("include_dynamics", False)),
            dynamic_features=list(dyn_feats),
            fps=float(cfg_dict.get("fps", 30.0)),
            train=train, augment=aug, seed=seed
        )

    train_ds = _make_dataset(train_paths, train_labels, train=True)
    val_ds = _make_dataset(val_paths, val_labels, train=False)
    test_ds = _make_dataset(test_paths, test_labels, train=False)

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False, num_workers=0)
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

    # Đánh giá trước khi fine-tune — trên VAL (không nhìn tập test cho tới cuối).
    # Epoch 0 = checkpoint gốc, cũng là một ứng viên khi chọn model.
    print("\n🔍 Đánh giá model trên tập VAL TRƯỚC KHI fine-tune (epoch 0)...")
    val0 = evaluate(model, val_loader, device, verbose=True, loss_fn=loss_fn)
    best = {"epoch": 0, "val_metrics": val0, "state": _snapshot_state(model)}
    history = [{"epoch": 0, "train_loss": None, "val_loss": val0["loss"], "val_acc": val0["acc"], "val_f1": val0["f1"]}]

    # 5. Training loop
    print("\n🚀 BẮT ĐẦU FINE-TUNE...")

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

        # Chọn model CHỈ dựa trên tập VAL
        val_metrics = evaluate(model, val_loader, device, verbose=False, loss_fn=loss_fn)
        history.append({"epoch": epoch, "train_loss": avg_train_loss, "val_loss": val_metrics["loss"],
                        "val_acc": val_metrics["acc"], "val_f1": val_metrics["f1"]})

        print(f"Epoch {epoch:2d}/{args.epochs:2d} | Train Loss: {avg_train_loss:.4f} | Val Loss: {val_metrics['loss']:.4f} | Val Acc: {val_metrics['acc']*100:.2f}% | Val F1: {val_metrics['f1']*100:.2f}%")

        if _is_better(val_metrics, best["val_metrics"]):
            best = {"epoch": epoch, "val_metrics": val_metrics, "state": _snapshot_state(model)}

    # 6. Nạp trọng số đã chọn, đánh giá TEST đúng MỘT lần, rồi lưu kết quả
    model.load_state_dict(best["state"])
    bv = best["val_metrics"]
    print(f"\n🏁 Epoch được chọn (theo Val macro-F1): {best['epoch']} | Val F1: {bv['f1']*100:.2f}% | Val Acc: {bv['acc']*100:.2f}%")
    if best["epoch"] == 0:
        print("   (Fine-tune không cải thiện val → giữ nguyên trọng số của checkpoint gốc)")

    print("\n🔍 Đánh giá trên tập TEST — chỉ MỘT lần, với trọng số đã chọn:")
    test_metrics = evaluate(model, test_loader, device, verbose=True, loss_fn=loss_fn)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    save_path = out_dir / f"finetuned_{ckpt_path.name}"

    best_state = {
        "epoch": best["epoch"],
        "model_state_dict": best["state"],
        "config": cfg_dict,
        "num_joints": num_joints,  # read by API _load_stgcn_from_checkpoint (falls back to 18 if missing)
        "in_channels": in_channels,
        "layout": layout,
        "val_metrics": bv,
        "selection": {"metric": SELECTION_METRIC, "best_epoch": best["epoch"]},
        "source_checkpoint": str(ckpt_path),
    }
    torch.save(best_state, save_path)
    print(f"\n💾 Đã lưu fine-tuned model (best epoch {best['epoch']}, Val F1: {bv['f1']*100:.2f}%) tại:")
    print(f"   {save_path}")

    results_path = save_path.parent / "test_results.json"
    results = {
        "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "source_checkpoint": str(ckpt_path),
        "output_checkpoint": str(save_path),
        "output_checkpoint_sha256": ce.sha256_file(save_path),
        "split_source": data["source"],
        "selection": {
            "metric": SELECTION_METRIC,
            "tie_break": "lower val loss, then earlier epoch",
            "candidates": f"epoch 0 (base checkpoint) .. {args.epochs}",
            "best_epoch": best["epoch"],
        },
        "hyperparameters": {"epochs": args.epochs, "lr": args.lr, "batch_size": args.batch_size,
                            "seed": seed, "device": str(device)},
        "config": cfg_dict,
        "num_joints": num_joints,
        "in_channels": in_channels,
        "layout": layout,
        "subjects": subjects,
        "n_files": {"train": len(train_paths), "val": len(val_paths), "test": len(test_paths)},
        "val_metrics": bv,
        "test_metrics": test_metrics,
        "history": history,
        "notes": [
            "File-level metrics at argmax with the TRAINING preprocessing (nearest resample before "
            "normalization); not the deployed pipeline. Report subject-level numbers from "
            "predict_dataset.py + calibrate_evaluate.py evaluate.",
            "Test set evaluated exactly once, after epoch selection on the validation set.",
        ],
    }
    if results_path.exists():
        print(f"⚠️  Ghi đè {results_path} (nên dùng --out-dir riêng cho mỗi lần chạy)")
    with results_path.open("w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False, default=str)
    print(f"📝 Đã ghi kết quả (config, subject, val + test metrics): {results_path}")


@torch.no_grad()
def evaluate(model, loader, device, verbose=True, loss_fn=None):
    model.eval()
    y_true, y_pred = [], []
    total_loss, n_seen = 0.0, 0
    for batch in loader:
        x, y = batch["x"].to(device), batch["y"]
        logits = model(x)
        if loss_fn is not None:
            total_loss += float(loss_fn(logits, y.to(device)).item()) * x.size(0)
            n_seen += x.size(0)
        preds = torch.argmax(logits, dim=1).cpu().numpy()
        y_true.extend(y.cpu().numpy().tolist())
        y_pred.extend(preds.tolist())

    y_true, y_pred = np.array(y_true), np.array(y_pred)
    acc = float(accuracy_score(y_true, y_pred))
    pre = float(precision_score(y_true, y_pred, average="macro", zero_division=0))
    rec = float(recall_score(y_true, y_pred, average="macro", zero_division=0))
    f1 = float(f1_score(y_true, y_pred, average="macro", zero_division=0))
    cm = confusion_matrix(y_true, y_pred, labels=[0, 1]).tolist()

    metrics = {"acc": acc, "pre": pre, "rec": rec, "f1": f1, "confusion_matrix": cm, "n": int(len(y_true))}
    if loss_fn is not None:
        metrics["loss"] = total_loss / max(n_seen, 1)

    if verbose:
        print(f"   Accuracy : {acc*100:.2f}%")
        print(f"   Precision: {pre*100:.2f}%")
        print(f"   Recall   : {rec*100:.2f}%")
        print(f"   F1-Score : {f1*100:.2f}%")
        if "loss" in metrics:
            print(f"   Loss     : {metrics['loss']:.4f}")
        print(f"   Confusion (hàng = nhãn thật 0/1, cột = dự đoán): {cm}")

    return metrics


if __name__ == "__main__":
    main()
