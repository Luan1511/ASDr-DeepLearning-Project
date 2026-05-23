import random
import re
from dataclasses import dataclass
from pathlib import Path
from typing import List, Tuple, Dict, Optional

import numpy as np
import pandas as pd
import torch
from torch.utils.data import Dataset, DataLoader

import torch
import torch.nn as nn

import json
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import List, Optional, Sequence, Union

import matplotlib.pyplot as plt

import sys
import argparse
import json
import random
import re
from datetime import datetime

import torch.nn.functional as F

# ============================ Config ============================

# Kinect v2 – 25 khớp (thứ tự chuẩn hóa)
KINECT25 = [
    "Head", "Neck", "SpineShoulder",
    "ShoulderLeft", "ShoulderRight",
    "ElbowLeft", "ElbowRight",
    "WristLeft", "WristRight",
    "ThumbLeft", "ThumbRight",
    "HandLeft", "HandRight",
    "HandTipLeft", "HandTipRight",
    "SpineMid", "SpineBase",
    "HipLeft", "HipRight",
    "KneeLeft", "KneeRight",
    "AnkleLeft", "AnkleRight",
    "FootLeft", "FootRight"
]

# Danh sách 23 khớp (loại bỏ Head và Neck)
KINECT23_NO_HEAD_NECK = [
    "SpineShoulder",
    "ShoulderLeft", "ShoulderRight",
    "ElbowLeft", "ElbowRight",
    "WristLeft", "WristRight",
    "ThumbLeft", "ThumbRight",
    "HandLeft", "HandRight",
    "HandTipLeft", "HandTipRight",
    "SpineMid", "SpineBase",
    "HipLeft", "HipRight",
    "KneeLeft", "KneeRight",
    "AnkleLeft", "AnkleRight",
    "FootLeft", "FootRight"
]

# Chuẩn hóa các tên khớp bị gõ sai/không thống nhất
CANONICAL_RENAME = {
    r"^Midspain$": "SpineMid",
    r"^MidSpine$": "SpineMid",
    r"^SpanBase$": "SpineBase",
    r"^Spine Shoulder$": "SpineShoulder",
    r"^Shoulder\s*L$": "ShoulderLeft",
    r"^Shoulder\s*R$": "ShoulderRight",
}


def _rename_joint(j: str) -> str:
    j = str(j).strip()
    for pat, new in CANONICAL_RENAME.items():
        if re.match(pat, j, flags=re.IGNORECASE):
            return new
    return j


def _safe_float(x):
    """Chuyển sang float, xử lý ',', rỗng, 'nan', 'none' → np.nan."""
    if isinstance(x, (int, float, np.floating)):
        return float(x)
    if isinstance(x, str):
        x = x.strip().replace(",", ".")
        if x == "" or x.lower() in {"nan", "none"}:
            return np.nan
        try:
            return float(x)
        except Exception:
            return np.nan
    return np.nan


def _interpolate_nan(arr: np.ndarray) -> np.ndarray:
    """Nội suy theo thời gian cho NaN: arr (T,D)."""
    out = arr.copy()
    T, D = out.shape
    idx = np.arange(T)
    for d in range(D):
        col = out[:, d]
        m = ~np.isnan(col)
        if m.sum() == 0:
            continue
        if m.sum() == 1:
            out[:, d] = col[m][0]
        else:
            out[:, d] = np.interp(idx, idx[m], col[m])
    return out


def _resample_time(seq: np.ndarray, L: int) -> np.ndarray:
    """Resample theo thời gian tới độ dài L. seq: (T,J,C) -> (L,J,C)"""
    T, J, C = seq.shape
    if T == L:
        return seq
    t_old = np.linspace(0, 1, T)
    t_new = np.linspace(0, 1, L)
    out = np.empty((L, J, C), dtype=seq.dtype)
    for j in range(J):
        for c in range(C):
            out[:, j, c] = np.interp(t_new, t_old, seq[:, j, c])
    return out


def remove_head_neck(seq: np.ndarray) -> np.ndarray:
    """
    Loại bỏ Head và Neck (25 -> 23 joints) theo logic ST-GCN.py.

    Parameters
    ----------
    seq : np.ndarray, shape (T, 25, 2)
        Chuỗi keypoints với 25 joints

    Returns
    -------
    np.ndarray, shape (T, 23, 2)
        Chuỗi keypoints sau khi loại bỏ Head & Neck
    """
    return seq[:, 2:, :]


# ============================== NORMALIZATION METHODS ==============================

def normalize_by_spine_base(seq: np.ndarray, spine_base_idx: int = 16) -> np.ndarray:
    """
    Chuẩn hóa bằng cách dịch chuyển toàn bộ skeleton về gốc tọa độ SpineBase.

    Parameters
    ----------
    seq : np.ndarray, shape (T, J, 2)
        Chuỗi keypoints gốc
    spine_base_idx : int, default=16
        Index của SpineBase trong KINECT25

    Returns
    -------
    np.ndarray, shape (T, J, 2)
        Skeleton đã được dịch chuyển
    """
    seq_norm = seq.copy()
    spine_base = seq[:, spine_base_idx:spine_base_idx + 1, :]  # (T, 1, 2)
    seq_norm = seq_norm - spine_base  # Broadcasting: (T,J,2) - (T,1,2)
    return seq_norm


def normalize_by_scale(seq: np.ndarray,
                       spine_base_idx: int = 16,
                       spine_shoulder_idx: int = 2) -> np.ndarray:
    """
    Chuẩn hóa bằng cách scale theo khoảng cách SpineBase - SpineShoulder.

    Parameters
    ----------
    seq : np.ndarray, shape (T, J, 2)
        Chuỗi keypoints
    spine_base_idx : int, default=16
        Index của SpineBase
    spine_shoulder_idx : int, default=2
        Index của SpineShoulder

    Returns
    -------
    np.ndarray, shape (T, J, 2)
        Skeleton đã được scale
    """
    seq_norm = seq.copy()

    # Tính khoảng cách SpineBase - SpineShoulder cho mỗi frame
    spine_base = seq[:, spine_base_idx, :]  # (T, 2)
    spine_shoulder = seq[:, spine_shoulder_idx, :]  # (T, 2)

    spine_dist = np.linalg.norm(spine_shoulder - spine_base, axis=1)  # (T,)
    spine_dist = np.maximum(spine_dist, 1e-6)  # Tránh chia cho 0

    # Scale từng frame
    scale_factor = spine_dist[:, np.newaxis, np.newaxis]  # (T, 1, 1)
    seq_norm = seq_norm / scale_factor

    return seq_norm


def normalize_by_bbox(seq: np.ndarray) -> np.ndarray:
    """
    Chuẩn hóa bằng bounding box cho từng frame.
    Dịch về center và scale về [-1, 1].

    Parameters
    ----------
    seq : np.ndarray, shape (T, J, 2)
        Chuỗi keypoints

    Returns
    -------
    np.ndarray, shape (T, J, 2)
        Skeleton đã được normalize vào [-1, 1]
    """
    seq_norm = seq.copy()
    T, J, C = seq.shape

    for t in range(T):
        frame = seq_norm[t]  # (J, 2)

        # Tính bbox
        x_min, y_min = frame[:, 0].min(), frame[:, 1].min()
        x_max, y_max = frame[:, 0].max(), frame[:, 1].max()

        # Tính center và size
        center = np.array([(x_min + x_max) / 2, (y_min + y_max) / 2])
        size = max(x_max - x_min, y_max - y_min, 1e-6)

        # Normalize
        seq_norm[t] = (frame - center) / (size / 2)

    return seq_norm


def normalize_by_rotation(seq: np.ndarray,
                          spine_base_idx: int = 16,
                          spine_shoulder_idx: int = 2) -> np.ndarray:
    """
    Xoay skeleton sao cho trục SpineBase → SpineShoulder thẳng đứng (hướng lên).

    Parameters
    ----------
    seq : np.ndarray, shape (T, J, 2)
        Chuỗi keypoints
    spine_base_idx : int, default=16
        Index của SpineBase
    spine_shoulder_idx : int, default=2
        Index của SpineShoulder

    Returns
    -------
    np.ndarray, shape (T, J, 2)
        Skeleton đã được xoay
    """
    seq_norm = seq.copy()
    T, J, C = seq.shape

    for t in range(T):
        # Lấy tọa độ spine
        spine_base = seq[t, spine_base_idx, :]  # (2,)
        spine_shoulder = seq[t, spine_shoulder_idx, :]  # (2,)

        # Vector spine
        spine_vec = spine_shoulder - spine_base

        # Tính góc với trục Y (0, 1) - hướng lên
        # arctan2(x, y) cho góc từ trục Y
        angle = np.arctan2(spine_vec[0], spine_vec[1])

        # Ma trận xoay (xoay ngược lại để spine thẳng đứng)
        cos_a, sin_a = np.cos(-angle), np.sin(-angle)
        rotation_matrix = np.array([
            [cos_a, -sin_a],
            [sin_a, cos_a]
        ])

        # Xoay tất cả joints quanh SpineBase
        for j in range(J):
            relative_pos = seq[t, j, :] - spine_base  # Tọa độ tương đối
            rotated = rotation_matrix @ relative_pos   # Xoay
            seq_norm[t, j, :] = rotated + spine_base   # Đưa về vị trí gốc

    return seq_norm


def normalize_zscore(seq: np.ndarray) -> np.ndarray:
    """
    Z-score normalization cho toàn bộ sequence.

    Parameters
    ----------
    seq : np.ndarray, shape (T, J, 2)
        Chuỗi keypoints

    Returns
    -------
    np.ndarray, shape (T, J, 2)
        Skeleton đã được z-score normalize
    """
    seq_norm = seq.copy()
    T, J, C = seq.shape

    # Flatten để tính mean và std
    flat = seq_norm.reshape(-1, C)  # (T*J, 2)

    for c in range(C):
        col = flat[:, c]
        mean = col.mean()
        std = col.std()
        if std > 1e-6:
            seq_norm[:, :, c] = (seq_norm[:, :, c] - mean) / std

    return seq_norm


def normalize_combined(seq: np.ndarray,
                       spine_base_idx: int = 16,
                       spine_shoulder_idx: int = 2) -> np.ndarray:
    """
    Kết hợp cả translation (SpineBase) và scaling (shoulder distance).

    Parameters
    ----------
    seq : np.ndarray, shape (T, J, 2)
        Chuỗi keypoints gốc

    Returns
    -------
    np.ndarray, shape (T, J, 2)
        Skeleton đã được normalize
    """
    # Bước 1: Dịch chuyển về SpineBase
    seq_norm = normalize_by_spine_base(seq, spine_base_idx)

    # Bước 2: Scale theo khoảng cách thân
    seq_norm = normalize_by_scale(seq_norm, spine_base_idx, spine_shoulder_idx)

    return seq_norm


def normalize_combined_bbox_rotate(seq: np.ndarray,
                          spine_base_idx: int = 16,
                          spine_shoulder_idx: int = 2) -> np.ndarray:
    """
    Kết hợp cả translation (SpineBase) và scaling (shoulder distance).

    Parameters
    ----------
    seq : np.ndarray, shape (T, J, 2)
        Chuỗi keypoints gốc

    Returns
    -------
    np.ndarray, shape (T, J, 2)
        Skeleton đã được normalize
    """
    # Bước 1: Dịch chuyển về SpineBase
    seq_norm = normalize_by_rotation(seq, spine_base_idx, spine_shoulder_idx)

    # Bước 2: Scale theo khoảng cách thân
    seq_norm = normalize_by_bbox(seq_norm)

    return seq_norm


def normalize_combined_bbox_zscore(seq: np.ndarray) -> np.ndarray:

    seq_norm = normalize_zscore(seq)
    seq_norm = normalize_by_bbox(seq_norm)

    return seq_norm


def normalize_combined_zscore_rotate(seq: np.ndarray,
                          spine_base_idx: int = 16,
                          spine_shoulder_idx: int = 2) -> np.ndarray:

    seq_norm = normalize_zscore(seq)
    seq_norm = normalize_by_rotation(seq_norm)

    return seq_norm


# ============================== DYNAMIC FEATURES ==============================

def compute_velocity(seq: np.ndarray, fps: float = 30.0) -> np.ndarray:
    """
    Tính vận tốc (velocity) của các joints.

    Parameters
    ----------
    seq : np.ndarray, shape (T, J, C)
        Chuỗi keypoints
    fps : float, default=30.0
        Frames per second của video

    Returns
    -------
    np.ndarray, shape (T, J, C)
        Vận tốc của từng joint
    """
    T = seq.shape[0]
    dt = 1.0 / fps

    # Tính velocity bằng central difference
    velocity = np.zeros_like(seq)

    # Frame đầu: forward difference
    velocity[0] = (seq[1] - seq[0]) / dt

    # Các frame giữa: central difference
    for t in range(1, T - 1):
        velocity[t] = (seq[t + 1] - seq[t - 1]) / (2 * dt)

    # Frame cuối: backward difference
    velocity[-1] = (seq[-1] - seq[-2]) / dt

    return velocity


def compute_acceleration(seq: np.ndarray, fps: float = 30.0) -> np.ndarray:
    """
    Tính gia tốc (acceleration) của các joints.

    Parameters
    ----------
    seq : np.ndarray, shape (T, J, C)
        Chuỗi keypoints
    fps : float, default=30.0
        Frames per second của video

    Returns
    -------
    np.ndarray, shape (T, J, C)
        Gia tốc của từng joint
    """
    velocity = compute_velocity(seq, fps)
    acceleration = compute_velocity(velocity, fps)
    return acceleration


def compute_bone_lengths(seq: np.ndarray, bone_pairs: List[Tuple[int, int]]) -> np.ndarray:
    """
    Tính độ dài của các xương (bone lengths).

    Parameters
    ----------
    seq : np.ndarray, shape (T, J, C)
        Chuỗi keypoints
    bone_pairs : List[Tuple[int, int]]
        Danh sách các cặp joints tạo thành xương

    Returns
    -------
    np.ndarray, shape (T, num_bones)
        Độ dài của từng xương theo thời gian
    """
    T = seq.shape[0]
    num_bones = len(bone_pairs)
    bone_lengths = np.zeros((T, num_bones))

    for i, (j1, j2) in enumerate(bone_pairs):
        bone_vectors = seq[:, j2, :] - seq[:, j1, :]
        bone_lengths[:, i] = np.linalg.norm(bone_vectors, axis=1)

    return bone_lengths


def compute_joint_angles(seq: np.ndarray, angle_triplets: List[Tuple[int, int, int]]) -> np.ndarray:
    """
    Tính góc giữa các joints.

    Parameters
    ----------
    seq : np.ndarray, shape (T, J, 2)
        Chuỗi keypoints
    angle_triplets : List[Tuple[int, int, int]]
        Danh sách các bộ 3 joints (j1, j2, j3) để tính góc tại j2

    Returns
    -------
    np.ndarray, shape (T, num_angles)
        Góc của từng bộ 3 joints theo thời gian (radian)
    """
    T = seq.shape[0]
    num_angles = len(angle_triplets)
    angles = np.zeros((T, num_angles))

    for i, (j1, j2, j3) in enumerate(angle_triplets):
        # Vector từ j2 đến j1 và j3
        v1 = seq[:, j1, :] - seq[:, j2, :]  # (T, 2)
        v2 = seq[:, j3, :] - seq[:, j2, :]  # (T, 2)

        # Tính góc
        dot_product = np.sum(v1 * v2, axis=1)
        norm_v1 = np.linalg.norm(v1, axis=1)
        norm_v2 = np.linalg.norm(v2, axis=1)

        # Tránh chia cho 0
        norm_product = norm_v1 * norm_v2
        norm_product = np.maximum(norm_product, 1e-8)

        cos_angle = np.clip(dot_product / norm_product, -1.0, 1.0)
        angles[:, i] = np.arccos(cos_angle)

    return angles


def compute_motion_energy(seq: np.ndarray, fps: float = 30.0) -> np.ndarray:
    """
    Tính năng lượng chuyển động (motion energy) của từng joint.

    Parameters
    ----------
    seq : np.ndarray, shape (T, J, C)
        Chuỗi keypoints
    fps : float, default=30.0
        Frames per second

    Returns
    -------
    np.ndarray, shape (T, J)
        Năng lượng chuyển động của từng joint
    """
    velocity = compute_velocity(seq, fps)
    # Tính magnitude của velocity
    motion_energy = np.linalg.norm(velocity, axis=2)
    return motion_energy


def get_kinect25_bone_pairs() -> List[Tuple[int, int]]:
    """Trả về danh sách các cặp joints tạo thành xương cho Kinect 25 joints"""
    return [
        # Head & Spine
        (0, 1), (1, 2), (2, 15), (15, 16),
        # Left arm
        (2, 3), (3, 5), (5, 7), (7, 9), (7, 11), (11, 13),
        # Right arm
        (2, 4), (4, 6), (6, 8), (8, 10), (8, 12), (12, 14),
        # Left leg
        (16, 17), (17, 19), (19, 21), (21, 23),
        # Right leg
        (16, 18), (18, 20), (20, 22), (22, 24)
    ]


def get_kinect23_bone_pairs() -> List[Tuple[int, int]]:
    """Trả về danh sách các cặp joints tạo thành xương cho Kinect 23 joints (no Head & Neck)"""
    return [
        # Spine
        (0, 13), (13, 14),
        # Left arm
        (0, 1), (1, 3), (3, 5), (5, 7), (5, 9), (9, 11),
        # Right arm
        (0, 2), (2, 4), (4, 6), (6, 8), (6, 10), (10, 12),
        # Left leg
        (14, 15), (15, 17), (17, 19), (19, 21),
        # Right leg
        (14, 16), (16, 18), (18, 20), (20, 22)
    ]


def get_kinect25_angle_triplets() -> List[Tuple[int, int, int]]:
    """Trả về danh sách các bộ 3 joints để tính góc cho Kinect 25 joints"""
    return [
        # Left arm angles
        (2, 3, 5),  # Shoulder-Elbow angle (left)
        (3, 5, 7),  # Elbow-Wrist angle (left)
        # Right arm angles
        (2, 4, 6),  # Shoulder-Elbow angle (right)
        (4, 6, 8),  # Elbow-Wrist angle (right)
        # Left leg angles
        (16, 17, 19),  # Hip-Knee angle (left)
        (17, 19, 21),  # Knee-Ankle angle (left)
        # Right leg angles
        (16, 18, 20),  # Hip-Knee angle (right)
        (18, 20, 22),  # Knee-Ankle angle (right)
        # Spine angles
        (1, 2, 15),  # Neck-SpineShoulder-SpineMid
        (2, 15, 16),  # SpineShoulder-SpineMid-SpineBase
    ]


def get_kinect23_angle_triplets() -> List[Tuple[int, int, int]]:
    """Trả về danh sách các bộ 3 joints để tính góc cho Kinect 23 joints"""
    return [
        # Left arm angles
        (0, 1, 3),  # SpineShoulder-ShoulderLeft-ElbowLeft
        (1, 3, 5),  # ShoulderLeft-ElbowLeft-WristLeft
        # Right arm angles
        (0, 2, 4),  # SpineShoulder-ShoulderRight-ElbowRight
        (2, 4, 6),  # ShoulderRight-ElbowRight-WristRight
        # Left leg angles
        (14, 15, 17),  # SpineBase-HipLeft-KneeLeft
        (15, 17, 19),  # HipLeft-KneeLeft-AnkleLeft
        # Right leg angles
        (14, 16, 18),  # SpineBase-HipRight-KneeRight
        (16, 18, 20),  # HipRight-KneeRight-AnkleRight
        # Spine angles
        (0, 13, 14),  # SpineShoulder-SpineMid-SpineBase
    ]


# ============================== INDEX BUILDER ===============================

@dataclass
class SampleInfo:
    path_2d: Path
    label: int  # 1 = ASD, 0 = Typical
    subject_id: str
    variant_kind: str  # 'augmentation' hoặc 'video'
    variant_id: str  # ví dụ '1' (aug) hoặc '8' (video)
    clip_stub: str  # tên trước _2d.xlsx
    group: str  # 'ASD' | 'Typical'


def build_index(root: Path) -> List[SampleInfo]:
    """
    Quét cả hai nhánh:
      .../<subject>/augmentation/<k>/<k>_2d.xlsx
      .../<subject>/video/<n>_2d.xlsx
    """
    root = Path(root)
    entries: List[SampleInfo] = []

    # Xác định gốc nhóm
    group_roots = []
    for p in root.rglob("*"):
        if p.is_dir() and ("autism" in p.name.lower() or "typical" in p.name.lower()):
            group_roots.append(p)

    for gdir in group_roots:
        group_name = "ASD" if "autism" in gdir.name.lower() else "Typical"
        label = 1 if group_name == "ASD" else 0

        for x in gdir.rglob("*_2d.xlsx"):
            x = Path(x)
            parts = [s.lower() for s in x.parts]
            clip_stub = x.stem.replace("_2d", "")

            # Tìm subject & biến thể
            subject_id, variant_kind, variant_id = "unknown", "unknown", "0"
            if "augmentation" in parts:
                i = parts.index("augmentation")
                variant_kind = "augmentation"
                variant_id = x.parts[i + 1] if i + 1 < len(x.parts) else "0"
                subject_id = x.parts[i - 1] if i - 1 >= 0 else "unknown"
            elif "video" in parts:
                i = parts.index("video")
                variant_kind = "video"
                variant_id = clip_stub
                subject_id = x.parts[i - 1] if i - 1 >= 0 else "unknown"

            entries.append(SampleInfo(
                path_2d=x, label=label, subject_id=str(subject_id),
                variant_kind=variant_kind, variant_id=str(variant_id),
                clip_stub=clip_stub, group=group_name
            ))

    entries.sort(key=lambda e: (e.group, e.subject_id, e.variant_kind, e.variant_id, e.clip_stub))
    return entries


# ================================ SPLITTER =================================

@dataclass
class SplitSets:
    train: List[int]
    val: List[int]
    test: List[int]


def subject_wise_split(entries: List[SampleInfo],
                       train_ratio=0.7, val_ratio=0.15, seed: Optional[int] = 42) -> SplitSets:
    """
    Chia theo SUBJECT (gộp mọi augmentation/video của cùng subject).
    Stratify theo ASD/Typical.
    """
    rng = random.Random(seed) if seed is not None else random.Random()

    # Gom theo (label, subject_id)
    by_subject: Dict[Tuple[int, str], List[int]] = {}
    for i, e in enumerate(entries):
        by_subject.setdefault((e.label, e.subject_id), []).append(i)

    # Tách danh sách subject ASD và TD
    subjects_asd = [k for k in by_subject if k[0] == 1]
    subjects_td = [k for k in by_subject if k[0] == 0]

    rng.shuffle(subjects_asd)
    rng.shuffle(subjects_td)

    def split(keys):
        n = len(keys)
        n_train = int(round(n * train_ratio))
        n_val = int(round(n * val_ratio))
        return keys[:n_train], keys[n_train:n_train + n_val], keys[n_train + n_val:]

    # Chia cho ASD và TD riêng
    asd_tr, asd_va, asd_te = split(subjects_asd)
    td_tr, td_va, td_te = split(subjects_td)

    # Gom index các file tương ứng
    def gather(keys):
        out = []
        for k in keys:
            out.extend(by_subject[k])
        return out

    train_idx = gather(asd_tr) + gather(td_tr)
    val_idx = gather(asd_va) + gather(td_va)
    test_idx = gather(asd_te) + gather(td_te)

    rng.shuffle(train_idx)
    rng.shuffle(val_idx)
    rng.shuffle(test_idx)

    return SplitSets(train_idx, val_idx, test_idx)


# ================================ DATASET ==================================

class Kinect2DNormalizedDataset(Dataset):
    """
    Dataset với các phương pháp normalization và dynamic features.

    Normalization methods:
    - 'original': Không normalize (giữ nguyên như Original)
    - 'spine_base': Dịch chuyển về SpineBase
    - 'scale': Scale theo khoảng cách SpineBase - SpineShoulder
    - 'rotate': Xoay để trục SpineBase-SpineShoulder thẳng đứng
    - 'bbox': Normalize bằng bounding box
    - 'zscore': Z-score normalization

    Dynamic features (nếu include_dynamics=True):
    - velocity: Vận tốc của các joints
    - acceleration: Gia tốc của các joints
    - bone_lengths: Độ dài các xương
    - joint_angles: Góc giữa các joints
    - motion_energy: Năng lượng chuyển động
    """

    def __init__(self,
                 entries: List[SampleInfo],
                 indices: List[int],
                 L: Optional[int] = 128,
                 normalization: str = 'combined',
                 remove_head_neck: bool = False,
                 include_dynamics: bool = False,
                 fps: float = 30.0,
                 dynamic_features: Optional[List[str]] = None):
        """
        Parameters
        ----------
        entries : List[SampleInfo]
            Danh sách tất cả samples.
        indices : List[int]
            Danh sách index trong entries để sử dụng.
        L : int | None, default=128
            Số frames sau resample. Nếu None → giữ nguyên độ dài gốc.
        normalization : str, default='original'
            Phương pháp normalize: 'original', 'spine_base', 'scale', 'bbox', 'zscore'
        remove_head_neck : bool, default=False
            Nếu True, loại bỏ Head & Neck (25 joints -> 23 joints)
        include_dynamics : bool, default=False
            Nếu True, tính toán và trả về các đặc trưng động học
        fps : float, default=30.0
            Frames per second của video (dùng cho tính velocity/acceleration)
        dynamic_features : List[str] | None
            Danh sách các đặc trưng động học cần tính:
            ['velocity', 'acceleration', 'bone_lengths', 'joint_angles', 'motion_energy']
            Nếu None và include_dynamics=True, sẽ tính tất cả
        """
        self.entries = entries
        self.indices = indices
        self.L = L
        self.normalization = normalization
        self.remove_head_neck = remove_head_neck
        self.include_dynamics = include_dynamics
        self.fps = fps

        # Mặc định tính tất cả dynamic features nếu không chỉ định
        if dynamic_features is None:
            self.dynamic_features = ['velocity', 'acceleration', 'bone_lengths',
                                     'joint_angles', 'motion_energy']
        else:
            self.dynamic_features = dynamic_features

        # Joint indices cho normalization (dựa trên KINECT25)
        self.spine_base_idx = KINECT25.index("SpineBase")
        self.spine_shoulder_idx = KINECT25.index("SpineShoulder")

        # Nếu remove_head_neck, cập nhật indices theo skeleton 23 joints (no Head & Neck)
        if self.remove_head_neck:
            self.spine_base_idx = KINECT23_NO_HEAD_NECK.index("SpineBase")
            self.spine_shoulder_idx = KINECT23_NO_HEAD_NECK.index("SpineShoulder")
            self.bone_pairs = get_kinect23_bone_pairs()
            self.angle_triplets = get_kinect23_angle_triplets()
        else:
            self.bone_pairs = get_kinect25_bone_pairs()
            self.angle_triplets = get_kinect25_angle_triplets()

    def __len__(self):
        return len(self.indices)

    def _read_2d_excel_pairwise(self, path: Path) -> np.ndarray:
        """
        Đọc file Excel 2D, trả về (T, 25, 2) với tọa độ GỐC.
        """
        df = pd.read_excel(path)
        cols = [str(c).strip() for c in df.columns]

        # Bỏ cột thời gian nếu có
        start_col = 0
        if len(cols) > 0 and (":" in cols[0] or "H:M" in cols[0] or "time" in cols[0].lower()):
            start_col = 1

        # joint -> (x_series, y_series)
        pairs: Dict[str, Tuple[np.ndarray, np.ndarray]] = {}
        i = start_col
        while i + 1 < len(cols):
            if str(cols[i]).startswith("Unnamed"):
                i += 1
                continue

            jname = _rename_joint(cols[i])
            if jname in KINECT25:
                x = df.iloc[:, i].apply(_safe_float).to_numpy(dtype=np.float32)
                y = df.iloc[:, i + 1].apply(_safe_float).to_numpy(dtype=np.float32)
                pairs[jname] = (x, y)

            i += 3 if (i + 2 < len(cols)) else 2

        # Ghép vào tensor (T, 25, 2)
        T = len(df)
        arr = np.full((T, len(KINECT25), 2), np.nan, dtype=np.float32)
        for j_idx, jname in enumerate(KINECT25):
            if jname in pairs:
                arr[:, j_idx, 0] = pairs[jname][0]
                arr[:, j_idx, 1] = pairs[jname][1]

        # Nội suy NaN
        for j in range(arr.shape[1]):
            arr[:, j, :] = _interpolate_nan(arr[:, j, :])

        # Thay NaN còn lại bằng 0
        if np.isnan(arr).sum() > 0:
            arr = np.nan_to_num(arr, nan=0.0)

        return arr  # (T, 25, 2)

    def _apply_normalization(self, seq: np.ndarray) -> np.ndarray:
        """Áp dụng phương pháp normalization đã chọn."""
        if self.normalization == 'original':
            return seq
        elif self.normalization == 'spine_base':
            return normalize_by_spine_base(seq, self.spine_base_idx)
        elif self.normalization == 'scale':
            return normalize_by_scale(seq, self.spine_base_idx, self.spine_shoulder_idx)
        elif self.normalization == 'rotate':
            return normalize_by_rotation(seq, self.spine_base_idx, self.spine_shoulder_idx)
        elif self.normalization == 'bbox':
            return normalize_by_bbox(seq)
        elif self.normalization == 'zscore':
            return normalize_zscore(seq)
        elif self.normalization == 'combined':
            return normalize_combined(seq, self.spine_base_idx, self.spine_shoulder_idx)
        elif self.normalization == 'combined_bbox_rotate':
            return normalize_combined_bbox_rotate(seq, self.spine_base_idx, self.spine_shoulder_idx)
        elif self.normalization == 'combined_zscore_rotate':
            return normalize_combined_zscore_rotate(seq, self.spine_base_idx, self.spine_shoulder_idx)
        elif self.normalization == 'combined_bbox_zscore':
            return normalize_combined_bbox_zscore(seq)
        else:
            raise ValueError(f"Unknown normalization: {self.normalization}")

    def _compute_dynamic_features(self, seq: np.ndarray) -> Dict[str, np.ndarray]:
        """
        Tính toán các đặc trưng động học.

        Returns
        -------
        Dict[str, np.ndarray]
            Dictionary chứa các đặc trưng động học đã được tính
        """
        dynamics = {}

        if 'velocity' in self.dynamic_features:
            dynamics['velocity'] = compute_velocity(seq, self.fps)

        if 'acceleration' in self.dynamic_features:
            dynamics['acceleration'] = compute_acceleration(seq, self.fps)

        if 'bone_lengths' in self.dynamic_features:
            dynamics['bone_lengths'] = compute_bone_lengths(seq, self.bone_pairs)

        if 'joint_angles' in self.dynamic_features:
            dynamics['joint_angles'] = compute_joint_angles(seq, self.angle_triplets)

        if 'motion_energy' in self.dynamic_features:
            dynamics['motion_energy'] = compute_motion_energy(seq, self.fps)

        return dynamics

    def __getitem__(self, i):
        e = self.entries[self.indices[i]]
        seq = self._read_2d_excel_pairwise(e.path_2d)  # (T, 25, 2)
        T = seq.shape[0]

        # Loại bỏ joints nếu cần (TRƯỚC khi normalize) - khớp logic ST-GCN
        if self.remove_head_neck:
            seq = remove_head_neck(seq)  # (T, 25, 2) -> (T, 23, 2)

        # Áp dụng normalization
        seq = self._apply_normalization(seq)

        # Resample nếu cần
        if self.L is not None:
            seq = _resample_time(seq, self.L)
            length_used = self.L
        else:
            length_used = T

        num_joints = seq.shape[1]

        # Chuẩn bị output
        output = {
            "keypoints": torch.from_numpy(seq).float(),
            "label": torch.tensor(e.label, dtype=torch.long),
            "subject_id": e.subject_id,
            "variant_kind": e.variant_kind,
            "variant_id": e.variant_id,
            "clip_stub": e.clip_stub,
            "group": e.group,
            "length_orig": T,
            "length_used": length_used,
            "num_joints": num_joints,
            "path": str(e.path_2d),
        }

        # Tính dynamic features nếu được yêu cầu
        if self.include_dynamics:
            dynamics = self._compute_dynamic_features(seq)

            # Thêm vào output
            for key, value in dynamics.items():
                output[f"dynamic_{key}"] = torch.from_numpy(value).float()

        return output


def analyze_subject_distribution(entries):
    """Phân tích phân bố subjects và samples."""
    subjects_asd = set()
    subjects_td = set()
    samples_per_subject = {}

    for e in entries:
        if e.label == 1:
            subjects_asd.add(e.subject_id)
        else:
            subjects_td.add(e.subject_id)
        samples_per_subject[e.subject_id] = samples_per_subject.get(e.subject_id, 0) + 1

    print(f"Tổng subjects: {len(subjects_asd) + len(subjects_td)}")
    print(f"ASD subjects: {len(subjects_asd)}, Typical subjects: {len(subjects_td)}")
    print(f"Samples per subject: {sorted(samples_per_subject.values())}")

    return subjects_asd, subjects_td


def collate_fixedlen(batch: List[dict]) -> dict:
    """Collate function cho batch có cùng độ dài."""
    X = torch.stack([b["keypoints"] for b in batch], dim=0)
    y = torch.stack([b["label"] for b in batch], dim=0)

    # Tạo meta dict cho các trường không phải tensor
    meta = {}
    for k in batch[0]:
        if k not in {"keypoints", "label"}:
            if isinstance(batch[0][k], torch.Tensor):
                # Stack các dynamic features
                meta[k] = torch.stack([b[k] for b in batch], dim=0)
            else:
                # List các giá trị metadata
                meta[k] = [b[k] for b in batch]

    return {"keypoints": X, "label": y, **meta}


# ----------------------------- Model ---------------------------------
class AttentiveBiLSTM(nn.Module):
    def __init__(self, input_size: int, hidden: int = 128,
                 num_layers: int = 2, num_classes: int = 2, dropout: float = 0.2):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0.0,
            bidirectional=True
        )
        self.attn = nn.Sequential(
            nn.Linear(2 * hidden, hidden),
            nn.Tanh(),
            nn.Linear(hidden, 1)
        )
        self.fc = nn.Sequential(
            nn.LayerNorm(2 * hidden),
            nn.Dropout(dropout),
            nn.Linear(2 * hidden, num_classes)
        )

    def forward(self, x: torch.Tensor, lengths: torch.Tensor) -> torch.Tensor:
        # x: (B, T, D), lengths: (B,)
        packed = nn.utils.rnn.pack_padded_sequence(
            x, lengths.cpu(), batch_first=True, enforce_sorted=False
        )
        out_packed, _ = self.lstm(packed)
        out, _ = nn.utils.rnn.pad_packed_sequence(out_packed, batch_first=True)  # (B,T,2H)

        B, T, H2 = out.shape
        device = out.device
        time_idx = torch.arange(T, device=device).unsqueeze(0).expand(B, T)
        mask = time_idx < lengths.unsqueeze(1)  # (B,T)

        e = self.attn(out).squeeze(-1)  # (B,T)
        e = e.masked_fill(~mask, -1e9)
        w = torch.softmax(e, dim=1).unsqueeze(-1)  # (B,T,1)

        ctx = (out * w).sum(dim=1)  # (B,2H)
        logits = self.fc(ctx)  # (B,C)
        return logits


class BiLSTMClassifier(nn.Module):
    def __init__(self, input_size: int,
                 hidden: int = 128,
                 num_layers: int = 2,
                 num_classes: int = 2,
                 dropout: float = 0.2):
        super().__init__()

        # ----- BiLSTM backbone -----
        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0.0,
            bidirectional=True
        )

        # ----- Classifier head -----
        # dùng LayerNorm + Dropout + Linear, nhận (avg ⊕ max) → 4H
        self.fc = nn.Sequential(
            nn.LayerNorm(4 * hidden),
            nn.Dropout(dropout),
            nn.Linear(4 * hidden, num_classes)
        )

    def forward(self, x: torch.Tensor, lengths: torch.Tensor) -> torch.Tensor:
        """
        x: (B, T, D) - chuỗi pose (batch, time, feature)
        lengths: (B,) - độ dài thật của mỗi chuỗi (để mask padding)
        """
        # ----- Xử lý packed sequence -----
        packed = nn.utils.rnn.pack_padded_sequence(
            x, lengths.cpu(), batch_first=True, enforce_sorted=False
        )
        out_packed, _ = self.lstm(packed)
        out, _ = nn.utils.rnn.pad_packed_sequence(out_packed, batch_first=True)  # (B,T,2H)

        # ----- Mask để bỏ padding -----
        B, T, H2 = out.shape
        device = out.device
        time_idx = torch.arange(T, device=device).unsqueeze(0).expand(B, T)
        mask = (time_idx < lengths.unsqueeze(1)).unsqueeze(-1)  # (B,T,1)

        # ----- Global Pooling -----
        # Áp mask vào các timestep thật, tránh padding ảnh hưởng trung bình
        out_masked = out * mask

        # Mean pooling (trung bình toàn chuỗi)
        sum_valid = out_masked.sum(dim=1)  # (B,2H)
        count_valid = mask.sum(dim=1).clamp(min=1)
        mean_pool = sum_valid / count_valid  # (B,2H)

        # Max pooling (giá trị lớn nhất theo thời gian)
        out_masked = out_masked + (~mask) * (-1e9)  # loại bỏ padding khỏi max
        max_pool, _ = out_masked.max(dim=1)  # (B,2H)

        # Gộp mean + max để có biểu diễn tổng thể
        ctx = torch.cat([mean_pool, max_pool], dim=-1)  # (B,4H)

        # ----- Phân loại -----
        logits = self.fc(ctx)  # (B,C)
        return logits


@dataclass
class TrainHistory:
    epochs: List[int]
    train_loss: List[float]
    val_loss: List[float]
    train_acc: List[float]
    val_acc: List[float]
    train_f1: List[float]
    val_f1: List[float]

    @staticmethod
    def empty():
        return TrainHistory([], [], [], [], [], [], [])

    def append(self, epoch: int,
               tr_loss: float, va_loss: float,
               tr_acc: float, va_acc: float,
               tr_f1: float, va_f1: float):
        self.epochs.append(epoch)
        self.train_loss.append(tr_loss)
        self.val_loss.append(va_loss)
        self.train_acc.append(tr_acc)
        self.val_acc.append(va_acc)
        self.train_f1.append(tr_f1)
        self.val_f1.append(va_f1)

    def to_json(self, path: Union[str, Path]):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")


def plot_loss_acc(history: TrainHistory,
                  out_png: Union[str, Path],
                  title: str = "Training curves"):
    """
    Vẽ 2 trục y: y1=loss, y2=acc; thêm F1 (nét đứt) để theo dõi cân bằng precision/recall.
    """
    assert len(history.epochs) > 0, "History đang rỗng"
    out_png = Path(out_png)
    out_png.parent.mkdir(parents=True, exist_ok=True)

    x = history.epochs

    fig, ax1 = plt.subplots(figsize=(8, 5))
    ax2 = ax1.twinx()

    l1, = ax1.plot(x, history.train_loss, label="train loss")
    l2, = ax1.plot(x, history.val_loss, label="val loss")
    ax1.set_xlabel("epoch")
    ax1.set_ylabel("loss")
    ax1.grid(True, linestyle="--", alpha=0.3)

    a1, = ax2.plot(x, history.train_acc, label="train acc")
    a2, = ax2.plot(x, history.val_acc, label="val acc")
    ax2.set_ylabel("accuracy")

    f1_tr, = ax2.plot(x, history.train_f1, linestyle="--", label="train F1")
    f1_va, = ax2.plot(x, history.val_f1, linestyle="--", label="val F1")

    lines = [l1, l2, a1, a2, f1_tr, f1_va]
    labels = [ln.get_label() for ln in lines]
    ax1.legend(lines, labels, loc="best")
    fig.suptitle(title)
    fig.tight_layout()
    fig.savefig(out_png, dpi=150)
    plt.close(fig)


def _confusion_matrix(y_true: np.ndarray, y_pred: np.ndarray, num_classes: int) -> np.ndarray:
    """
    Tạo ma trận nhầm lẫn k x k mà không cần sklearn.
    y_true, y_pred: shape [N], int64 trong [0..k-1]
    """
    cm = np.zeros((num_classes, num_classes), dtype=np.int64)
    for t, p in zip(y_true, y_pred):
        cm[int(t), int(p)] += 1
    return cm


def compute_cm_from_logits(
        logits: "np.ndarray",
        labels: "np.ndarray",
        num_classes: int,
        threshold: Optional[float] = None
) -> np.ndarray:
    """
    - Multi-class: argmax
    - Binary: nếu cung cấp threshold -> dựa trên prob[:,1] >= threshold, ngược lại dùng argmax
    logits: [N, K]
    labels: [N]
    """
    probs = softmax_np(logits)
    if num_classes == 2 and threshold is not None:
        pred = (probs[:, 1] >= threshold).astype(np.int64)
    else:
        pred = probs.argmax(axis=1).astype(np.int64)
    return _confusion_matrix(labels.astype(np.int64), pred, num_classes)


def softmax_np(x: np.ndarray, axis: int = -1) -> np.ndarray:
    x_max = np.max(x, axis=axis, keepdims=True)
    e = np.exp(x - x_max)
    return e / np.sum(e, axis=axis, keepdims=True)


def plot_confusion_matrix(
        cm: np.ndarray,
        class_names: Sequence[str],
        out_png: Union[str, Path],
        normalize: bool = False,
        title: str = "Confusion Matrix"
):
    """
    Vẽ CM bằng matplotlib (không seaborn).
    """
    out_png = Path(out_png)
    out_png.parent.mkdir(parents=True, exist_ok=True)

    if normalize:
        cm_sum = cm.sum(axis=1, keepdims=True).clip(min=1)
        cm_disp = cm / cm_sum
    else:
        cm_disp = cm

    fig, ax = plt.subplots(figsize=(5.5, 5))
    im = ax.imshow(cm_disp, interpolation="nearest")
    ax.set_title(title)
    tick_marks = np.arange(len(class_names))
    ax.set_xticks(tick_marks)
    ax.set_xticklabels(class_names, rotation=45, ha="right")
    ax.set_yticks(tick_marks)
    ax.set_yticklabels(class_names)
    ax.set_ylabel("True label")
    ax.set_xlabel("Predicted label")

    fmt = ".2f" if normalize else "d"
    thresh = cm_disp.max() / 2.0 if cm_disp.size > 0 else 0.5
    for i in range(cm.shape[0]):
        for j in range(cm.shape[1]):
            txt = format(cm_disp[i, j], fmt)
            ax.text(j, i, txt,
                    ha="center", va="center",
                    color="white" if cm_disp[i, j] > thresh else "black")

    fig.tight_layout()
    fig.savefig(out_png, dpi=150)
    plt.close(fig)

    
import os
import ast


def calculate_average_test_metrics(folder_path, start_index, end_index):
    """
    Duyệt các file log, trích xuất các chỉ số từ dòng 'Test@0.5' và 'Test@t*'
    và tính giá trị trung bình cộng cho cả hai.

    Args:
        folder_path (str): Đường dẫn đến thư mục chứa các file .txt.
        start_index (int): Chỉ số bắt đầu của file cần duyệt.
        end_index (int): Chỉ số kết thúc của file cần duyệt.

    Returns:
        dict: Một dictionary chứa kết quả trung bình cho cả hai bộ chỉ số,
              hoặc None nếu không có file nào được xử lý.
    """
    # Khởi tạo dictionaries để lưu tổng các chỉ số cho mỗi loại
    totals_at_0_5 = {"acc": 0.0, "f1": 0.0, "precision": 0.0, "recall": 0.0, "ppr": 0.0}
    totals_at_t_star = {"acc": 0.0, "f1": 0.0, "precision": 0.0, "recall": 0.0, "ppr": 0.0}

    # Biến đếm số file đã tìm thấy cho mỗi loại
    file_count_0_5 = 0
    file_count_t_star = 0
    processed_files_count = 0

    print(f"Bắt đầu quét thư mục '{folder_path}' từ index {start_index} đến {end_index}...\n")

    # Duyệt qua các file trong khoảng index chỉ định
    for i in range(start_index, end_index + 1):
        # Lưu ý: Tên file được lấy từ code bạn cung cấp
        file_name = f"original_run_{i}.summary.txt"
        file_path = os.path.join(folder_path, file_name)

        if os.path.exists(file_path):
            try:
                is_processed = False
                with open(file_path, 'r', encoding='utf-8') as f:
                    for line in f:
                        line_stripped = line.strip()

                        # Tìm và xử lý dòng 'Test@0.5'
                        if line_stripped.startswith('Test@0.5:'):
                            dict_str = line_stripped.split('Test@0.5:')[1].strip()
                            metrics = ast.literal_eval(dict_str)

                            for key in totals_at_0_5:
                                totals_at_0_5[key] += metrics.get(key, 0.0)

                            file_count_0_5 += 1
                            is_processed = True

                        # Tìm và xử lý dòng 'Test@t*'
                        elif line_stripped.startswith('Test@t*:'):
                            dict_str = line_stripped.split('Test@t*:')[1].strip()
                            metrics = ast.literal_eval(dict_str)

                            for key in totals_at_t_star:
                                totals_at_t_star[key] += metrics.get(key, 0.0)

                            file_count_t_star += 1
                            is_processed = True

                if is_processed:
                    print(f"Đã xử lý file: {file_name}")
                    processed_files_count += 1

            except Exception as e:
                print(f"Lỗi khi xử lý file {file_name}: {e}")

    print("\n-------------------------------------------")

    results = {}
    # Tính toán giá trị trung bình cho 'Test@0.5'
    if file_count_0_5 > 0:
        averages_0_5 = {key: value / file_count_0_5 for key, value in totals_at_0_5.items()}
        results['Test@0.5'] = averages_0_5

    # Tính toán giá trị trung bình cho 'Test@t*'
    if file_count_t_star > 0:
        averages_t_star = {key: value / file_count_t_star for key, value in totals_at_t_star.items()}
        results['Test@t*'] = averages_t_star

    if processed_files_count > 0:
        print(f"Đã xử lý thành công tổng cộng {processed_files_count} file.")
        return results
    else:
        print("Không tìm thấy hoặc xử lý được file nào trong khoảng index đã cho.")
        return None

    
class EarlyStopper:
    def __init__(self, patience=7, min_delta=1e-4, start_after=0, restore_best=True):
        self.patience = patience
        self.min_delta = min_delta
        self.start_after = start_after
        self.restore_best = restore_best
        self.best = -float("inf")
        self.wait = 0
        self.should_stop = False
        self.best_state = None
        self.best_epoch = -1

    def step(self, metric, epoch, model=None):
        # Chưa cho phép dừng trước start_after
        if epoch <= self.start_after:
            if metric > self.best + self.min_delta:
                self.best = metric
                self.wait = 0
                if model is not None:
                    self.best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
                    self.best_epoch = epoch
            return False  # chưa stop

        if metric > self.best + self.min_delta:
            self.best = metric
            self.wait = 0
            if model is not None:
                self.best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
                self.best_epoch = epoch
        else:
            self.wait += 1
            if self.wait >= self.patience:
                self.should_stop = True
        return self.should_stop


class_names = ["Non-ASD", "ASD"]
num_classes = 2


# ===================== EMA weights =====================
class EMA:
    def __init__(self, model: nn.Module, decay: float = 0.999):
        self.decay = decay
        self.shadow = {k: v.detach().clone() for k, v in model.state_dict().items()}
        self.backup = None

    @torch.no_grad()
    def update(self, model: nn.Module):
        for k, v in model.state_dict().items():
            if k in self.shadow:
                self.shadow[k].mul_(self.decay).add_(v.detach(), alpha=1 - self.decay)
            else:
                self.shadow[k] = v.detach().clone()

    @torch.no_grad()
    def store(self, model: nn.Module):
        self.backup = {k: v.detach().clone() for k, v in model.state_dict().items()}

    @torch.no_grad()
    def copy_to(self, model: nn.Module):
        model.load_state_dict(self.shadow, strict=True)

    @torch.no_grad()
    def restore(self, model: nn.Module):
        if self.backup is not None:
            model.load_state_dict(self.backup, strict=True)
            self.backup = None

    def state_dict(self):
        return {k: v.clone() for k, v in self.shadow.items()}


# ================ Temperature Scaling (hiệu chuẩn) ====================
class TempScale(nn.Module):
    def __init__(self):
        super().__init__()
        self.T = nn.Parameter(torch.ones(1))

    def forward(self, logits: torch.Tensor):
        return logits / self.T.clamp_min(1e-3)

    def fit(self, logits: torch.Tensor, labels: torch.Tensor, max_iter: int = 50):
        self.train()
        opt = torch.optim.LBFGS([self.T], lr=0.1, max_iter=max_iter)

        def _nll_closure():
            opt.zero_grad()
            loss = F.cross_entropy(self.forward(logits), labels)
            loss.backward()
            return loss

        opt.step(_nll_closure)
        self.eval()
        return self.T.detach().item()


# ----------------------------- Utils ---------------------------------
def set_seed(seed: int = 42):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = True


@torch.no_grad()
def compute_metrics(logits: torch.Tensor, y: torch.Tensor, threshold: float = 0.5):
    """
    Binary classification, class 1 = ASD.
    Hỗ trợ threshold để tính P/R/F1 và PPR.
    """
    device = logits.device
    probs = F.softmax(logits, dim=1)[:, 1]
    preds = (probs >= threshold).to(device=device, dtype=torch.long)
    y = y.to(device=device, dtype=torch.long)

    acc = (preds == y).float().mean().item()
    tp = ((preds == 1) & (y == 1)).sum().item()
    fp = ((preds == 1) & (y == 0)).sum().item()
    fn = ((preds == 0) & (y == 1)).sum().item()

    precision = tp / (tp + fp + 1e-8)
    recall = tp / (tp + fn + 1e-8)
    f1 = 2 * precision * recall / (precision + recall + 1e-8)
    ppr = preds.float().mean().item()  # Positive Prediction Rate
    return acc, f1, precision, recall, ppr


def find_best_threshold(logits: torch.Tensor, y: torch.Tensor, start=0.05, stop=0.95, step=0.01):
    """
    logits, y: CPU tensors.
    Quét threshold để tối đa F1 trên VAL.
    """
    probs = F.softmax(logits, dim=1)[:, 1].numpy()
    y_np = y.numpy().astype(int)
    best_t, best_f1 = 0.5, -1.0
    num = int((stop - start) / step) + 1
    for i in range(num):
        t = start + i * step
        pred = (probs >= t).astype(int)
        tp = ((pred == 1) & (y_np == 1)).sum()
        fp = ((pred == 1) & (y_np == 0)).sum()
        fn = ((pred == 0) & (y_np == 1)).sum()
        prec = tp / (tp + fp + 1e-8)
        rec = tp / (tp + fn + 1e-8)
        f1 = 2 * prec * rec / (prec + rec + 1e-8)
        if f1 > best_f1:
            best_f1, best_t = f1, float(t)
    return best_t, best_f1


def make_loaders(data_root: str, L: int, batch_size: int,
                 normalization: str = 'original',
                 remove_head_neck: bool = False,
                 include_dynamics: bool = False,
                 fps: float = 30.0,
                 dynamic_features: list = None):
    """
    Tạo DataLoaders với các tùy chọn normalization và dynamic features
    """
    entries = build_index(Path(data_root))
    splits = subject_wise_split(entries, train_ratio=0.7, val_ratio=0.15, seed=42)

    train_ds = Kinect2DNormalizedDataset(
        entries, splits.train, L=L,
        normalization=normalization,
        remove_head_neck=remove_head_neck,
        include_dynamics=include_dynamics,
        fps=fps,
        dynamic_features=dynamic_features
    )
    val_ds = Kinect2DNormalizedDataset(
        entries, splits.val, L=L,
        normalization=normalization,
        remove_head_neck=remove_head_neck,
        include_dynamics=include_dynamics,
        fps=fps,
        dynamic_features=dynamic_features
    )
    test_ds = Kinect2DNormalizedDataset(
        entries, splits.test, L=L,
        normalization=normalization,
        remove_head_neck=remove_head_neck,
        include_dynamics=include_dynamics,
        fps=fps,
        dynamic_features=dynamic_features
    )

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True,
                              num_workers=0, collate_fn=collate_fixedlen, drop_last=False)
    val_loader = DataLoader(val_ds, batch_size=batch_size, shuffle=False,
                            num_workers=0, collate_fn=collate_fixedlen, drop_last=False)
    test_loader = DataLoader(test_ds, batch_size=batch_size, shuffle=False,
                             num_workers=0, collate_fn=collate_fixedlen, drop_last=False)

    # Lấy thông tin về input size từ sample
    sample = train_ds[0]
    num_joints = sample['num_joints']

    return train_loader, val_loader, test_loader, num_joints


# ---------- Run Index & Logging Helpers ----------
def ensure_run_dir(base_dir: Path) -> Path:
    """Tạo thư mục run nếu chưa tồn tại"""
    base_dir.mkdir(parents=True, exist_ok=True)
    return base_dir


def next_run_index(run_dir: Path, prefix: str = "run") -> int:
    """
    Tìm index tiếp theo dựa trên các file có pattern: prefix_{n}.*
    """
    pattern = re.compile(rf"{prefix}_(\d+)\.(pt|log|summary\.txt)$")
    max_idx = -1
    for p in run_dir.iterdir():
        m = pattern.match(p.name)
        if m:
            n = int(m.group(1))
            if n > max_idx:
                max_idx = n
    return max_idx + 1


class TeeLogger:
    """Ghi log ra console + buffer để ghi file .log cuối buổi."""

    def __init__(self):
        self._lines = []

    def log(self, s: str):
        print(s)
        self._lines.append(s)

    def dump_to_file(self, path: Path):
        path.write_text("\n".join(self._lines), encoding="utf-8")


# ==================== XÂY DỰNG INPUT LSTM TỪ KEYPOINTS + DYNAMICS ====================

def build_lstm_input(batch, device, include_dynamics: bool, dynamic_features):
    """
    Xây dựng input (B, L, D) cho LSTM từ:
      - keypoints: (B, L, J, 2)
      - optional dynamics:
          dynamic_velocity:       (B, L, J, 2)
          dynamic_acceleration:   (B, L, J, 2)
          dynamic_motion_energy:  (B, L, J)
          dynamic_bone_lengths:   (B, L, num_bones)
          dynamic_joint_angles:   (B, L, num_angles)

    Trả về:
      x: (B, L, D)
      lengths: (B,)
    """
    if dynamic_features is None:
        dynamic_features = []

    # Base: keypoints (B, L, J, 2)
    kp = batch["keypoints"].to(device)      # (B, L, J, 2)
    B, L, J, C = kp.shape                   # C = 2
    x_list = [kp.view(B, L, -1)]            # (B, L, J*2)

    if include_dynamics:
        # velocity
        if "velocity" in dynamic_features and "dynamic_velocity" in batch:
            v = batch["dynamic_velocity"].to(device)      # (B, L, J, 2)
            x_list.append(v.view(B, L, -1))               # + J*2

        # acceleration
        if "acceleration" in dynamic_features and "dynamic_acceleration" in batch:
            a = batch["dynamic_acceleration"].to(device)  # (B, L, J, 2)
            x_list.append(a.view(B, L, -1))               # + J*2

        # motion_energy
        if "motion_energy" in dynamic_features and "dynamic_motion_energy" in batch:
            me = batch["dynamic_motion_energy"].to(device)    # (B, L, J)
            x_list.append(me.view(B, L, -1))                  # + J

        # # bone_lengths
        # if "bone_lengths" in dynamic_features and "dynamic_bone_lengths" in batch:
        #     bl = batch["dynamic_bone_lengths"].to(device)     # (B, L, num_bones)
        #     x_list.append(bl.view(B, L, -1))                  # + num_bones

        # # joint_angles
        # if "joint_angles" in dynamic_features and "dynamic_joint_angles" in batch:
        #     ja = batch["dynamic_joint_angles"].to(device)     # (B, L, num_angles)
        #     x_list.append(ja.view(B, L, -1))                  # + num_angles

    x = torch.cat(x_list, dim=-1)        # (B, L, D)
    lengths = torch.full((B,), L, dtype=torch.long, device=device)
    return x, lengths


@torch.no_grad()
def collect_logits_labels(model: nn.Module, loader: DataLoader, device,
                          use_ema: bool = False, ema: EMA = None,
                          include_dynamics: bool = False, dynamic_features=None):
    """
    Thu thập logits/labels (CPU) để hiệu chuẩn & tìm ngưỡng.
    """
    if dynamic_features is None:
        dynamic_features = []

    model.eval()
    if use_ema and (ema is not None):
        ema.store(model)
        ema.copy_to(model)

    all_logits, all_y = [], []
    for b in loader:
        x, lengths = build_lstm_input(
            b,
            device=device,
            include_dynamics=include_dynamics,
            dynamic_features=dynamic_features,
        )
        y = b["label"].to(device).long()
        logits = model(x, lengths)
        all_logits.append(logits.detach().cpu())
        all_y.append(y.detach().cpu())

    if use_ema and (ema is not None):
        ema.restore(model)

    return torch.cat(all_logits, dim=0), torch.cat(all_y, dim=0)


def train_one_epoch(model, loader, optim, criterion, device, ema: EMA = None,
                    scheduler=None, include_dynamics: bool = False, dynamic_features=None):
    model.train()
    total_loss, n = 0.0, 0
    all_logits, all_labels = [], []

    if dynamic_features is None:
        dynamic_features = []

    for batch in loader:
        # Xây input (B, L, D) cho LSTM từ keypoints + dynamics
        x, lengths = build_lstm_input(
            batch,
            device=device,
            include_dynamics=include_dynamics,
            dynamic_features=dynamic_features,
        )
        y = batch["label"].to(device)

        optim.zero_grad()
        logits = model(x, lengths)
        loss = criterion(logits, y)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optim.step()
        
        # Step scheduler after each batch (for OneCycleLR)
        if scheduler is not None:
            scheduler.step()

        if ema is not None:
            ema.update(model)

        B = y.size(0)
        total_loss += loss.item() * B
        n += B
        all_logits.append(logits.detach())
        all_labels.append(y.detach())

    logits = torch.cat(all_logits, dim=0)
    labels = torch.cat(all_labels, dim=0)
    acc, f1, p, r, ppr = compute_metrics(logits, labels, threshold=0.5)
    return total_loss / n, acc, f1, p, r, ppr


@torch.no_grad()
def evaluate(model, loader, criterion, device,
             use_ema: bool = False, ema: EMA = None, threshold: float = 0.5,
             include_dynamics: bool = False, dynamic_features=None):
    """
    Đánh giá model; trả thêm logits/labels CPU để dùng cho TS & tìm t*
    """
    if dynamic_features is None:
        dynamic_features = []

    model.eval()
    if use_ema and (ema is not None):
        ema.store(model)
        ema.copy_to(model)

    total_loss, n = 0.0, 0
    all_logits, all_labels = [], []
    for batch in loader:
        x, lengths = build_lstm_input(
            batch,
            device=device,
            include_dynamics=include_dynamics,
            dynamic_features=dynamic_features,
        )
        y = batch["label"].to(device)

        logits = model(x, lengths)
        loss = criterion(logits, y)

        B = y.size(0)
        total_loss += loss.item() * B
        n += B
        all_logits.append(logits.detach())
        all_labels.append(y.detach())

    if use_ema and (ema is not None):
        ema.restore(model)

    logits = torch.cat(all_logits, dim=0)
    labels = torch.cat(all_labels, dim=0)

    acc, f1, p, r, ppr = compute_metrics(logits, labels, threshold=threshold)
    return total_loss / n, acc, f1, p, r, ppr, logits.cpu(), labels.cpu()


# ----------------------------- Main ----------------------------------
def main():
    parser = argparse.ArgumentParser(description='Train BiLSTM for ASD classification with normalization options')

    # Data arguments
    parser.add_argument("--data_root", type=str, default="",
                        help="Root directory of dataset")
    parser.add_argument("--L", type=int, default=128,
                        help="Sequence length after resampling")

    # Normalization arguments
    parser.add_argument("--normalization", type=str, default='original',
                        choices=['original', 'spine_base', 'scale', 'combined', 'bbox', 'zscore', 'rotate'],
                        help="Normalization method to use")
    parser.add_argument("--remove_head_neck", "--remove-head-neck", action="store_true",
                        help="Remove selected joints (ST-GCN logic): indices [1,9,10,11,12,13,14] (25 -> 18)")

    # Dynamic features arguments
    parser.add_argument("--include_dynamics", action="store_true",
                        help="Include dynamic features (velocity, acceleration, etc.)")
    parser.add_argument("--fps", type=float, default=30.0,
                        help="Frame rate of videos (for computing dynamics)")
    parser.add_argument("--dynamic_features", nargs='+',
                        default=['motion_energy', 'velocity', 'acceleration'],
                        choices=['velocity', 'acceleration', 'bone_lengths', 'joint_angles', 'motion_energy'],
                        help="List of dynamic features to include")

    # Model arguments
    parser.add_argument("--model_type", type=str, default="attentive",
                        choices=['attentive', 'standard'],
                        help="Type of BiLSTM model to use")
    parser.add_argument("--hidden", type=int, default=128,
                        help="Hidden size of LSTM")
    parser.add_argument("--layers", type=int, default=2,
                        help="Number of LSTM layers")
    parser.add_argument("--dropout", type=float, default=0.3,
                        help="Dropout rate")

    # Training arguments
    parser.add_argument("--epochs", type=int, default=80,
                        help="Number of training epochs")
    parser.add_argument("--batch_size", type=int, default=48,
                        help="Batch size")
    parser.add_argument("--lr", type=float, default=0.0001,
                        help="Learning rate (max_lr for OneCycleLR)")
    parser.add_argument("--seed", type=int, default=42,
                        help="Random seed")

    # OneCycleLR scheduler arguments
    parser.add_argument("--pct_start", type=float, default=0.3,
                        help="Percentage of cycle spent increasing learning rate (warm-up phase)")
    parser.add_argument("--div_factor", type=float, default=25.0,
                        help="Initial learning rate = max_lr / div_factor")
    parser.add_argument("--final_div_factor", type=float, default=1e4,
                        help="Final learning rate = initial_lr / final_div_factor")
    parser.add_argument("--anneal_strategy", type=str, default='cos',
                        choices=['cos', 'linear'],
                        help="Annealing strategy: 'cos' for cosine or 'linear'")

    # Early stopping arguments
    parser.add_argument("--es_alpha", type=float, default=1.0,
                        help="Coefficient for |PPR-0.5| penalty in ES metric")
    parser.add_argument("--no_temp_scale", action="store_true",
                        help="Disable Temperature Scaling before finding threshold")

    parser.add_argument("--disable_early_stopping", action="store_true", default=True,
                        help="Set this flag to Disable Early Stopping (Turn it False)")

    # Save arguments
    parser.add_argument("--save_dir", type=str, default="experiments_BiLSTM_Test",
                        help="Base directory to save experiments")
    parser.add_argument("--exp_name", type=str, default=None,
                        help="Experiment name (auto-generated if not provided)")

    args = parser.parse_args()

    logger = TeeLogger()

    # Generate experiment name if not provided
    if args.exp_name is None:
        joints_suffix = '_18joints' if args.remove_head_neck else '_25joints'
        dynamics_suffix = ''
        if args.include_dynamics:
            features_str = '_'.join(args.dynamic_features[:2])
            dynamics_suffix = f'_dyn_{features_str}'
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        args.exp_name = f"bilstm_{args.model_type}_{args.normalization}{joints_suffix}{dynamics_suffix}_seed{args.seed}_{timestamp}"

    # Setup directories - tạo thư mục theo normalization method
    base_save_dir = Path(args.save_dir) / args.normalization
    exp_dir = base_save_dir / args.exp_name
    exp_dir.mkdir(parents=True, exist_ok=True)

    run_dir = exp_dir / "runs"
    run_dir.mkdir(exist_ok=True)

    plots_dir = exp_dir / "plots"
    plots_dir.mkdir(exist_ok=True)

    # Setup run index
    run_idx = next_run_index(run_dir, prefix="run")
    run_base = f"run_{run_idx}"
    ckpt_path = run_dir / f"{run_base}.pt"
    log_path = run_dir / f"{run_base}.log"
    summary_path = run_dir / f"{run_base}.summary.txt"

    # Header log
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    logger.log(f"{'=' * 80}")
    logger.log(f"NEW TRAINING RUN: {args.exp_name}")
    logger.log(f"{'=' * 80}")
    logger.log(f"Start time: {now}")
    logger.log(f"Experiment directory: {exp_dir}")
    logger.log(f"Save paths:")
    logger.log(f"  - Checkpoint: {ckpt_path}")
    logger.log(f"  - Log: {log_path}")
    logger.log(f"  - Summary: {summary_path}")
    logger.log(f"  - Plots: {plots_dir}")

    set_seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    logger.log(f"\nDevice: {device}")

    # Configuration summary
    logger.log(f"\n{'=' * 80}")
    logger.log("CONFIGURATION")
    logger.log(f"{'=' * 80}")
    logger.log(f"Data:")
    logger.log(f"  - Root: {args.data_root}")
    logger.log(f"  - Sequence length: {args.L}")
    logger.log(f"\nNormalization:")
    logger.log(f"  - Method: {args.normalization}")
    logger.log(f"  - Remove Head & Neck: {args.remove_head_neck}")
    logger.log(f"  - Expected joints: {18 if args.remove_head_neck else 25}")
    logger.log(f"\nDynamic Features:")
    logger.log(f"  - Include dynamics: {args.include_dynamics}")
    if args.include_dynamics:
        logger.log(f"  - FPS: {args.fps}")
        logger.log(f"  - Features: {args.dynamic_features}")
    logger.log(f"\nModel:")
    logger.log(f"  - Type: {args.model_type}")
    logger.log(f"  - Hidden size: {args.hidden}")
    logger.log(f"  - Num layers: {args.layers}")
    logger.log(f"  - Dropout: {args.dropout}")
    logger.log(f"\nTraining:")
    logger.log(f"  - Epochs: {args.epochs}")
    logger.log(f"  - Batch size: {args.batch_size}")
    logger.log(f"  - Learning rate: {args.lr}")
    logger.log(f"  - Seed: {args.seed}")
    logger.log(f"  - ES alpha: {args.es_alpha}")
    logger.log(f"  - Temperature scaling: {not args.no_temp_scale}")
    logger.log(f"\nOneCycleLR Scheduler:")
    logger.log(f"  - Warm-up phase: {args.pct_start*100:.0f}% of training")
    logger.log(f"  - Initial LR: {args.lr/args.div_factor:.6f} (max_lr/{args.div_factor})")
    logger.log(f"  - Max LR: {args.lr}")
    logger.log(f"  - Final LR: ~{args.lr/args.div_factor/args.final_div_factor:.8f}")
    logger.log(f"  - Annealing strategy: {args.anneal_strategy}")

    # Loaders
    logger.log(f"\n{'=' * 80}")
    logger.log("LOADING DATA")
    logger.log(f"{'=' * 80}")

    train_loader, val_loader, test_loader, num_joints = make_loaders(
        args.data_root, args.L, args.batch_size,
        normalization=args.normalization,
        remove_head_neck=args.remove_head_neck,
        include_dynamics=args.include_dynamics,
        fps=args.fps,
        dynamic_features=args.dynamic_features if args.include_dynamics else None
    )

    logger.log(f"Detected joints: {num_joints}")
    logger.log(f"Train batches: {len(train_loader)}")
    logger.log(f"Val batches: {len(val_loader)}")
    logger.log(f"Test batches: {len(test_loader)}")

    # Tính input_size tự động từ 1 batch (có xét dynamics)
    # first_batch = next(iter(train_loader))
    # with torch.no_grad():
    #     x_example, _ = build_lstm_input(
    #         first_batch,
    #         device=device,
    #         include_dynamics=args.include_dynamics,
    #         dynamic_features=args.dynamic_features if args.include_dynamics else [],
    #     )
    # input_size = x_example.shape[-1]
    #
    # logger.log(
    #     f"Input size: {input_size} "
    #     f"(joints: {num_joints}, "
    #     f"include_dynamics={args.include_dynamics}, "
    #     f"features={args.dynamic_features if args.include_dynamics else ['keypoints_only']})"
    # )


    # Lấy trực tiếp 1 sample từ dataset, không dùng DataLoader (không tiêu RNG)
    sample = train_loader.dataset[0]  # đây là Kinect2DNormalizedDataset

    # keypoints: (T, J, 2)
    kp = sample["keypoints"]  # tensor
    T, J, C = kp.shape  # C = 2

    # Base feature per timestep
    per_timestep_dim = J * C  # J*2

    if args.include_dynamics:
        # dynamic_velocity: (T, J, 2)
        if "velocity" in args.dynamic_features and "dynamic_velocity" in sample:
            per_timestep_dim += sample["dynamic_velocity"].numel() // T  # J*2

        # dynamic_acceleration: (T, J, 2)
        if "acceleration" in args.dynamic_features and "dynamic_acceleration" in sample:
            per_timestep_dim += sample["dynamic_acceleration"].numel() // T

        # dynamic_motion_energy: (T, J)
        if "motion_energy" in args.dynamic_features and "dynamic_motion_energy" in sample:
            per_timestep_dim += sample["dynamic_motion_energy"].numel() // T  # J

        # dynamic_bone_lengths: (T, num_bones)
        if "bone_lengths" in args.dynamic_features and "dynamic_bone_lengths" in sample:
            per_timestep_dim += sample["dynamic_bone_lengths"].numel() // T

        # dynamic_joint_angles: (T, num_angles)
        if "joint_angles" in args.dynamic_features and "dynamic_joint_angles" in sample:
            per_timestep_dim += sample["dynamic_joint_angles"].numel() // T

    input_size = per_timestep_dim

    logger.log(
        f"Input size: {input_size} "
        f"(joints: {J}, "
        f"include_dynamics={args.include_dynamics}, "
        f"features={args.dynamic_features if args.include_dynamics else ['keypoints_only']})"
    )

    # Build model
    logger.log(f"\n{'=' * 80}")
    logger.log("BUILDING MODEL")
    logger.log(f"{'=' * 80}")

    if args.model_type == 'attentive':
        model = AttentiveBiLSTM(
            input_size=input_size,
            hidden=args.hidden,
            num_layers=args.layers,
            num_classes=2,
            dropout=args.dropout
        ).to(device)
        logger.log("Using AttentiveBiLSTM with attention mechanism")
    else:
        model = BiLSTMClassifier(
            input_size=input_size,
            hidden=args.hidden,
            num_layers=args.layers,
            num_classes=2,
            dropout=args.dropout
        ).to(device)
        logger.log("Using standard BiLSTMClassifier")

    total_params = sum(p.numel() for p in model.parameters())
    trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    logger.log(f"Total parameters: {total_params:,}")
    logger.log(f"Trainable parameters: {trainable_params:,}")

    # EMA
    ema = EMA(model, decay=0.999)
    # ema = None
    # Loss với weighting cân bằng lớp
    labels_train = []
    for b in train_loader:
        labels_train.extend([int(x) for x in b["label"]])
    pos = sum(labels_train)
    neg = len(labels_train) - pos

    if pos > 0 and neg > 0:
        w_pos = neg / (pos + 1e-8)
        w_neg = pos / (neg + 1e-8)
        weights = torch.tensor([w_neg, w_pos], dtype=torch.float32, device=device)
    else:
        weights = torch.tensor([1.0, 1.0], dtype=torch.float32, device=device)

    logger.log(f"\n{'=' * 80}")
    logger.log("CLASS BALANCE")
    logger.log(f"{'=' * 80}")
    logger.log(f"Train set: ASD={pos}, Non-ASD={neg}")
    logger.log(f"Class weights: {weights.tolist()}")

    criterion = nn.CrossEntropyLoss(weight=weights)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-1)
    
    # OneCycleLR with warm-up phase
    scheduler = torch.optim.lr_scheduler.OneCycleLR(
        optimizer,
        max_lr=args.lr,
        epochs=args.epochs,
        steps_per_epoch=len(train_loader),
        pct_start=args.pct_start,
        anneal_strategy=args.anneal_strategy,
        div_factor=args.div_factor,
        final_div_factor=args.final_div_factor
    )

    best_f1 = -1.0
    best_acc, best_state = -1.0, None  # <--- Đổi tên biến
    best_epoch = -1

    stopper = EarlyStopper(
        patience=15,
        min_delta=1e-3,
        start_after=5,
        restore_best=True
    )

    ema_f1 = None
    ema_acc = None
    beta = 0.9
    history = TrainHistory.empty()

    # =============== Train loop ===============
    logger.log(f"\n{'=' * 80}")
    logger.log("STARTING TRAINING")
    logger.log(f"{'=' * 80}")

    for epoch in range(1, args.epochs + 1):
        tr_loss, tr_acc, tr_f1, tr_p, tr_r, tr_ppr = train_one_epoch(
            model, train_loader, optimizer, criterion, device, ema=ema,
            scheduler=scheduler,  # Pass scheduler for per-batch stepping
            include_dynamics=args.include_dynamics,
            dynamic_features=args.dynamic_features if args.include_dynamics else [],
        )
        va_loss, va_acc, va_f1, va_p, va_r, va_ppr, va_logits_cpu, va_labels_cpu = evaluate(
            model, val_loader, criterion, device,
            use_ema=True, ema=ema, threshold=0.5,
            include_dynamics=args.include_dynamics,
            dynamic_features=args.dynamic_features if args.include_dynamics else [],
        )

        # OneCycleLR steps per batch, no need to step here
        # Track EMA of accuracy for monitoring
        ema_acc = va_acc if ema_acc is None else beta * ema_acc + (1 - beta) * va_acc

        line = (f"[Epoch {epoch:02d}/{args.epochs}] "
                f"Train: loss={tr_loss:.4f} acc={tr_acc:.3f} f1={tr_f1:.3f} ppr={tr_ppr:.3f} | "
                f"Val: loss={va_loss:.4f} acc={va_acc:.3f} f1={va_f1:.3f} "
                f"(p={va_p:.3f} r={va_r:.3f} ppr={va_ppr:.3f})")
        logger.log(line)

        history.append(
            epoch=epoch,
            tr_loss=tr_loss, va_loss=va_loss,
            tr_acc=tr_acc, va_acc=va_acc,
            tr_f1=tr_f1, va_f1=va_f1
        )

        # if va_f1 > best_f1:
        #     best_f1 = va_f1
        if va_acc > best_acc:  # <--- So sánh Accuracy
            best_acc = va_acc  # <--- Cập nhật Accuracy tốt nhất
            best_epoch = epoch
            best_state = {
                "model": ema.state_dict(),
                # "model": model.state_dict(),
                "epoch": epoch,
                "val_f1": va_f1,
                "val_acc": va_acc,  # <--- Nên lưu thêm cái này cho chắc
                "val_metrics": {"loss": va_loss, "acc": va_acc, "f1": va_f1, "precision": va_p, "recall": va_r, "ppr": va_ppr},
                "args": vars(args),
                "num_joints": num_joints,
                "input_size": input_size
            }
            torch.save(best_state, ckpt_path)
            # logger.log(f"  → Saved best checkpoint (EMA) - Val F1: {va_f1:.4f}")
            logger.log(f"  → Saved best checkpoint (ema) - Val Acc: {va_acc:.4f}")  # <--- Sửa log

        # Early Stopping với metric phạt PPR lệch
        # es_metric = va_f1 - args.es_alpha * abs(va_ppr - 0.5)
        # if stopper.step(es_metric, epoch, model=model):
        #     logger.log(f"\n⚠️ Early stopping at epoch {epoch}")
        #     logger.log(f"   Best epoch: {stopper.best_epoch} with ES metric ≈ {stopper.best:.4f}")
        #     logger.log(f"   Best Val F1: {best_f1:.4f}")
        #     break
        if not args.disable_early_stopping:  # <--- Chỉ chạy nếu KHÔNG có cờ disable
            # es_metric = va_f1 - args.es_alpha * abs(va_ppr - 0.5)
            # if stopper.step(es_metric, epoch, model=model):
            #     logger.log(f"\n⚠️ Early stopping at epoch {epoch}")
            #     logger.log(f"   Best poch: {stopper.best_epoch} with ES metric ≈ {stopper.beste:.4f}")
            #     # logger.log(f"   Best Val F1: {best_f1:.4f}")
            #     logger.log(f"Best Val Acc:{best_acc:.4f}")
            #     break
            if epoch == args.epochs:
                logger.log("\n(Early Stopping is DISABLED, trained until last epoch)")
        else:
            # (Tùy chọn) Log nhẹ để biết là đang tắt ES
            if epoch == args.epochs:
                logger.log("\n(Early Stopping is DISABLED, trained until last epoch)")

    # =============== Load best (EMA weights) ===============
    logger.log(f"\n{'=' * 80}")
    logger.log("LOADING BEST MODEL")
    logger.log(f"{'=' * 80}")

    if best_state is None and ckpt_path.exists():
        best_state = torch.load(ckpt_path, map_location=device)
        model.load_state_dict(best_state["model"])
        best_epoch = best_state.get("epoch", -1)
        best_f1 = best_state.get("val_f1", -1.0)
        best_acc = best_state.get("val_acc", -1.0)
    elif best_state is not None:
        model.load_state_dict(best_state["model"])

    logger.log(f"Loaded best model from epoch {best_epoch} with Val Acc: {best_acc:.4f}")

    # =============== Temperature scaling + tìm threshold trên VAL ===============
    logger.log(f"\n{'=' * 80}")
    logger.log("CALIBRATION & THRESHOLD TUNING")
    logger.log(f"{'=' * 80}")

    val_logits_cpu, val_labels_cpu = collect_logits_labels(
        model, val_loader, device,
        use_ema=False, ema=None,
        include_dynamics=args.include_dynamics,
        dynamic_features=args.dynamic_features if args.include_dynamics else [],
    )

    tscale_T = None
    if not args.no_temp_scale:
        ts = TempScale().to(device)
        val_logits_dev = val_logits_cpu.to(device)
        val_labels_dev = val_labels_cpu.to(device).long()
        tscale_T = ts.fit(val_logits_dev, val_labels_dev, max_iter=50)
        val_logits_for_t = ts(val_logits_dev).detach().cpu()
        logger.log(f"Temperature Scaling: T = {tscale_T:.4f}")
    else:
        val_logits_for_t = val_logits_cpu
        logger.log("Temperature Scaling: DISABLED")

    t_star, val_f1_star = find_best_threshold(val_logits_for_t, val_labels_cpu, start=0.05, stop=0.95, step=0.01)
    logger.log(f"Optimal threshold: t* = {t_star:.3f} (Val F1 = {val_f1_star:.4f})")

    # =============== Đánh giá TEST @0.5 và @t* ===============
    logger.log(f"\n{'=' * 80}")
    logger.log("TEST SET EVALUATION")
    logger.log(f"{'=' * 80}")

    te_loss, te_acc, te_f1, te_p, te_r, te_ppr, te_logits_cpu, te_labels_cpu = evaluate(
        model, test_loader, criterion, device,
        use_ema=True, ema=None, threshold=0.5,
        include_dynamics=args.include_dynamics,
        dynamic_features=args.dynamic_features if args.include_dynamics else [],
    )

    if not args.no_temp_scale:
        te_logits_for_t = ts(te_logits_cpu.to(device)).detach().cpu()
    else:
        te_logits_for_t = te_logits_cpu

    te_acc_t, te_f1_t, te_p_t, te_r_t, te_ppr_t = compute_metrics(te_logits_for_t, te_labels_cpu, threshold=t_star)

    logger.log(f"\nBEST MODEL (Epoch {best_epoch}):")
    # logger.log(f"  Val F1: {best_f1:.4f}")
    logger.log(f"Best Val Acc:          {best_acc:.4f}")

    logger.log(f"\nVALIDATION SET:")
    if tscale_T is not None:
        logger.log(f"  Temperature: T = {tscale_T:.4f}")
    logger.log(f"  Optimal threshold: t* = {t_star:.3f}")
    logger.log(f"  F1 at t*: {val_f1_star:.4f}")

    logger.log(f"\nTEST SET @ threshold=0.5:")
    logger.log(f"  Loss:      {te_loss:.4f}")
    logger.log(f"  Accuracy:  {te_acc:.4f}")
    logger.log(f"  F1 Score:  {te_f1:.4f}")
    logger.log(f"  Precision: {te_p:.4f}")
    logger.log(f"  Recall:    {te_r:.4f}")
    logger.log(f"  PPR:       {te_ppr:.4f}")

    logger.log(f"\nTEST SET @ threshold={t_star:.3f}:")
    logger.log(f"  Accuracy:  {te_acc_t:.4f}")
    logger.log(f"  F1 Score:  {te_f1_t:.4f}")
    logger.log(f"  Precision: {te_p_t:.4f}")
    logger.log(f"  Recall:    {te_r_t:.4f}")
    logger.log(f"  PPR:       {te_ppr_t:.4f}")

    # =============== Summary & logs ===============
    logger.log(f"\n{'=' * 80}")
    logger.log("SAVING RESULTS")
    logger.log(f"{'=' * 80}")

    summary = {
        "experiment": {
            "name": args.exp_name,
            "datetime": now,
            "device": str(device)
        },
        "configuration": {
            "data_root": args.data_root,
            "sequence_length": args.L,
            "normalization": args.normalization,
            "remove_head_neck": args.remove_head_neck,
            "num_joints": num_joints,
            "input_size": input_size,
            "include_dynamics": args.include_dynamics,
            "dynamic_features": args.dynamic_features if args.include_dynamics else None,
            "fps": args.fps if args.include_dynamics else None,
            "model_type": args.model_type,
            "hidden_size": args.hidden,
            "num_layers": args.layers,
            "dropout": args.dropout,
            "batch_size": args.batch_size,
            "learning_rate": args.lr,
            "epochs": args.epochs,
            "seed": args.seed,
            "scheduler": {
                "type": "OneCycleLR",
                "pct_start": args.pct_start,
                "div_factor": args.div_factor,
                "final_div_factor": args.final_div_factor,
                "anneal_strategy": args.anneal_strategy
            }
        },
        "training": {
            "best_epoch": best_epoch,
            "best_val_metrics": best_state.get("val_metrics", {}) if best_state else {},
            "total_epochs_trained": epoch,
            "early_stopped": epoch < args.epochs
        },
        "calibration": {
            "temperature_scaling_enabled": not args.no_temp_scale,
            "temperature": tscale_T,
            "optimal_threshold": t_star,
            "val_f1_at_threshold": val_f1_star
        },
        "test_results": {
            "at_threshold_0.5": {
                "loss": te_loss,
                "accuracy": te_acc,
                "f1_score": te_f1,
                "precision": te_p,
                "recall": te_r,
                "ppr": te_ppr
            },
            "at_optimal_threshold": {
                "threshold": t_star,
                "accuracy": te_acc_t,
                "f1_score": te_f1_t,
                "precision": te_p_t,
                "recall": te_r_t,
                "ppr": te_ppr_t
            }
        }
    }

    # Save summary as JSON
    summary_json_path = exp_dir / f"{run_base}_summary.json"
    with open(summary_json_path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2)
    logger.log(f"✓ Saved JSON summary: {summary_json_path}")

    # Save summary as text
    summary_text = f"""
{'=' * 80}
EXPERIMENT SUMMARY: {args.exp_name}
{'=' * 80}

CONFIGURATION
{'-' * 80}
Normalization Method:  {args.normalization}
Remove Head & Neck:    {args.remove_head_neck}
Number of Joints:      {num_joints}
Input Size:            {input_size}
Include Dynamics:      {args.include_dynamics}
Dynamic Features:      {args.dynamic_features if args.include_dynamics else 'N/A'}
Model Type:            {args.model_type}
Hidden Size:           {args.hidden}
Num Layers:            {args.layers}
Dropout:               {args.dropout}
Sequence Length:       {args.L}
Batch Size:            {args.batch_size}
Learning Rate:         {args.lr}
Seed:                  {args.seed}
Scheduler:             OneCycleLR
  - Warm-up:           {args.pct_start*100:.0f}%
  - Div factor:        {args.div_factor}
  - Final div factor:  {args.final_div_factor}
  - Annealing:         {args.anneal_strategy}

TRAINING RESULTS
{'-' * 80}
Best Epoch:            {best_epoch}
Total Epochs:          {epoch}
Early Stopped:         {epoch < args.epochs}
Best Val F1:           {best_acc:.4f}
Best Val Accuracy:     {best_state.get('val_metrics', {}).get('acc', 0):.4f}

CALIBRATION
{'-' * 80}
Temperature Scaling:   {'Enabled' if not args.no_temp_scale else 'Disabled'}
Temperature (T):       {tscale_T if tscale_T else 'N/A'}
Optimal Threshold:     {t_star:.3f}
Val F1 at t*:          {val_f1_star:.4f}

TEST RESULTS @ threshold=0.5
{'-' * 80}
Loss:                  {te_loss:.4f}
Accuracy:              {te_acc:.4f}
F1 Score:              {te_f1:.4f}
Precision:             {te_p:.4f}
Recall:                {te_r:.4f}
PPR:                   {te_ppr:.4f}

TEST RESULTS @ threshold={t_star:.3f}
{'-' * 80}
Accuracy:              {te_acc_t:.4f}
F1 Score:              {te_f1_t:.4f}
Precision:             {te_p_t:.4f}
Recall:                {te_r_t:.4f}
PPR:                   {te_ppr_t:.4f}

{'=' * 80}
"""
    summary_path.write_text(summary_text, encoding="utf-8")
    logger.log(f"✓ Saved text summary: {summary_path}")

    # Save training log
    logger.dump_to_file(log_path)
    logger.log(f"✓ Saved training log: {log_path}")

    # =============== Plot training curves ===============
    logger.log(f"\n{'=' * 80}")
    logger.log("GENERATING PLOTS")
    logger.log(f"{'=' * 80}")

    plot_title = f"{args.model_type.upper()} - {args.normalization}"
    if args.remove_head_neck:
        plot_title += " (18 joints)"
    else:
        plot_title += " (25 joints)"

    plot_path = plots_dir / f"{run_base}_training_curves.png"
    plot_loss_acc(history, plot_path, title=plot_title)
    logger.log(f"✓ Saved training curves: {plot_path}")

    # =============== Confusion matrices ===============
    # Val confusion matrix
    cm_val = compute_cm_from_logits(
        logits=val_logits_cpu.numpy(),
        labels=val_labels_cpu.numpy(),
        num_classes=num_classes,
        threshold=0.5
    )
    cm_val_path = plots_dir / f"{run_base}_cm_val.png"
    plot_confusion_matrix(
        cm_val, class_names, cm_val_path,
        normalize=False,
        title=f"Validation Confusion Matrix - {args.normalization}"
    )
    logger.log(f"✓ Saved Val confusion matrix: {cm_val_path}")

    # Test confusion matrix @ 0.5
    cm_test = compute_cm_from_logits(
        logits=te_logits_cpu.numpy(),
        labels=te_labels_cpu.numpy(),
        num_classes=num_classes,
        threshold=0.5
    )
    cm_test_path = plots_dir / f"{run_base}_cm_test_0.5.png"
    plot_confusion_matrix(
        cm_test, class_names, cm_test_path,
        normalize=False,
        title=f"Test Confusion Matrix @ 0.5 - {args.normalization}"
    )
    logger.log(f"✓ Saved Test confusion matrix (0.5): {cm_test_path}")

    # Test confusion matrix @ t*
    cm_test_t = compute_cm_from_logits(
        logits=te_logits_for_t.numpy(),
        labels=te_labels_cpu.numpy(),
        num_classes=num_classes,
        threshold=t_star
    )
    cm_test_t_path = plots_dir / f"{run_base}_cm_test_t_star.png"
    plot_confusion_matrix(
        cm_test_t, class_names, cm_test_t_path,
        normalize=False,
        title=f"Test Confusion Matrix @ t*={t_star:.2f} - {args.normalization}"
    )
    logger.log(f"✓ Saved Test confusion matrix (t*): {cm_test_t_path}")

    # =============== Final summary ===============
    logger.log(f"\n{'=' * 80}")
    logger.log("TRAINING COMPLETE")
    logger.log(f"{'=' * 80}")
    logger.log(f"Experiment:            {args.exp_name}")
    logger.log(f"Normalization:         {args.normalization}")
    logger.log(f"Results saved in:      {exp_dir}")
    logger.log(f"Best Val Acc:           {best_acc:.4f}")
    logger.log(f"Test F1 @ 0.5:         {te_f1:.4f}")
    logger.log(f"Test F1 @ t*={t_star:.2f}:    {te_f1_t:.4f}")
    logger.log(f"{'=' * 80}\n")