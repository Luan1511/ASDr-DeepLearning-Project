#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""

This file is intended to run as a standalone Python script (e.g. via nohup).
Notebook magics and shell escapes are commented out during export.
"""

# %% [markdown] (cell 1)
# # ST-GCN

# %% (cell 2)
import random
import re
from dataclasses import dataclass
from pathlib import Path
from typing import List, Tuple, Dict, Optional

import numpy as np
import pandas as pd
import torch
from torch.utils.data import Dataset, DataLoader

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

# Danh sách 17 khớp sau khi loại bỏ index [1, 9, 10, 11, 12, 13, 14, 15]
# (bỏ thêm SpineMid=15)
KINECT17_REDUCED = [
    "Head", "SpineShoulder",
    "ShoulderLeft", "ShoulderRight",
    "ElbowLeft", "ElbowRight",
    "WristLeft", "WristRight",
    "SpineBase",
    "HipLeft", "HipRight",
    "KneeLeft", "KneeRight",
    "AnkleLeft", "AnkleRight",
    "FootLeft", "FootRight"
]

# Backward-compat alias (older code used this name)
KINECT18_REDUCED = KINECT17_REDUCED

REMOVE_JOINT_INDICES = [1, 9, 10, 11, 12, 13, 14, 15]

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


def remove_selected_joints(seq: np.ndarray) -> np.ndarray:
    """
    Loại bỏ các keypoint theo index: [1, 9, 10, 11, 12, 13, 14, 15].

    Parameters
    ----------
    seq : np.ndarray, shape (T, 25, 2)
        Chuỗi keypoints với 25 joints

    Returns
    -------
    np.ndarray, shape (T, 17, 2)
        Chuỗi keypoints sau khi loại bỏ các joints được chỉ định
    """
    keep_indices = [i for i in range(seq.shape[1]) if i not in REMOVE_JOINT_INDICES]
    return seq[:, keep_indices, :]


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


def normalize_combined_spinebase_zscore(seq: np.ndarray,
                       spine_base_idx: int = 16) -> np.ndarray:
    
    seq_norm = normalize_by_spine_base(seq, spine_base_idx)
    seq_norm = normalize_zscore(seq_norm)

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


def get_kinect18_bone_pairs() -> List[Tuple[int, int]]:
    """Trả về danh sách các cặp joints tạo thành xương cho skeleton 18 joints đã rút gọn"""
    return [
        # Head & Spine
        (0, 1), (1, 8), (8, 9),
        # Left arm
        (1, 2), (2, 4), (4, 6),
        # Right arm
        (1, 3), (3, 5), (5, 7),
        # Left leg
        (9, 10), (10, 12), (12, 14), (14, 16),
        # Right leg
        (9, 11), (11, 13), (13, 15), (15, 17)
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


def get_kinect18_angle_triplets() -> List[Tuple[int, int, int]]:
    """Trả về danh sách các bộ 3 joints để tính góc cho skeleton 18 joints đã rút gọn"""
    return [
        # Left arm angles
        (1, 2, 4),  # SpineShoulder-ShoulderLeft-ElbowLeft
        (2, 4, 6),  # ShoulderLeft-ElbowLeft-WristLeft
        # Right arm angles
        (1, 3, 5),  # SpineShoulder-ShoulderRight-ElbowRight
        (3, 5, 7),  # ShoulderRight-ElbowRight-WristRight
        # Left leg angles
        (9, 10, 12),  # SpineBase-HipLeft-KneeLeft
        (10, 12, 14),  # HipLeft-KneeLeft-AnkleLeft
        # Right leg angles
        (9, 11, 13),  # SpineBase-HipRight-KneeRight
        (11, 13, 15),  # HipRight-KneeRight-AnkleRight
        # Spine angles
        (0, 1, 8),  # Head-SpineShoulder-SpineMid
        (1, 8, 9),  # SpineShoulder-SpineMid-SpineBase
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
            Nếu True, loại bỏ keypoints Head và Neck (25 joints -> 23 joints)
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

        # Nếu bật remove_head_neck, dùng skeleton rút gọn (hiện tại: 17 joints)
        if self.remove_head_neck:
            self.spine_base_idx = KINECT18_REDUCED.index("SpineBase")
            self.spine_shoulder_idx = KINECT18_REDUCED.index("SpineShoulder")
            self.bone_pairs = get_kinect18_bone_pairs()
            self.angle_triplets = get_kinect18_angle_triplets()
        else:
            self.bone_pairs = get_kinect25_bone_pairs()
            self.angle_triplets = get_kinect25_angle_triplets()

    def __len__(self):
        return len(self.indices)

    def _read_2d_excel_pairwise(self, path: Path) -> np.ndarray:
        """
        Đọc file Excel 2D, trả về (T, 25, 2) với tọa độ GỐC.
        Loại bỏ các hàng toàn 0 ở đầu và cuối file.
        """
        df = pd.read_excel(path)
        cols = [str(c).strip() for c in df.columns]

        # Bỏ cột thời gian nếu có
        start_col = 0
        if len(cols) > 0 and (":" in cols[0] or "H:M" in cols[0] or "time" in cols[0].lower()):
            start_col = 1
        
        # ========== Lọc hàng toàn 0 ở đầu và cuối ==========
        data_cols = df.columns[start_col:]
        
        # Hàm kiểm tra hàng toàn 0 hoặc NaN (đơn giản hóa)
        def is_zero_or_nan_row(row):
            """Kiểm tra xem hàng có phải toàn 0 hoặc NaN không"""
            values = row.values
            non_zero_count = 0
            for val in values:
                # Chuyển sang float an toàn
                try:
                    float_val = _safe_float(val)
                    if not np.isnan(float_val) and float_val != 0.0:
                        non_zero_count += 1
                except:
                    continue
            return non_zero_count == 0
        
        zero_rows = df[data_cols].apply(is_zero_or_nan_row, axis=1)
        
        # Tìm hàng đầu tiên có dữ liệu (không phải toàn 0)
        first_valid_idx = None
        for idx in range(len(df)):
            if not zero_rows.iloc[idx]:
                first_valid_idx = idx
                break
        
        # Tìm hàng cuối cùng có dữ liệu (không phải toàn 0)
        last_valid_idx = None
        for idx in range(len(df) - 1, -1, -1):
            if not zero_rows.iloc[idx]:
                last_valid_idx = idx
                break
        
        # Nếu không tìm thấy hàng hợp lệ nào (file toàn 0)
        if first_valid_idx is None or last_valid_idx is None:
            # Trả về tensor rỗng
            return np.zeros((0, len(KINECT25), 2), dtype=np.float32)
        
        # Kiểm tra tính hợp lệ (không thể xảy ra nhưng safety check)
        if first_valid_idx > last_valid_idx:
            return np.zeros((0, len(KINECT25), 2), dtype=np.float32)
        
        # Chỉ lấy phần từ hàng đầu tiên đến hàng cuối cùng có dữ liệu
        # (bao gồm cả các hàng 0 xen kẽ ở giữa - quan trọng!)
        df = df.iloc[first_valid_idx:last_valid_idx + 1].copy()
        df = df.reset_index(drop=True)
        
        # Kiểm tra còn dữ liệu không (safety check)
        if len(df) == 0:
            return np.zeros((0, len(KINECT25), 2), dtype=np.float32)
        # ========== End lọc hàng toàn 0 ==========

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
        elif self.normalization == 'combined_bbox_zscore':
            return normalize_combined_bbox_zscore(seq)
        elif self.normalization == 'combined_spinebase_zscore':
            return normalize_combined_spinebase_zscore(seq, self.spine_base_idx)
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

        # Loại bỏ các keypoint chỉ định nếu cần (TRƯỚC khi normalize)
        if self.remove_head_neck:
            seq = remove_selected_joints(seq)  # (T, 25, 2) -> (T, 17, 2)

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


import torch
import torch.nn as nn
import numpy as np
from collections import deque


class Graph:
    """
    Lớp tiện ích Graph để tạo ma trận kề (adjacency matrix) A.
    Hỗ trợ 2 layout:
    - 'openpose25': 25 joints (Kinect full skeleton)
    - 'kinect23': 18 joints (loại bỏ index [1, 9, 10, 11, 12, 13, 14])
    - 'kinect17': 17 joints (loại bỏ index [1, 9, 10, 11, 12, 13, 14, 15])

    Ma trận kề A có shape (K, V, V) với K=3 là các phân hoạch không gian:
    1. A_root: self-links (đường chéo)
    2. A_close: các khớp centripetal (hướng về tâm)
    3. A_far: các khớp centrifugal (hướng ra xa tâm)
    """

    def __init__(self, layout='openpose25', strategy='spatial'):
        self.layout = layout
        self.strategy = strategy

        if layout == 'kinect23':
            self.num_node = 18
        elif layout == 'kinect17':
            self.num_node = 17
        else:  # openpose25 or default
            self.num_node = 25

        self.A = self._build_adjacency_matrix()

    def _build_adjacency_matrix(self):
        if self.layout == 'kinect23':
            return self._build_adjacency_matrix_23joints()
        if self.layout == 'kinect17':
            return self._build_adjacency_matrix_17joints()
        else:
            return self._build_adjacency_matrix_25joints()

    def _build_adjacency_matrix_25joints(self):
        """Xây dựng adjacency matrix cho 25 joints (OpenPose/Kinect full)"""
        V = 25
        # 1. Ma trận đơn vị cho self-links
        I = np.eye(V, dtype=np.float32)

        # 2. Xây dựng kết nối vật lý giữa các khớp
        A_chain = np.zeros((V, V), dtype=np.float32)
        joint_chain = [
            (0, 1), (1, 2), (2, 3), (3, 4), (1, 5), (5, 6), (6, 7), (1, 8),
            (8, 9), (9, 10), (10, 11), (11, 22), (11, 24), (22, 23),
            (8, 12), (12, 13), (13, 14), (14, 19), (14, 21), (19, 20),
            (0, 15), (15, 17), (0, 16), (16, 18)
        ]
        for i, j in joint_chain:
            A_chain[i, j] = 1.0
            A_chain[j, i] = 1.0

        # Chuẩn hóa ma trận kề
        deg = A_chain.sum(1)
        deg[deg == 0] = 1.0
        D_inv = np.diag(1.0 / deg)
        A_norm = D_inv @ A_chain

        # 3. Ma trận cho các khớp ở xa
        A_far = A_chain

        # Stack 3 ma trận lại -> (K, V, V)
        A_stack = np.stack([I, A_norm, A_far], axis=0)
        return A_stack.astype(np.float32)

    def _build_adjacency_matrix_23joints(self):
        """
        Xây dựng adjacency matrix cho 18 joints (loại bỏ index [1, 9, 10, 11, 12, 13, 14]).

        Joints mapping sau khi loại bỏ index [1, 9, 10, 11, 12, 13, 14]:
        - Head: 0 (was 0)
        - SpineShoulder: 1 (was 2)
        - ShoulderLeft: 2 (was 3)
        - ShoulderRight: 3 (was 4)
        - ElbowLeft: 4 (was 5)
        - ElbowRight: 5 (was 6)
        - WristLeft: 6 (was 7)
        - WristRight: 7 (was 8)
        - SpineMid: 8 (was 15)
        - SpineBase: 9 (was 16)
        - HipLeft: 10 (was 17)
        - HipRight: 11 (was 18)
        - KneeLeft: 12 (was 19)
        - KneeRight: 13 (was 20)
        - AnkleLeft: 14 (was 21)
        - AnkleRight: 15 (was 22)
        - FootLeft: 16 (was 23)
        - FootRight: 17 (was 24)
        """
        V = 18

        # Định nghĩa self links
        self_link = [(i, i) for i in range(V)]

        # Định nghĩa neighbor links (các kết nối giữa joints)
        neighbor_link = [
            # Spine connections
            (0, 1),  # Head -> SpineShoulder
            (1, 8),  # SpineShoulder -> SpineMid
            (8, 9),  # SpineMid -> SpineBase

            # Left arm
            (1, 2),  # SpineShoulder -> ShoulderLeft
            (2, 4),  # ShoulderLeft -> ElbowLeft
            (4, 6),  # ElbowLeft -> WristLeft

            # Right arm
            (1, 3),  # SpineShoulder -> ShoulderRight
            (3, 5),  # ShoulderRight -> ElbowRight
            (5, 7),  # ElbowRight -> WristRight

            # Left leg
            (9, 10),  # SpineBase -> HipLeft
            (10, 12),  # HipLeft -> KneeLeft
            (12, 14),  # KneeLeft -> AnkleLeft
            (14, 16),  # AnkleLeft -> FootLeft

            # Right leg
            (9, 11),  # SpineBase -> HipRight
            (11, 13),  # HipRight -> KneeRight
            (13, 15),  # KneeRight -> AnkleRight
            (15, 17),  # AnkleRight -> FootRight
        ]

        # Định nghĩa center node (SpineBase)
        center = 9

        # Tạo adjacency matrix với 3 partitions
        A = np.zeros((3, V, V))

        # Partition 0: Self connections
        for i in range(V):
            A[0, i, i] = 1

        # Partition 1: Centripetal (moving toward center)
        # Partition 2: Centrifugal (moving away from center)
        for i, j in neighbor_link:
            # Tính khoảng cách từ mỗi node đến center
            dist_i = self._get_distance_to_center(i, center, neighbor_link)
            dist_j = self._get_distance_to_center(j, center, neighbor_link)

            if dist_i < dist_j:
                # i gần center hơn j -> j moving toward center (centripetal)
                A[1, j, i] = 1
                # i moving away from center (centrifugal)
                A[2, i, j] = 1
            else:
                # j gần center hơn i -> i moving toward center (centripetal)
                A[1, i, j] = 1
                # j moving away from center (centrifugal)
                A[2, j, i] = 1

        # Normalize each partition
        for i in range(3):
            A[i] = self._normalize_adjacency_matrix(A[i])

        return A.astype(np.float32)

    def _build_adjacency_matrix_17joints(self):
        """Adjacency for 17 joints (remove [1,9,10,11,12,13,14,15]).

        Joints mapping after removal:
        - Head: 0 (was 0)
        - SpineShoulder: 1 (was 2)
        - ShoulderLeft: 2 (was 3)
        - ShoulderRight: 3 (was 4)
        - ElbowLeft: 4 (was 5)
        - ElbowRight: 5 (was 6)
        - WristLeft: 6 (was 7)
        - WristRight: 7 (was 8)
        - SpineBase: 8 (was 16)
        - HipLeft: 9 (was 17)
        - HipRight: 10 (was 18)
        - KneeLeft: 11 (was 19)
        - KneeRight: 12 (was 20)
        - AnkleLeft: 13 (was 21)
        - AnkleRight: 14 (was 22)
        - FootLeft: 15 (was 23)
        - FootRight: 16 (was 24)
        """

        V = 17

        neighbor_link = [
            # Spine connections
            (0, 1),  # Head -> SpineShoulder
            (1, 8),  # SpineShoulder -> SpineBase

            # Left arm
            (1, 2),
            (2, 4),
            (4, 6),

            # Right arm
            (1, 3),
            (3, 5),
            (5, 7),

            # Left leg
            (8, 9),
            (9, 11),
            (11, 13),
            (13, 15),

            # Right leg
            (8, 10),
            (10, 12),
            (12, 14),
            (14, 16),
        ]

        center = 8  # SpineBase

        A = np.zeros((3, V, V))
        for i in range(V):
            A[0, i, i] = 1

        for i, j in neighbor_link:
            dist_i = self._get_distance_to_center(i, center, neighbor_link)
            dist_j = self._get_distance_to_center(j, center, neighbor_link)

            if dist_i < dist_j:
                A[1, j, i] = 1
                A[2, i, j] = 1
            else:
                A[1, i, j] = 1
                A[2, j, i] = 1

        for i in range(3):
            A[i] = self._normalize_adjacency_matrix(A[i])

        return A.astype(np.float32)

    def _get_distance_to_center(self, node, center, edges):
        """Tính khoảng cách từ node đến center dựa trên graph structure (BFS)"""
        if node == center:
            return 0

        visited = {node}
        queue = deque([(node, 0)])

        while queue:
            current, dist = queue.popleft()

            # Tìm neighbors của current node
            for i, j in edges:
                neighbor = None
                if i == current:
                    neighbor = j
                elif j == current:
                    neighbor = i

                if neighbor is not None and neighbor not in visited:
                    if neighbor == center:
                        return dist + 1
                    visited.add(neighbor)
                    queue.append((neighbor, dist + 1))

        # Nếu không tìm thấy đường đi, trả về khoảng cách lớn
        return 999

    def _normalize_adjacency_matrix(self, A):
        """Chuẩn hóa adjacency matrix: D^(-1/2) * A * D^(-1/2)"""
        # Compute degree matrix
        D = np.sum(A, axis=1)
        # Tránh warning chia cho 0 khi D có phần tử = 0
        D_safe = D.copy()
        D_safe[D_safe == 0] = 1.0
        D_inv_sqrt = np.power(D_safe, -0.5)
        D_inv_sqrt[D == 0] = 0.0
        D_mat = np.diag(D_inv_sqrt)

        # Normalize
        A_normalized = D_mat @ A @ D_mat

        return A_normalized


class GraphConvolution(nn.Module):
    """ Tích chập đồ thị không gian (Spatial Graph Convolution) """

    def __init__(self, in_channels, out_channels, kernel_size):
        super().__init__()
        self.kernel_size = kernel_size
        self.conv = nn.Conv2d(in_channels, out_channels * kernel_size, kernel_size=1)

    def forward(self, x, A):
        # x: (N, C_in, T, V)
        # A: (K, V, V)
        x = self.conv(x)
        N, C, T, V = x.shape
        x = x.view(N, self.kernel_size, C // self.kernel_size, T, V)
        # einsum cho phép nhân ma trận hiệu quả
        x = torch.einsum('nkctv,kvw->nctw', x, A)
        return x.contiguous()


class STGCN_Block(nn.Module):
    """ Khối ST-GCN chuẩn, bao gồm GCN và TCN """

    def __init__(self, in_channels, out_channels, kernel_size_t, stride=1, dropout=0.0):
        super().__init__()
        # Spatial part
        self.gcn = GraphConvolution(in_channels, out_channels, kernel_size=3)  # K=3

        # Temporal part
        padding_t = (kernel_size_t - 1) // 2
        self.tcn = nn.Sequential(
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_channels, out_channels, kernel_size=(kernel_size_t, 1),
                      stride=(stride, 1), padding=(padding_t, 0)),
            nn.BatchNorm2d(out_channels),
            nn.Dropout(dropout, inplace=True)
        )

        # Residual connection
        if stride != 1 or in_channels != out_channels:
            self.residual = nn.Sequential(
                nn.Conv2d(in_channels, out_channels, kernel_size=1, stride=(stride, 1)),
                nn.BatchNorm2d(out_channels)
            )
        else:
            self.residual = nn.Identity()

        self.relu = nn.ReLU(inplace=True)

    def forward(self, x, A):
        res = self.residual(x)
        x = self.gcn(x, A)
        x = self.tcn(x)
        x = x + res
        return self.relu(x)


class ST_GCN(nn.Module):
    """
    Mô hình Spatial Temporal Graph Convolutional Network (ST-GCN).
    Hỗ trợ cả 25 joints (openpose25), 18 joints (kinect23) và 17 joints (kinect17).
    """

    def __init__(self, in_channels, num_class, A, edge_importance_weighting=True, dropout=0.05):
        super().__init__()
        self.V = A.shape[1]  # Số lượng khớp (vertices)

        # Đăng ký ma trận kề A làm buffer
        self.register_buffer('A', torch.from_numpy(A).float())

        # Data Normalization (BatchNorm1d)
        self.data_bn = nn.BatchNorm1d(in_channels * self.V)

        # Các khối ST-GCN (3 layers)
        self.layers = nn.ModuleDict({
            'layer1': STGCN_Block(in_channels, 64, kernel_size_t=9, stride=1, dropout=dropout),
            'layer2': STGCN_Block(64, 128, kernel_size_t=9, stride=1, dropout=dropout),
            'layer3': STGCN_Block(128, 256, kernel_size_t=9, stride=1, dropout=dropout)
        })

        # Trọng số cho các cạnh (Edge Importance)
        if edge_importance_weighting:
            self.edge_importance = nn.Parameter(torch.ones(self.A.shape))
        else:
            self.edge_importance = 1

        # Tầng Fully Connected cuối cùng
        self.pool = nn.AdaptiveAvgPool2d((1, 1))
        self.fc = nn.Linear(256, num_class)

    def forward(self, x):
        # Input shape: (N, C, T, V)
        N, C, T, V = x.shape

        # 1. Data BN
        # Reshape để BatchNorm1d có thể hoạt động trên từng frame
        x = x.permute(0, 3, 1, 2).reshape(N, V * C, T)  # (N, V*C, T)
        x = self.data_bn(x)
        x = x.reshape(N, V, C, T).permute(0, 2, 3, 1)  # (N, C, T, V)

        # 2. Các lớp ST-GCN (3 layers)
        A_weighted = self.A * self.edge_importance
        x = self.layers['layer1'](x, A_weighted)
        x = self.layers['layer2'](x, A_weighted)
        x = self.layers['layer3'](x, A_weighted)

        # 3. Pooling và FC
        x = self.pool(x)  # (N, 256, 1, 1)
        x = x.view(N, -1)  # (N, 256)
        x = self.fc(x)  # (N, num_class)

        return x
    

import sys
import argparse
import json
import time
from pathlib import Path
from datetime import datetime

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader
# NOTE: SummaryWriter import is intentionally lazy (see Trainer.setup_logging)
# to avoid pulling TensorFlow/TensorBoard dependencies when this module is
# imported for inference utilities.
try:
    from sklearn.metrics import (
        accuracy_score, precision_score, recall_score,
        f1_score, confusion_matrix, classification_report
    )
except ModuleNotFoundError:  # optional for inference-only usage
    accuracy_score = precision_score = recall_score = None
    f1_score = confusion_matrix = classification_report = None

try:
    import matplotlib.pyplot as plt
except ModuleNotFoundError:  # optional for inference-only usage
    plt = None

try:
    import seaborn as sns
except ModuleNotFoundError:  # optional for inference-only usage
    sns = None


# ====================== CONFIGURATION ======================

class Config:
    """Cấu hình training"""

    def __init__(self):
        # Dataset
        self.data_root = "Datas"
        self.sequence_length = 128
        self.train_ratio = 0.7
        self.val_ratio = 0.15
        self.split_seed = 42

        # Normalization method
        self.normalization = 'original'  # 'original', 'spine_base', 'scale', 'rotate', 'bbox', 'zscore', 'combined'
        self.remove_head_neck = False  # Loại bỏ index [1,9,10,11,12,13,14,15] (25 joints -> 17 joints)

        # Dynamic features
        self.include_dynamics = False  # Bật/tắt dynamic features
        self.fps = 30.0  # Frame rate của video
        self.dynamic_features = ['velocity', 'acceleration', 'motion_energy']  # Danh sách features
        self.dynamic_fusion = 'concat'  # 'concat', 'separate', 'none'
        # concat: Nối dynamic features với keypoints
        # separate: Xử lý riêng và kết hợp sau
        # none: Chỉ dùng keypoints

        # Model
        self.in_channels = 2  # (x, y) - sẽ được cập nhật nếu dùng dynamics
        self.num_class = 2  # ASD vs Typical
        self.edge_importance = True
        self.dropout = 0.2

        # Training
        self.batch_size = 48
        self.epochs = 80
        self.lr = 0.0001
        self.weight_decay = 0.0001
        self.optimizer = 'adamw'  # adam, sgd, adamw
        self.lr_scheduler = 'plateau'  # step, cosine, plateau
        self.lr_step_size = 20
        self.lr_gamma = 0.5

        # Early stopping
        self.early_stopping = False
        self.patience = 15

        # Device
        self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
        self.num_workers = 2

        # Logging
        self.log_freq = 10  # Log mỗi N batches
        self.use_tensorboard = True

        # Reproducibility
        self.seed = 42

        # Checkpointing
        self.save_dir = 'experiments_STGCN_Normalizations'
        self.exp_name = self._generate_exp_name()
        self.save_freq = 5  # Lưu mỗi N epochs
        self.save_best = True

    def _generate_exp_name(self):
        """Tạo tên experiment tự động"""
        joints_suffix = '_no_head_neck' if self.remove_head_neck else ''
        dynamics_suffix = ''
        if self.include_dynamics:
            features_str = '_'.join(self.dynamic_features[:2])  # Lấy 2 features đầu
            dynamics_suffix = f'_dyn_{features_str}'
        return f'stgcn_{self.normalization}{joints_suffix}{dynamics_suffix}_seed{self.seed}_{datetime.now().strftime("%Y%m%d_%H%M%S")}'

    def update_exp_name(self):
        """Cập nhật tên experiment sau khi thay đổi config"""
        self.exp_name = self._generate_exp_name()

    def get_effective_in_channels(self):
        """Tính số channels đầu vào thực tế dựa trên dynamic features"""
        base_channels = 2  # x, y

        if not self.include_dynamics or self.dynamic_fusion == 'none':
            return base_channels

        if self.dynamic_fusion == 'concat':
            # Velocity: 2 channels (vx, vy)
            # Acceleration: 2 channels (ax, ay)
            # Motion energy: 1 channel (magnitude)
            dynamic_channels = 0
            if 'velocity' in self.dynamic_features:
                dynamic_channels += 2
            if 'acceleration' in self.dynamic_features:
                dynamic_channels += 2
            if 'motion_energy' in self.dynamic_features:
                dynamic_channels += 1

            return base_channels + dynamic_channels

        return base_channels

    def to_dict(self):
        """Chuyển config thành dictionary"""
        return {k: v for k, v in self.__dict__.items() if not k.startswith('_')}


# ====================== DYNAMIC FEATURES PROCESSOR ======================

class DynamicFeaturesProcessor:
    """Xử lý và kết hợp dynamic features với keypoints"""

    def __init__(self, config: Config):
        self.config = config
        self.fusion_mode = config.dynamic_fusion
        self.dynamic_features = config.dynamic_features

    def process_batch(self, batch: dict) -> torch.Tensor:
        """
        Xử lý batch và trả về tensor đầu vào cho model

        Parameters
        ----------
        batch : dict
            Batch từ dataloader

        Returns
        -------
        torch.Tensor
            Tensor đầu vào với shape phù hợp cho ST-GCN
        """
        keypoints = batch['keypoints']  # (N, T, V, 2)

        if not self.config.include_dynamics or self.fusion_mode == 'none':
            # Chỉ dùng keypoints: (N, T, V, 2) -> (N, 2, T, V)
            return keypoints.permute(0, 3, 1, 2)

        if self.fusion_mode == 'concat':
            # Nối các dynamic features vào channels
            features_to_concat = [keypoints]  # (N, T, V, 2)

            if 'velocity' in self.dynamic_features and 'dynamic_velocity' in batch:
                features_to_concat.append(batch['dynamic_velocity'])  # (N, T, V, 2)

            if 'acceleration' in self.dynamic_features and 'dynamic_acceleration' in batch:
                features_to_concat.append(batch['dynamic_acceleration'])  # (N, T, V, 2)

            if 'motion_energy' in self.dynamic_features and 'dynamic_motion_energy' in batch:
                motion_energy = batch['dynamic_motion_energy'].unsqueeze(-1)  # (N, T, V, 1)
                features_to_concat.append(motion_energy)

            # Concatenate theo chiều channels
            combined = torch.cat(features_to_concat, dim=-1)  # (N, T, V, C)

            # Permute cho ST-GCN: (N, T, V, C) -> (N, C, T, V)
            return combined.permute(0, 3, 1, 2)

        # Fusion mode 'separate' sẽ được xử lý trong model architecture
        return keypoints.permute(0, 3, 1, 2)


# ====================== METRICS ======================

class MetricsTracker:
    """Theo dõi và tính toán metrics"""

    def __init__(self):
        self.reset()

    def reset(self):
        self.y_true = []
        self.y_pred = []
        self.losses = []

    def update(self, y_true, y_pred, loss=None):
        self.y_true.extend(y_true.cpu().numpy())
        self.y_pred.extend(y_pred.cpu().numpy())
        if loss is not None:
            self.losses.append(loss)

    def compute(self):
        y_true = np.array(self.y_true)
        y_pred = np.array(self.y_pred)

        if accuracy_score is None:
            raise RuntimeError(
                "scikit-learn is required for training metrics. Install: pip install scikit-learn"
            )

        return {
            'accuracy': accuracy_score(y_true, y_pred),
            'precision': precision_score(y_true, y_pred, average='binary', zero_division=0),
            'recall': recall_score(y_true, y_pred, average='binary', zero_division=0),
            'f1': f1_score(y_true, y_pred, average='binary', zero_division=0),
            'loss': np.mean(self.losses) if self.losses else 0.0,
            'confusion_matrix': confusion_matrix(y_true, y_pred)
        }


# ====================== TRAINER ======================

class Trainer:
    """Lớp quản lý quá trình training"""

    def __init__(self, config: Config):
        self.config = config
        self.setup_directories()
        self.setup_logging()
        self.setup_seed()

        # Khởi tạo các thành phần
        self.device = torch.device(config.device)
        self.model = None
        self.optimizer = None
        self.scheduler = None
        self.criterion = nn.CrossEntropyLoss()

        # Dynamic features processor
        self.dynamics_processor = DynamicFeaturesProcessor(config)

        # Training state
        self.current_epoch = 0
        self.best_val_acc = 0.0
        self.best_val_f1 = 0.0
        self.epochs_no_improve = 0
        self.history = {
            'train_loss': [], 'train_acc': [], 'train_f1': [],
            'val_loss': [], 'val_acc': [], 'val_f1': []
        }

        # Số joints (sẽ được cập nhật sau khi load data)
        self.num_joints = 17 if config.remove_head_neck else 25

    def setup_directories(self):
        """Tạo thư mục lưu trữ"""
        self.exp_dir = Path(self.config.save_dir) / self.config.exp_name
        self.exp_dir.mkdir(parents=True, exist_ok=True)
        self.ckpt_dir = self.exp_dir / 'checkpoints'
        self.ckpt_dir.mkdir(exist_ok=True)
        self.log_dir = self.exp_dir / 'logs'
        self.log_dir.mkdir(exist_ok=True)
        self.vis_dir = self.exp_dir / 'visualizations'
        self.vis_dir.mkdir(exist_ok=True)

    def setup_logging(self):
        """Khởi tạo logging"""
        if self.config.use_tensorboard:
            from torch.utils.tensorboard import SummaryWriter

            self.writer = SummaryWriter(log_dir=str(self.log_dir))
        else:
            self.writer = None

        # Lưu config
        with open(self.exp_dir / 'config.json', 'w') as f:
            json.dump(self.config.to_dict(), f, indent=2)

    def setup_seed(self):
        """Thiết lập seed cho reproducibility"""
        torch.manual_seed(self.config.seed)
        np.random.seed(self.config.seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(self.config.seed)
            torch.backends.cudnn.deterministic = True
            torch.backends.cudnn.benchmark = False

    def build_model(self):
        """Xây dựng model"""
        print(f"\n{'=' * 60}")
        print("BUILDING MODEL")
        print(f"{'=' * 60}")

        # Sử dụng Graph từ st_gcn_full.py
        if self.num_joints == 17:
            print("✓ Creating graph for 17-joint reduced skeleton")
            graph = Graph(layout='kinect17')
        elif self.num_joints == 18:
            print("✓ Creating graph for 18-joint reduced skeleton")
            graph = Graph(layout='kinect23')
        else:
            print("✓ Using standard graph for 25 joints")
            graph = Graph(layout='openpose25')

        # Tính số channels đầu vào
        in_channels = self.config.get_effective_in_channels()
        print(f"✓ Input channels: {in_channels}")
        if self.config.include_dynamics:
            print(f"  - Base keypoints: 2 channels (x, y)")
            if 'velocity' in self.config.dynamic_features:
                print(f"  - Velocity: 2 channels (vx, vy)")
            if 'acceleration' in self.config.dynamic_features:
                print(f"  - Acceleration: 2 channels (ax, ay)")
            if 'motion_energy' in self.config.dynamic_features:
                print(f"  - Motion energy: 1 channel (magnitude)")

        self.model = ST_GCN(
            in_channels=in_channels,
            num_class=self.config.num_class,
            A=graph.A,
            edge_importance_weighting=self.config.edge_importance,
            dropout=self.config.dropout
        ).to(self.device)

        # Đếm parameters
        total_params = sum(p.numel() for p in self.model.parameters())
        trainable_params = sum(p.numel() for p in self.model.parameters() if p.requires_grad)

        print(f"Number of joints: {self.num_joints}")
        print(f"Total parameters: {total_params:,}")
        print(f"Trainable parameters: {trainable_params:,}")
        print(f"Model device: {next(self.model.parameters()).device}")

    def build_optimizer(self):
        """Xây dựng optimizer và scheduler"""
        if self.config.optimizer == 'adam':
            self.optimizer = optim.Adam(
                self.model.parameters(),
                lr=self.config.lr,
                weight_decay=self.config.weight_decay
            )
        elif self.config.optimizer == 'sgd':
            self.optimizer = optim.SGD(
                self.model.parameters(),
                lr=self.config.lr,
                momentum=0.9,
                weight_decay=self.config.weight_decay
            )
        elif self.config.optimizer == 'adamw':
            self.optimizer = optim.AdamW(
                self.model.parameters(),
                lr=self.config.lr,
                weight_decay=self.config.weight_decay
            )

        # Scheduler
        if self.config.lr_scheduler == 'step':
            self.scheduler = optim.lr_scheduler.StepLR(
                self.optimizer,
                step_size=self.config.lr_step_size,
                gamma=self.config.lr_gamma
            )
        elif self.config.lr_scheduler == 'cosine':
            self.scheduler = optim.lr_scheduler.CosineAnnealingLR(
                self.optimizer,
                T_max=self.config.epochs
            )
        elif self.config.lr_scheduler == 'plateau':
            self.scheduler = optim.lr_scheduler.ReduceLROnPlateau(
                self.optimizer,
                mode='max',
                factor=0.5,
                patience=10
            )

    def prepare_data(self):
        """Chuẩn bị dữ liệu"""
        print(f"\n{'=' * 60}")
        print("PREPARING DATA")
        print(f"{'=' * 60}")
        print(f"Normalization method: {self.config.normalization}")
        print(f"Remove Head & Neck: {self.config.remove_head_neck}")
        print(f"Include dynamics: {self.config.include_dynamics}")
        if self.config.include_dynamics:
            print(f"Dynamic features: {self.config.dynamic_features}")
            print(f"Dynamic fusion: {self.config.dynamic_fusion}")
            print(f"FPS: {self.config.fps}")

        # Build index
        entries = build_index(Path(self.config.data_root))
        print(f"Found {len(entries)} samples")

        # Split data
        splits = subject_wise_split(
            entries,
            train_ratio=self.config.train_ratio,
            val_ratio=self.config.val_ratio,
            seed=self.config.split_seed
        )

        print(f"Train: {len(splits.train)} samples")
        print(f"Val: {len(splits.val)} samples")
        print(f"Test: {len(splits.test)} samples")

        # Create datasets với dynamic features
        self.train_dataset = Kinect2DNormalizedDataset(
            entries,
            splits.train,
            L=self.config.sequence_length,
            normalization=self.config.normalization,
            remove_head_neck=self.config.remove_head_neck,
            include_dynamics=self.config.include_dynamics,
            fps=self.config.fps,
            dynamic_features=self.config.dynamic_features if self.config.include_dynamics else None
        )
        self.val_dataset = Kinect2DNormalizedDataset(
            entries,
            splits.val,
            L=self.config.sequence_length,
            normalization=self.config.normalization,
            remove_head_neck=self.config.remove_head_neck,
            include_dynamics=self.config.include_dynamics,
            fps=self.config.fps,
            dynamic_features=self.config.dynamic_features if self.config.include_dynamics else None
        )
        self.test_dataset = Kinect2DNormalizedDataset(
            entries,
            splits.test,
            L=self.config.sequence_length,
            normalization=self.config.normalization,
            remove_head_neck=self.config.remove_head_neck,
            include_dynamics=self.config.include_dynamics,
            fps=self.config.fps,
            dynamic_features=self.config.dynamic_features if self.config.include_dynamics else None
        )

        # Lấy số joints từ dataset
        sample = self.train_dataset[0]
        self.num_joints = sample['num_joints']
        print(f"Number of joints in data: {self.num_joints}")

        # Kiểm tra dynamic features
        if self.config.include_dynamics:
            print("\nDynamic features in sample:")
            for key in sample.keys():
                if key.startswith('dynamic_'):
                    print(f"  - {key}: {sample[key].shape}")

        # Create dataloaders
        self.train_loader = DataLoader(
            self.train_dataset,
            batch_size=self.config.batch_size,
            shuffle=True,
            num_workers=self.config.num_workers,
            collate_fn=collate_fixedlen,
            pin_memory=True
        )

        self.val_loader = DataLoader(
            self.val_dataset,
            batch_size=self.config.batch_size,
            shuffle=False,
            num_workers=self.config.num_workers,
            collate_fn=collate_fixedlen,
            pin_memory=True
        )

        self.test_loader = DataLoader(
            self.test_dataset,
            batch_size=self.config.batch_size,
            shuffle=False,
            num_workers=self.config.num_workers,
            collate_fn=collate_fixedlen,
            pin_memory=True
        )

    def train_epoch(self):
        """Train một epoch"""
        self.model.train()
        metrics = MetricsTracker()

        for batch_idx, batch in enumerate(self.train_loader):
            # Xử lý data với dynamics processor
            x = self.dynamics_processor.process_batch(batch).to(self.device)
            y = batch['label'].to(self.device)

            # Forward
            self.optimizer.zero_grad()
            outputs = self.model(x)
            loss = self.criterion(outputs, y)

            # Backward
            loss.backward()
            self.optimizer.step()

            # Metrics
            _, predicted = torch.max(outputs, 1)
            metrics.update(y, predicted, loss.item())

            # Logging
            if (batch_idx + 1) % self.config.log_freq == 0:
                print(f"  Batch [{batch_idx + 1}/{len(self.train_loader)}] "
                      f"Loss: {loss.item():.4f}")

        return metrics.compute()

    @torch.no_grad()
    def validate(self, loader):
        """Validate trên một dataloader"""
        self.model.eval()
        metrics = MetricsTracker()

        for batch in loader:
            x = self.dynamics_processor.process_batch(batch).to(self.device)
            y = batch['label'].to(self.device)

            # Forward
            outputs = self.model(x)
            loss = self.criterion(outputs, y)

            # Metrics
            _, predicted = torch.max(outputs, 1)
            metrics.update(y, predicted, loss.item())

        return metrics.compute()

    def save_checkpoint(self, is_best=False, filename=None):
        """Lưu checkpoint"""
        if filename is None:
            filename = f'checkpoint_epoch_{self.current_epoch}.pth'

        checkpoint = {
            'epoch': self.current_epoch,
            'model_state_dict': self.model.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict(),
            'scheduler_state_dict': self.scheduler.state_dict() if self.scheduler else None,
            'best_val_acc': self.best_val_acc,
            'best_val_f1': self.best_val_f1,
            'history': self.history,
            'config': self.config.to_dict(),
            'num_joints': self.num_joints
        }

        save_path = self.ckpt_dir / filename
        torch.save(checkpoint, save_path)

        if is_best:
            best_path = self.ckpt_dir / 'best_model.pth'
            torch.save(checkpoint, best_path)
            print(f"  💾 Saved best model (Val Acc: {self.best_val_acc:.4f}, Val F1: {self.best_val_f1:.4f})")

    def load_checkpoint(self, checkpoint_path):
        """Load checkpoint"""
        checkpoint = torch.load(checkpoint_path, map_location=self.device, weights_only=False)
        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
        if checkpoint['scheduler_state_dict'] and self.scheduler:
            self.scheduler.load_state_dict(checkpoint['scheduler_state_dict'])
        self.current_epoch = checkpoint['epoch']
        self.best_val_acc = checkpoint['best_val_acc']
        self.best_val_f1 = checkpoint['best_val_f1']
        self.history = checkpoint['history']
        if 'num_joints' in checkpoint:
            self.num_joints = checkpoint['num_joints']
        print(f"Loaded checkpoint from epoch {self.current_epoch}")
        print(f"Number of joints: {self.num_joints}")

    def plot_training_curves(self):
        """Vẽ đồ thị training curves"""
        if plt is None:
            raise RuntimeError("matplotlib is required for plotting. Install: pip install matplotlib")
        fig, axes = plt.subplots(2, 2, figsize=(15, 10))

        # Loss
        axes[0, 0].plot(self.history['train_loss'], label='Train')
        axes[0, 0].plot(self.history['val_loss'], label='Val')
        axes[0, 0].set_xlabel('Epoch')
        axes[0, 0].set_ylabel('Loss')
        axes[0, 0].set_title('Training and Validation Loss')
        axes[0, 0].set_ylim(0, 1.0)
        axes[0, 0].set_yticks(np.arange(0, 1.2, 0.2))
        axes[0, 0].legend()
        axes[0, 0].grid(True)

        # Accuracy
        axes[0, 1].plot(self.history['train_acc'], label='Train')
        axes[0, 1].plot(self.history['val_acc'], label='Val')
        axes[0, 1].set_xlabel('Epoch')
        axes[0, 1].set_ylabel('Accuracy')
        axes[0, 1].set_title('Training and Validation Accuracy')
        axes[0, 1].set_ylim(0, 1.0)
        axes[0, 1].set_yticks(np.arange(0, 1.2, 0.2))
        axes[0, 1].legend()
        axes[0, 1].grid(True)

        # F1 Score
        axes[1, 0].plot(self.history['train_f1'], label='Train')
        axes[1, 0].plot(self.history['val_f1'], label='Val')
        axes[1, 0].set_xlabel('Epoch')
        axes[1, 0].set_ylabel('F1 Score')
        axes[1, 0].set_title('Training and Validation F1 Score')
        axes[1, 0].set_ylim(0, 1.0)
        axes[1, 0].set_yticks(np.arange(0, 1.2, 0.2))
        axes[1, 0].legend()
        axes[1, 0].grid(True)

        # Summary
        axes[1, 1].axis('off')
        joints_info = f"{self.num_joints} joints" + (" (removed idx: 1,9,10,11,12,13,14,15)" if self.config.remove_head_neck else "")
        dynamics_info = ""
        if self.config.include_dynamics:
            dynamics_info = f"\nDynamic Features: {', '.join(self.config.dynamic_features)}"

        summary_text = f"""
        Best Validation Results:
        ────────────────────────
        Accuracy: {self.best_val_acc:.4f}
        F1 Score: {self.best_val_f1:.4f}
        Epoch: {np.argmax(self.history['val_acc']) + 1}

        Final Results:
        ────────────────────────
        Train Acc: {self.history['train_acc'][-1]:.4f}
        Val Acc: {self.history['val_acc'][-1]:.4f}
        Train F1: {self.history['train_f1'][-1]:.4f}
        Val F1: {self.history['val_f1'][-1]:.4f}

        Configuration:
        ────────────────────────
        Normalization: {self.config.normalization}
        Joints: {joints_info}{dynamics_info}
        Input Channels: {self.config.get_effective_in_channels()}
        """
        axes[1, 1].text(0.1, 0.5, summary_text, fontsize=11, family='monospace')

        plt.tight_layout()
        plt.savefig(self.vis_dir / 'training_curves.png', dpi=300, bbox_inches='tight')
        plt.close()

    def plot_confusion_matrix(self, cm, title='Confusion Matrix'):
        """Vẽ confusion matrix"""
        if plt is None or sns is None:
            raise RuntimeError("matplotlib and seaborn are required for plotting. Install: pip install matplotlib seaborn")
        plt.figure(figsize=(8, 6))
        sns.heatmap(cm, annot=True, fmt='d', cmap='Blues',
                    xticklabels=['Typical', 'ASD'],
                    yticklabels=['Typical', 'ASD'])
        plt.title(title)
        plt.ylabel('True Label')
        plt.xlabel('Predicted Label')
        plt.tight_layout()

        filename = title.lower().replace(' ', '_') + '.png'
        plt.savefig(self.vis_dir / filename, dpi=300, bbox_inches='tight')
        plt.close()

    def train(self):
        """Main training loop"""
        print(f"\n{'=' * 60}")
        print("STARTING TRAINING")
        print(f"{'=' * 60}")
        print(f"Experiment: {self.config.exp_name}")
        print(f"Normalization: {self.config.normalization}")
        print(f"Remove Selected Joints: {self.config.remove_head_neck}")
        print(f"Number of joints: {self.num_joints}")
        print(f"Include dynamics: {self.config.include_dynamics}")
        if self.config.include_dynamics:
            print(f"Dynamic features: {self.config.dynamic_features}")
            print(f"Dynamic fusion: {self.config.dynamic_fusion}")
        print(f"Input channels: {self.config.get_effective_in_channels()}")
        print(f"Device: {self.device}")
        print(f"Epochs: {self.config.epochs}")
        print(f"Batch size: {self.config.batch_size}")
        print(f"Learning rate: {self.config.lr}")

        start_time = time.time()

        for epoch in range(1, self.config.epochs + 1):
            self.current_epoch = epoch
            epoch_start = time.time()

            print(f"\n{'─' * 60}")
            print(f"Epoch [{epoch}/{self.config.epochs}]")
            print(f"{'─' * 60}")

            # Train
            train_metrics = self.train_epoch()

            # Validate
            val_metrics = self.validate(self.val_loader)

            # Update history
            self.history['train_loss'].append(train_metrics['loss'])
            self.history['train_acc'].append(train_metrics['accuracy'])
            self.history['train_f1'].append(train_metrics['f1'])
            self.history['val_loss'].append(val_metrics['loss'])
            self.history['val_acc'].append(val_metrics['accuracy'])
            self.history['val_f1'].append(val_metrics['f1'])

            # Print metrics
            print(f"\nTrain - Loss: {train_metrics['loss']:.4f}, "
                  f"Acc: {train_metrics['accuracy']:.4f}, "
                  f"F1: {train_metrics['f1']:.4f}")
            print(f"Val   - Loss: {val_metrics['loss']:.4f}, "
                  f"Acc: {val_metrics['accuracy']:.4f}, "
                  f"F1: {val_metrics['f1']:.4f}")

            # TensorBoard logging
            if self.writer:
                self.writer.add_scalars('Loss', {
                    'train': train_metrics['loss'],
                    'val': val_metrics['loss']
                }, epoch)
                self.writer.add_scalars('Accuracy', {
                    'train': train_metrics['accuracy'],
                    'val': val_metrics['accuracy']
                }, epoch)
                self.writer.add_scalars('F1', {
                    'train': train_metrics['f1'],
                    'val': val_metrics['f1']
                }, epoch)
                self.writer.add_scalar('LR', self.optimizer.param_groups[0]['lr'], epoch)

            # Scheduler step
            if self.scheduler:
                if isinstance(self.scheduler, optim.lr_scheduler.ReduceLROnPlateau):
                    self.scheduler.step(val_metrics['accuracy'])
                else:
                    self.scheduler.step()

            # Check for improvement
            is_best = False
            if val_metrics['accuracy'] > self.best_val_acc:
                self.best_val_acc = val_metrics['accuracy']
                self.best_val_f1 = val_metrics['f1']
                is_best = True
                self.epochs_no_improve = 0
            else:
                self.epochs_no_improve += 1

            # Save checkpoint
            if epoch % self.config.save_freq == 0 or is_best:
                self.save_checkpoint(is_best=is_best)

            # Early stopping
            if self.config.early_stopping and self.epochs_no_improve >= self.config.patience:
                print(f"\n⚠️ Early stopping triggered after {epoch} epochs")
                print(f"No improvement for {self.config.patience} consecutive epochs")
                break

            epoch_time = time.time() - epoch_start
            print(f"Epoch time: {epoch_time:.2f}s")

        # Training complete
        total_time = time.time() - start_time
        print(f"\n{'=' * 60}")
        print("TRAINING COMPLETE")
        print(f"{'=' * 60}")
        print(f"Total time: {total_time / 60:.2f} minutes")
        print(f"Best Val Acc: {self.best_val_acc:.4f}")
        print(f"Best Val F1: {self.best_val_f1:.4f}")

        # Plot training curves
        self.plot_training_curves()

        # Evaluate on test set
        self.evaluate_test()

        if self.writer:
            self.writer.close()

    def evaluate_test(self):
        """Đánh giá trên test set"""
        print(f"\n{'=' * 60}")
        print("EVALUATING ON TEST SET")
        print(f"{'=' * 60}")

        # Load best model
        best_model_path = self.ckpt_dir / 'best_model.pth'
        if best_model_path.exists():
            checkpoint = torch.load(best_model_path, map_location=self.device, weights_only=False)
            self.model.load_state_dict(checkpoint['model_state_dict'])
            print("Loaded best model for testing")

        test_metrics = self.validate(self.test_loader)

        print(f"\nTest Results:")
        print(f"  Loss: {test_metrics['loss']:.4f}")
        print(f"  Accuracy: {test_metrics['accuracy']:.4f}")
        print(f"  Precision: {test_metrics['precision']:.4f}")
        print(f"  Recall: {test_metrics['recall']:.4f}")
        print(f"  F1 Score: {test_metrics['f1']:.4f}")

        print(f"\nConfusion Matrix:")
        print(test_metrics['confusion_matrix'])

        # Plot confusion matrix
        self.plot_confusion_matrix(test_metrics['confusion_matrix'], 'Test Confusion Matrix')

        # Save test results
        test_results = {
            'normalization': self.config.normalization,
            'remove_head_neck': self.config.remove_head_neck,
            'num_joints': self.num_joints,
            'include_dynamics': self.config.include_dynamics,
            'dynamic_features': self.config.dynamic_features if self.config.include_dynamics else None,
            'dynamic_fusion': self.config.dynamic_fusion if self.config.include_dynamics else None,
            'input_channels': self.config.get_effective_in_channels(),
            'loss': float(test_metrics['loss']),
            'accuracy': float(test_metrics['accuracy']),
            'precision': float(test_metrics['precision']),
            'recall': float(test_metrics['recall']),
            'f1': float(test_metrics['f1']),
            'confusion_matrix': test_metrics['confusion_matrix'].tolist()
        }

        with open(self.exp_dir / 'test_results.json', 'w') as f:
            json.dump(test_results, f, indent=2)


# ====================== MAIN ======================

def parse_args():
    """Parse command line arguments"""
    parser = argparse.ArgumentParser(description='Train ST-GCN for ASD classification with dynamic features')

    # Data
    parser.add_argument('--data-root', type=str, default='Datas',
                        help='Root directory of dataset')
    parser.add_argument('--seq-len', type=int, default=128,
                        help='Sequence length after resampling')
    parser.add_argument('--normalization', type=str, default='original',
                        choices=['original', 'spine_base', 'scale', 'rotate', 'bbox', 'zscore', 'combined', 'combined_bbox_zscore', 'combined_spinebase_zscore'],
                        help='Normalization method')
    parser.add_argument('--remove-head-neck', action='store_true',
                        help='Remove keypoint indices [1,9,10,11,12,13,14,15] (25 -> 17 joints)')

    # Dynamic features
    parser.add_argument('--include-dynamics', action='store_true',
                        help='Include dynamic features (velocity, acceleration, etc.)')
    parser.add_argument('--fps', type=float, default=30.0,
                        help='Frame rate of videos (for computing dynamics)')
    parser.add_argument('--dynamic-features', nargs='+',
                        default=['velocity', 'acceleration', 'motion_energy'],
                        choices=['velocity', 'acceleration', 'bone_lengths', 'joint_angles', 'motion_energy'],
                        help='List of dynamic features to include')
    parser.add_argument('--dynamic-fusion', type=str, default='concat',
                        choices=['concat', 'separate', 'none'],
                        help='How to fuse dynamic features with keypoints')

    # Model
    parser.add_argument('--dropout', type=float, default=0.3,
                        help='Dropout rate')

    # Training
    parser.add_argument('--batch-size', type=int, default=48,
                        help='Batch size')
    parser.add_argument('--epochs', type=int, default=80,
                        help='Number of epochs')
    parser.add_argument('--lr', type=float, default=0.00005,
                        help='Learning rate')
    parser.add_argument('--optimizer', type=str, default='adamw',
                        choices=['adam', 'sgd', 'adamw'],
                        help='Optimizer')
    parser.add_argument('--scheduler', type=str, default='plateau',
                        choices=['step', 'cosine', 'plateau'],
                        help='LR scheduler')

    # Checkpointing
    parser.add_argument('--save-dir', type=str, default='Training_logs/experiments_STGCN_Normalizations',
                        help='Directory to save experiments')
    parser.add_argument('--exp-name', type=str, default=None,
                        help='Experiment name')
    parser.add_argument('--resume', type=str, default=None,
                        help='Path to checkpoint to resume from')

    # Other
    parser.add_argument('--seed', type=int, default=42,
                        help='Random seed')
    parser.add_argument('--device', type=str, default='cuda',
                        help='Device to use (cuda/cpu)')
    parser.add_argument('--num-workers', type=int, default=2,
                        help='Number of data loading workers')

    return parser.parse_args()


def main():
    """Main function"""
    args = parse_args()

    # Create config
    config = Config()

    # Override with command line arguments
    if args.data_root:
        config.data_root = args.data_root
    if args.seq_len:
        config.sequence_length = args.seq_len
    if args.normalization:
        config.normalization = args.normalization

    # Cập nhật remove_head_neck
    config.remove_head_neck = args.remove_head_neck

    # Cập nhật dynamic features
    config.include_dynamics = args.include_dynamics
    if args.include_dynamics:
        config.fps = args.fps
        config.dynamic_features = args.dynamic_features
        config.dynamic_fusion = args.dynamic_fusion

    if args.dropout:
        config.dropout = args.dropout
    if args.batch_size:
        config.batch_size = args.batch_size
    if args.epochs:
        config.epochs = args.epochs
    if args.lr:
        config.lr = args.lr
    if args.optimizer:
        config.optimizer = args.optimizer
    if args.scheduler:
        config.lr_scheduler = args.scheduler
    if args.save_dir:
        config.save_dir = args.save_dir
    if args.exp_name:
        config.exp_name = args.exp_name
    else:
        # Update exp_name with all configurations
        config.update_exp_name()
    if args.seed:
        config.seed = args.seed
    if args.device:
        config.device = args.device
    if args.num_workers:
        config.num_workers = args.num_workers

    # In thông tin config
    print(f"\n{'=' * 60}")
    print("CONFIGURATION")
    print(f"{'=' * 60}")
    print(f"Normalization: {config.normalization}")
    print(f"Remove Selected Joints: {config.remove_head_neck}")
    print(f"Expected joints: {17 if config.remove_head_neck else 25}")
    print(f"Sequence length: {config.sequence_length}")
    print(f"\nDynamic Features:")
    print(f"  Include dynamics: {config.include_dynamics}")
    if config.include_dynamics:
        print(f"  FPS: {config.fps}")
        print(f"  Features: {config.dynamic_features}")
        print(f"  Fusion mode: {config.dynamic_fusion}")
        print(f"  Input channels: {config.get_effective_in_channels()}")
    else:
        print(f"  Input channels: 2 (x, y only)")
    print(f"\nTraining:")
    print(f"  Batch size: {config.batch_size}")
    print(f"  Learning rate: {config.lr}")
    print(f"  Optimizer: {config.optimizer}")
    print(f"  Scheduler: {config.lr_scheduler}")
    print(f"  Device: {config.device}")
    print(f"  Seed: {config.seed}")

    # Create trainer
    trainer = Trainer(config)

    # Prepare data
    trainer.prepare_data()

    # Build model
    trainer.build_model()

    # Build optimizer
    trainer.build_optimizer()

    # Resume from checkpoint if specified
    if args.resume:
        trainer.load_checkpoint(args.resume)

    # Train
    trainer.train()

# %% (cell 3)
def run_sweep(seeds=None):
    if seeds is None:
        seeds = [41, 42, 43, 44, 45]

    # Original
    for seed in seeds:
        print(f"\n{'='*20}")
        print(f"BẮT ĐẦU TRAINING VỚI SEED: {seed}")
        print(f"{'='*20}\n")

        sys.argv = [
            'train_stgcn.py',
            '--normalization', 'original',
            '--remove-head-neck',
            '--seed', str(seed),
            # '--include-dynamics',
            # '--dynamic-features', 'acceleration'
        ]

        try:
            main()
        except Exception as e:
            print(f"Lỗi xảy ra tại seed {seed}: {e}")
            continue

    print("\nHOÀN THÀNH Original!!!")

    # Spine-base
    for seed in seeds:
        print(f"\n{'='*20}")
        print(f"BẮT ĐẦU TRAINING VỚI SEED: {seed}")
        print(f"{'='*20}\n")

        sys.argv = [
            'train_stgcn.py',
            '--normalization', 'spine_base',
            '--remove-head-neck',
            '--seed', str(seed),
            # '--include-dynamics',
            # '--dynamic-features', 'acceleration'
        ]

        try:
            main()
        except Exception as e:
            print(f"Lỗi xảy ra tại seed {seed}: {e}")
            continue

    print("\nHOÀN THÀNH Spine-base!!!")

    # BBox
    for seed in seeds:
        print(f"\n{'='*20}")
        print(f"BẮT ĐẦU TRAINING VỚI SEED: {seed}")
        print(f"{'='*20}\n")

        sys.argv = [
            'train_stgcn.py',
            '--normalization', 'bbox',
            '--remove-head-neck',
            '--seed', str(seed),
            # '--include-dynamics',
            # '--dynamic-features', 'acceleration'
        ]

        try:
            main()
        except Exception as e:
            print(f"Lỗi xảy ra tại seed {seed}: {e}")
            continue

    print("\nHOÀN THÀNH BBox!!!")

    # ZScore
    for seed in seeds:
        print(f"\n{'='*20}")
        print(f"BẮT ĐẦU TRAINING VỚI SEED: {seed}")
        print(f"{'='*20}\n")

        sys.argv = [
            'train_stgcn.py',
            '--normalization', 'zscore',
            '--remove-head-neck',
            '--seed', str(seed),
            # '--include-dynamics',
            # '--dynamic-features', 'acceleration'
        ]

        try:
            main()
        except Exception as e:
            print(f"Lỗi xảy ra tại seed {seed}: {e}")
            continue

    print("\nHOÀN THÀNH ZScore!!!")

    # Acceleration
    for seed in seeds:
        print(f"\n{'='*20}")
        print(f"BẮT ĐẦU TRAINING VỚI SEED: {seed}")
        print(f"{'='*20}\n")

        sys.argv = [
            'train_stgcn.py',
            '--normalization', 'original',
            '--remove-head-neck',
            '--seed', str(seed),
            '--include-dynamics',
            '--dynamic-features', 'acceleration'
        ]

        try:
            main()
        except Exception as e:
            print(f"Lỗi xảy ra tại seed {seed}: {e}")
            continue

    print("\nHOÀN THÀNH Acceleration!!!")

    # Velocity
    for seed in seeds:
        print(f"\n{'='*20}")
        print(f"BẮT ĐẦU TRAINING VỚI SEED: {seed}")
        print(f"{'='*20}\n")

        sys.argv = [
            'train_stgcn.py',
            '--normalization', 'original',
            '--remove-head-neck',
            '--seed', str(seed),
            '--include-dynamics',
            '--dynamic-features', 'velocity'
        ]

        try:
            main()
        except Exception as e:
            print(f"Lỗi xảy ra tại seed {seed}: {e}")
            continue

    print("\nHOÀN THÀNH Velocity!!!")

    # Motion Energy
    for seed in seeds:
        print(f"\n{'='*20}")
        print(f"BẮT ĐẦU TRAINING VỚI SEED: {seed}")
        print(f"{'='*20}\n")

        sys.argv = [
            'train_stgcn.py',
            '--normalization', 'original',
            '--remove-head-neck',
            '--seed', str(seed),
            '--include-dynamics',
            '--dynamic-features', 'motion_energy'
        ]

        try:
            main()
        except Exception as e:
            print(f"Lỗi xảy ra tại seed {seed}: {e}")
            continue

    print("\nHOÀN THÀNH Motion Energy!!!")

    # Combined BBox + Acceleration
    for seed in seeds:
        print(f"\n{'='*20}")
        print(f"BẮT ĐẦU TRAINING VỚI SEED: {seed}")
        print(f"{'='*20}\n")

        sys.argv = [
            'train_stgcn.py',
            '--normalization', 'bbox',
            '--remove-head-neck',
            '--seed', str(seed),
            '--include-dynamics',
            '--dynamic-features', 'acceleration'
        ]

        try:
            main()
        except Exception as e:
            print(f"Lỗi xảy ra tại seed {seed}: {e}")
            continue

    print("\nHOÀN THÀNH BBox + Acceleration!!!")

    # Combined BBox + Velocity
    for seed in seeds:
        print(f"\n{'='*20}")
        print(f"BẮT ĐẦU TRAINING VỚI SEED: {seed}")
        print(f"{'='*20}\n")

        sys.argv = [
            'train_stgcn.py',
            '--normalization', 'bbox',
            '--remove-head-neck',
            '--seed', str(seed),
            '--include-dynamics',
            '--dynamic-features', 'velocity'
        ]

        try:
            main()
        except Exception as e:
            print(f"Lỗi xảy ra tại seed {seed}: {e}")
            continue

    print("\nHOÀN THÀNH BBox + Velocity!!!")

    # Combined BBox + Motion Energy
    for seed in seeds:
        print(f"\n{'='*20}")
        print(f"BẮT ĐẦU TRAINING VỚI SEED: {seed}")
        print(f"{'='*20}\n")

        sys.argv = [
            'train_stgcn.py',
            '--normalization', 'bbox',
            '--remove-head-neck',
            '--seed', str(seed),
            '--include-dynamics',
            '--dynamic-features', 'motion_energy'
        ]

        try:
            main()
        except Exception as e:
            print(f"Lỗi xảy ra tại seed {seed}: {e}")
            continue

    print("\nHOÀN THÀNH BBox + Motion Energy!!!")

    # Combined Spine Base + Full Dynamics
    for seed in seeds:
        print(f"\n{'='*20}")
        print(f"BẮT ĐẦU TRAINING VỚI SEED: {seed}")
        print(f"{'='*20}\n")

        sys.argv = [
            'train_stgcn.py',
            '--normalization', 'spine_base',
            '--remove-head-neck',
            '--seed', str(seed),
            '--include-dynamics',
            '--dynamic-features', 'acceleration', 'velocity', 'motion_energy'
        ]

        try:
            main()
        except Exception as e:
            print(f"Lỗi xảy ra tại seed {seed}: {e}")
            continue

    print("\nHOÀN THÀNH Spine Base + Full Dynamics!!!")

    # Combined Spine Base + Acceleration
    for seed in seeds:
        print(f"\n{'='*20}")
        print(f"BẮT ĐẦU TRAINING VỚI SEED: {seed}")
        print(f"{'='*20}\n")

        sys.argv = [
            'train_stgcn.py',
            '--normalization', 'spine_base',
            '--remove-head-neck',
            '--seed', str(seed),
            '--include-dynamics',
            '--dynamic-features', 'acceleration'
        ]

        try:
            main()
        except Exception as e:
            print(f"Lỗi xảy ra tại seed {seed}: {e}")
            continue

    print("\nHOÀN THÀNH Spine Base + Acceleration!!!")

    # Combined Spine Base + Velocity
    for seed in seeds:
        print(f"\n{'='*20}")
        print(f"BẮT ĐẦU TRAINING VỚI SEED: {seed}")
        print(f"{'='*20}\n")

        sys.argv = [
            'train_stgcn.py',
            '--normalization', 'spine_base',
            '--remove-head-neck',
            '--seed', str(seed),
            '--include-dynamics',
            '--dynamic-features', 'velocity'
        ]

        try:
            main()
        except Exception as e:
            print(f"Lỗi xảy ra tại seed {seed}: {e}")
            continue

    print("\nHOÀN THÀNH Spine Base + Velocity!!!")

    # Combined Spine Base + Motion Energy
    for seed in seeds:
        print(f"\n{'='*20}")
        print(f"BẮT ĐẦU TRAINING VỚI SEED: {seed}")
        print(f"{'='*20}\n")

        sys.argv = [
            'train_stgcn.py',
            '--normalization', 'spine_base',
            '--remove-head-neck',
            '--seed', str(seed),
            '--include-dynamics',
            '--dynamic-features', 'motion_energy'
        ]

        try:
            main()
        except Exception as e:
            print(f"Lỗi xảy ra tại seed {seed}: {e}")
            continue

    print("\nHOÀN THÀNH Spine Base + Motion Energy!!!")

    # Combined BBox + Full Dynamics
    for seed in seeds:
        print(f"\n{'='*20}")
        print(f"BẮT ĐẦU TRAINING VỚI SEED: {seed}")
        print(f"{'='*20}\n")

        sys.argv = [
            'train_stgcn.py',
            '--normalization', 'bbox',
            '--remove-head-neck',
            '--seed', str(seed),
            '--include-dynamics',
            '--dynamic-features', 'acceleration', 'velocity', 'motion_energy'
        ]

        try:
            main()
        except Exception as e:
            print(f"Lỗi xảy ra tại seed {seed}: {e}")
            continue

    print("\nHOÀN THÀNH BBox + Full Dynamics!!!")


if __name__ == "__main__":
    run_sweep()
