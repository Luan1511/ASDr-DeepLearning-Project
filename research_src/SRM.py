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

# Danh sách 19 khớp (loại bỏ fingers: ThumbLeft, ThumbRight, HandLeft, HandRight, HandTipLeft, HandTipRight)
KINECT19_NO_FINGERS = [
    "Head", "Neck", "SpineShoulder",
    "ShoulderLeft", "ShoulderRight",
    "ElbowLeft", "ElbowRight",
    "WristLeft", "WristRight",
    "SpineMid", "SpineBase",
    "HipLeft", "HipRight",
    "KneeLeft", "KneeRight",
    "AnkleLeft", "AnkleRight",
    "FootLeft", "FootRight"
]

# Danh sách 17 khớp (loại bỏ cả Head, Neck và fingers)
KINECT17_NO_HEAD_NECK_NO_FINGERS = [
    "SpineShoulder",
    "ShoulderLeft", "ShoulderRight",
    "ElbowLeft", "ElbowRight",
    "WristLeft", "WristRight",
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
    Loại bỏ keypoints Head (index 0) và Neck (index 1) khỏi skeleton.

    Parameters
    ----------
    seq : np.ndarray, shape (T, 25, 2)
        Chuỗi keypoints với 25 joints

    Returns
    -------
    np.ndarray, shape (T, 23, 2)
        Chuỗi keypoints với 23 joints (không có Head và Neck)
    """
    # Lấy tất cả joints trừ index 0 (Head) và 1 (Neck)
    return seq[:, 2:, :]


def remove_fingers(seq: np.ndarray, head_neck_removed: bool = False) -> np.ndarray:
    """
    Loại bỏ 6 finger joints khỏi skeleton.
    
    Finger joints trong KINECT25:
    - ThumbLeft (9), ThumbRight (10)
    - HandLeft (11), HandRight (12)
    - HandTipLeft (13), HandTipRight (14)
    
    Parameters
    ----------
    seq : np.ndarray, shape (T, N, 2)
        Chuỗi keypoints với N joints (25 hoặc 23 nếu đã remove head/neck)
    head_neck_removed : bool
        True nếu Head và Neck đã được loại bỏ trước đó (indices đã shift)
    
    Returns
    -------
    np.ndarray, shape (T, N-6, 2)
        Chuỗi keypoints không có finger joints
    """
    if head_neck_removed:
        # Nếu đã remove head/neck, fingers ở index 7-12 (shifted by -2)
        # Giữ joints: 0-6 và 13-20 (từ 23 joints)
        return np.concatenate([seq[:, :7, :], seq[:, 13:, :]], axis=1)
    else:
        # Fingers ở index 9-14 trong KINECT25
        # Giữ joints: 0-8 và 15-24 (từ 25 joints)
        return np.concatenate([seq[:, :9, :], seq[:, 15:, :]], axis=1)


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
        angle = np.arctan2(spine_vec[0], -spine_vec[1])

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


def get_kinect19_bone_pairs() -> List[Tuple[int, int]]:
    """Trả về danh sách các cặp joints tạo thành xương cho Kinect 19 joints (no fingers)"""
    # Mapping KINECT19: Head(0), Neck(1), SpineShoulder(2), ShoulderL(3), ShoulderR(4),
    # ElbowL(5), ElbowR(6), WristL(7), WristR(8), SpineMid(9), SpineBase(10),
    # HipL(11), HipR(12), KneeL(13), KneeR(14), AnkleL(15), AnkleR(16), FootL(17), FootR(18)
    return [
        # Head & Spine
        (0, 1), (1, 2), (2, 9), (9, 10),
        # Left arm (no finger joints)
        (2, 3), (3, 5), (5, 7),
        # Right arm (no finger joints)
        (2, 4), (4, 6), (6, 8),
        # Left leg
        (10, 11), (11, 13), (13, 15), (15, 17),
        # Right leg
        (10, 12), (12, 14), (14, 16), (16, 18)
    ]


def get_kinect19_angle_triplets() -> List[Tuple[int, int, int]]:
    """Trả về danh sách các bộ 3 joints để tính góc cho Kinect 19 joints"""
    return [
        # Left arm angles
        (2, 3, 5),  # SpineShoulder-ShoulderLeft-ElbowLeft
        (3, 5, 7),  # ShoulderLeft-ElbowLeft-WristLeft
        # Right arm angles
        (2, 4, 6),  # SpineShoulder-ShoulderRight-ElbowRight
        (4, 6, 8),  # ShoulderRight-ElbowRight-WristRight
        # Left leg angles
        (10, 11, 13),  # SpineBase-HipLeft-KneeLeft
        (11, 13, 15),  # HipLeft-KneeLeft-AnkleLeft
        # Right leg angles
        (10, 12, 14),  # SpineBase-HipRight-KneeRight
        (12, 14, 16),  # HipRight-KneeRight-AnkleRight
        # Spine angles
        (1, 2, 9),  # Neck-SpineShoulder-SpineMid
        (2, 9, 10),  # SpineShoulder-SpineMid-SpineBase
    ]


def get_kinect17_bone_pairs() -> List[Tuple[int, int]]:
    """Trả về danh sách các cặp joints tạo thành xương cho Kinect 17 joints (no head/neck/fingers)"""
    # Mapping KINECT17: SpineShoulder(0), ShoulderL(1), ShoulderR(2),
    # ElbowL(3), ElbowR(4), WristL(5), WristR(6), SpineMid(7), SpineBase(8),
    # HipL(9), HipR(10), KneeL(11), KneeR(12), AnkleL(13), AnkleR(14), FootL(15), FootR(16)
    return [
        # Spine
        (0, 7), (7, 8),
        # Left arm (no finger joints)
        (0, 1), (1, 3), (3, 5),
        # Right arm (no finger joints)
        (0, 2), (2, 4), (4, 6),
        # Left leg
        (8, 9), (9, 11), (11, 13), (13, 15),
        # Right leg
        (8, 10), (10, 12), (12, 14), (14, 16)
    ]


def get_kinect17_angle_triplets() -> List[Tuple[int, int, int]]:
    """Trả về danh sách các bộ 3 joints để tính góc cho Kinect 17 joints"""
    return [
        # Left arm angles
        (0, 1, 3),  # SpineShoulder-ShoulderLeft-ElbowLeft
        (1, 3, 5),  # ShoulderLeft-ElbowLeft-WristLeft
        # Right arm angles
        (0, 2, 4),  # SpineShoulder-ShoulderRight-ElbowRight
        (2, 4, 6),  # ShoulderRight-ElbowRight-WristRight
        # Left leg angles
        (8, 9, 11),  # SpineBase-HipLeft-KneeLeft
        (9, 11, 13),  # HipLeft-KneeLeft-AnkleLeft
        # Right leg angles
        (8, 10, 12),  # SpineBase-HipRight-KneeRight
        (10, 12, 14),  # HipRight-KneeRight-AnkleRight
        # Spine angles
        (0, 7, 8),  # SpineShoulder-SpineMid-SpineBase
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
                 remove_fingers: bool = False,
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
        remove_fingers : bool, default=False`
            Nếu True, loại bỏ các keypoints ngón tay (ThumbLeft, ThumbRight, HandLeft, HandRight, HandTipLeft, HandTipRight)
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
        self.remove_fingers = remove_fingers
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

        # Cập nhật indices dựa trên việc loại bỏ joints
        if self.remove_head_neck and self.remove_fingers:
            # Loại bỏ cả head/neck và fingers → 17 joints
            self.spine_base_idx = KINECT17_NO_HEAD_NECK_NO_FINGERS.index("SpineBase")
            self.spine_shoulder_idx = KINECT17_NO_HEAD_NECK_NO_FINGERS.index("SpineShoulder")
            self.bone_pairs = get_kinect17_bone_pairs()
            self.angle_triplets = get_kinect17_angle_triplets()
        elif self.remove_head_neck:
            # Chỉ loại bỏ head/neck → 23 joints
            self.spine_base_idx = KINECT23_NO_HEAD_NECK.index("SpineBase")
            self.spine_shoulder_idx = KINECT23_NO_HEAD_NECK.index("SpineShoulder")
            self.bone_pairs = get_kinect23_bone_pairs()
            self.angle_triplets = get_kinect23_angle_triplets()
        elif self.remove_fingers:
            # Chỉ loại bỏ fingers → 19 joints
            self.spine_base_idx = KINECT19_NO_FINGERS.index("SpineBase")
            self.spine_shoulder_idx = KINECT19_NO_FINGERS.index("SpineShoulder")
            self.bone_pairs = get_kinect19_bone_pairs()
            self.angle_triplets = get_kinect19_angle_triplets()
        else:
            # Giữ đầy đủ 25 joints
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

        # Loại bỏ Head và Neck nếu cần (TRƯỚC khi normalize)
        if self.remove_head_neck:
            seq = remove_head_neck(seq)  # (T, 25, 2) -> (T, 23, 2)
        
        # Loại bỏ finger joints nếu cần (TRƯỚC khi normalize)
        if self.remove_fingers:
            seq = remove_fingers(seq, head_neck_removed=self.remove_head_neck)  # (T, N, 2) -> (T, N-6, 2)

        # Áp dụng normalization
        seq = self._apply_normalization(seq)

        # Resample nếu cần
        if self.L is not None:
            seq = _resample_time(seq, self.L)
            length_used = self.L
        else:
            length_used = T

        # Tính số joints thực tế (sau khi loại bỏ Head/Neck và/hoặc fingers nếu có)
        num_joints = 25
        if self.remove_head_neck:
            num_joints -= 2  # Loại bỏ Head và Neck
        if self.remove_fingers:
            num_joints -= 6  # Loại bỏ 6 finger joints

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


# ============================== Test =============================

# if __name__ == "__main__":
#     ROOT = "../Test_st-gcn_dataset2/Dataset"
#
#     print("=" * 60)
#     print("NORMALIZATION DATALOADER WITH DYNAMIC FEATURES")
#     print("=" * 60)
#
#     # Build index
#     entries = build_index(Path(ROOT))
#     print(f"\nFound {len(entries)} 2D files.")
#
#     # Phân tích distribution
#     print("\n" + "=" * 60)
#     print("SUBJECT DISTRIBUTION")
#     print("=" * 60)
#     subjects_asd, subjects_td = analyze_subject_distribution(entries)
#
#     # Chia dữ liệu
#     print("\n" + "=" * 60)
#     print("TRAIN/VAL/TEST SPLIT")
#     print("=" * 60)
#     splits = subject_wise_split(entries, train_ratio=0.7, val_ratio=0.15, seed=42)
#     print(f"Train: {len(splits.train)} samples")
#     print(f"Val: {len(splits.val)} samples")
#     print(f"Test: {len(splits.test)} samples")
#
#     # Test normalization methods
#     norm_methods = ['original', 'combined']
#
#     for norm_method in norm_methods:
#         print("\n" + "=" * 60)
#         print(f"TESTING NORMALIZATION: {norm_method.upper()}")
#         print("=" * 60)
#
#         # Test WITHOUT dynamic features
#         print("\n--- Without Dynamic Features ---")
#         train_ds = Kinect2DNormalizedDataset(
#             entries, splits.train[:10], L=128,
#             normalization=norm_method,
#             remove_head_neck=False,
#             include_dynamics=False
#         )
#
#         dl = DataLoader(train_ds, batch_size=4, shuffle=True, collate_fn=collate_fixedlen)
#         batch = next(iter(dl))
#
#         print(f"Keypoints shape: {batch['keypoints'].shape}")
#         print(f"Labels: {batch['label']}")
#         print(f"Available keys: {list(batch.keys())}")
#
#         # Test WITH dynamic features
#         print("\n--- With Dynamic Features ---")
#         train_ds_dyn = Kinect2DNormalizedDataset(
#             entries, splits.train[:10], L=128,
#             normalization=norm_method,
#             remove_head_neck=False,
#             include_dynamics=True,
#             fps=30.0,
#             dynamic_features=['velocity', 'acceleration', 'bone_lengths',
#                               'joint_angles', 'motion_energy']
#         )
#
#         dl_dyn = DataLoader(train_ds_dyn, batch_size=4, shuffle=True,
#                             collate_fn=collate_fixedlen)
#         batch_dyn = next(iter(dl_dyn))
#
#         print(f"Keypoints shape: {batch_dyn['keypoints'].shape}")
#         print(f"Available keys: {list(batch_dyn.keys())}")
#
#         if 'dynamic_velocity' in batch_dyn:
#             print(f"Velocity shape: {batch_dyn['dynamic_velocity'].shape}")
#             print(f"  Mean: {batch_dyn['dynamic_velocity'].mean().item():.4f}, "
#                   f"Std: {batch_dyn['dynamic_velocity'].std().item():.4f}")
#
#         if 'dynamic_acceleration' in batch_dyn:
#             print(f"Acceleration shape: {batch_dyn['dynamic_acceleration'].shape}")
#             print(f"  Mean: {batch_dyn['dynamic_acceleration'].mean().item():.4f}, "
#                   f"Std: {batch_dyn['dynamic_acceleration'].std().item():.4f}")
#
#         if 'dynamic_bone_lengths' in batch_dyn:
#             print(f"Bone lengths shape: {batch_dyn['dynamic_bone_lengths'].shape}")
#             print(f"  Mean: {batch_dyn['dynamic_bone_lengths'].mean().item():.4f}, "
#                   f"Std: {batch_dyn['dynamic_bone_lengths'].std().item():.4f}")
#
#         if 'dynamic_joint_angles' in batch_dyn:
#             print(f"Joint angles shape: {batch_dyn['dynamic_joint_angles'].shape}")
#             print(f"  Mean (rad): {batch_dyn['dynamic_joint_angles'].mean().item():.4f}, "
#                   f"Std: {batch_dyn['dynamic_joint_angles'].std().item():.4f}")
#
#         if 'dynamic_motion_energy' in batch_dyn:
#             print(f"Motion energy shape: {batch_dyn['dynamic_motion_energy'].shape}")
#             print(f"  Mean: {batch_dyn['dynamic_motion_energy'].mean().item():.4f}, "
#                   f"Std: {batch_dyn['dynamic_motion_energy'].std().item():.4f}")
#
#         # Test với 23 joints (no Head & Neck)
#         print("\n--- With 23 Joints (no Head & Neck) + Dynamics ---")
#         train_ds_23 = Kinect2DNormalizedDataset(
#             entries, splits.train[:10], L=128,
#             normalization=norm_method,
#             remove_head_neck=True,
#             include_dynamics=True,
#             dynamic_features=['velocity', 'motion_energy']
#         )
#
#         dl_23 = DataLoader(train_ds_23, batch_size=4, shuffle=True,
#                            collate_fn=collate_fixedlen)
#         batch_23 = next(iter(dl_23))
#
#         print(f"Keypoints shape: {batch_23['keypoints'].shape}")
#         print(f"Number of joints: {batch_23['num_joints'][0]}")
#         if 'dynamic_velocity' in batch_23:
#             print(f"Velocity shape: {batch_23['dynamic_velocity'].shape}")
#         if 'dynamic_motion_energy' in batch_23:
#             print(f"Motion energy shape: {batch_23['dynamic_motion_energy'].shape}")
#
#     print("\n" + "=" * 60)
#     print("ALL TESTS COMPLETED")
#     print("=" * 60)
#     print("\nUsage example:")
#     print("""
#     # Basic usage without dynamics
#     dataset = Kinect2DNormalizedDataset(
#         entries, indices, L=128,
#         normalization='combined',
#         include_dynamics=False
#     )
#
#     # With all dynamic features
#     dataset = Kinect2DNormalizedDataset(
#         entries, indices, L=128,
#         normalization='combined',
#         include_dynamics=True,
#         fps=30.0
#     )
#
#     # With selected dynamic features
#     dataset = Kinect2DNormalizedDataset(
#         entries, indices, L=128,
#         normalization='combined',
#         include_dynamics=True,
#         fps=30.0,
#         dynamic_features=['velocity', 'motion_energy']
#     )
#     """)

import torch
import torch.nn as nn
import numpy as np
import math


class SpatialRelationMining(nn.Module):
    """
    Mining spatial relationships giữa các joints
    Sử dụng self-attention để học relationships động
    """
    def __init__(self, in_channels, out_channels, num_joints, num_heads=4):
        super().__init__()
        self.in_channels = in_channels
        self.out_channels = out_channels
        self.num_joints = num_joints

        # Feature projection
        self.query_conv = nn.Conv2d(in_channels, out_channels, kernel_size=1)
        self.key_conv = nn.Conv2d(in_channels, out_channels, kernel_size=1)
        self.value_conv = nn.Conv2d(in_channels, out_channels, kernel_size=1)

        # Multi-head attention
        self.num_heads = num_heads
        self.head_dim = out_channels // num_heads

        # Output projection
        self.out_conv = nn.Conv2d(out_channels, out_channels, kernel_size=1)
        self.norm = nn.BatchNorm2d(out_channels)

        # Learnable relation bias
        self.relation_bias = nn.Parameter(torch.zeros(num_joints, num_joints))

    def forward(self, x):
        """
        Args:
            x: (N, C, T, V) - batch, channels, time, vertices
        Returns:
            (N, C_out, T, V)
        """
        N, C, T, num_joints = x.shape

        # Generate query, key, value (avoid variable name conflict with V)
        query = self.query_conv(x)  # (N, C_out, T, V)
        key = self.key_conv(x)
        value = self.value_conv(x)

        # Reshape cho multi-head attention
        query = query.view(N, self.num_heads, self.head_dim, T, num_joints)
        key = key.view(N, self.num_heads, self.head_dim, T, num_joints)
        value = value.view(N, self.num_heads, self.head_dim, T, num_joints)

        # Tính attention weights giữa joints (spatial relations)
        # Transpose để tính attention over joints
        query = query.permute(0, 1, 3, 4, 2)  # (N, heads, T, V, head_dim)
        key = key.permute(0, 1, 3, 2, 4)  # (N, heads, T, head_dim, V)

        # Attention scores
        attn = torch.matmul(query, key) / math.sqrt(self.head_dim)  # (N, heads, T, V, V)

        # Add learnable relation bias
        attn = attn + self.relation_bias.unsqueeze(0).unsqueeze(0).unsqueeze(0)

        attn = torch.softmax(attn, dim=-1)

        # Apply attention to values
        value = value.permute(0, 1, 3, 4, 2)  # (N, heads, T, V, head_dim)
        out = torch.matmul(attn, value)  # (N, heads, T, V, head_dim)

        # Reshape back
        out = out.permute(0, 1, 4, 2, 3)  # (N, heads, head_dim, T, V)
        out = out.reshape(N, self.out_channels, T, num_joints)

        # Output projection
        out = self.out_conv(out)
        out = self.norm(out)

        return out


class TemporalRelationMining(nn.Module):
    """
    Mining temporal relationships trong sequences
    """
    def __init__(self, in_channels, out_channels, kernel_size=3, stride=1):
        super().__init__()
        padding = (kernel_size - 1) // 2

        # Temporal convolution
        self.tcn = nn.Sequential(
            nn.Conv2d(in_channels, out_channels,
                     kernel_size=(kernel_size, 1),
                     stride=(stride, 1),
                     padding=(padding, 0)),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True)
        )

        # Temporal attention
        self.temporal_attn = nn.Sequential(
            nn.Conv2d(out_channels, out_channels // 4, kernel_size=1),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_channels // 4, out_channels, kernel_size=1),
            nn.Sigmoid()
        )

    def forward(self, x):
        """
        Args:
            x: (N, C, T, V)
        Returns:
            (N, C_out, T', V)
        """
        # Temporal convolution
        out = self.tcn(x)

        # Temporal attention
        attn = self.temporal_attn(out)
        out = out * attn

        return out


class SRMBlock(nn.Module):
    """
    SRM Block kết hợp spatial và temporal relation mining
    """
    def __init__(self, in_channels, out_channels, num_joints,
                 temporal_kernel=3, stride=1, num_heads=4, dropout=0.1):
        super().__init__()

        # Spatial relation mining
        self.spatial_rm = SpatialRelationMining(
            in_channels, out_channels, num_joints, num_heads
        )

        # Temporal relation mining
        self.temporal_rm = TemporalRelationMining(
            out_channels, out_channels, temporal_kernel, stride
        )

        # Residual connection
        if stride != 1 or in_channels != out_channels:
            self.residual = nn.Sequential(
                nn.Conv2d(in_channels, out_channels,
                         kernel_size=1, stride=(stride, 1)),
                nn.BatchNorm2d(out_channels)
            )
        else:
            self.residual = nn.Identity()

        self.relu = nn.ReLU(inplace=True)
        self.dropout = nn.Dropout(dropout)

    def forward(self, x):
        """
        Args:
            x: (N, C, T, V)
        Returns:
            (N, C_out, T', V)
        """
        res = self.residual(x)

        # Spatial relation mining
        out = self.spatial_rm(x)

        # Temporal relation mining
        out = self.temporal_rm(out)

        # Residual & activation
        out = out + res
        out = self.relu(out)
        out = self.dropout(out)

        return out


class SkeletonRelationMining(nn.Module):
    """
    Skeleton Relation Mining (SRM) model
    Mining cả spatial và temporal relationships cho skeleton-based action recognition
    """
    def __init__(self, num_joints, in_channels, num_class,
                 base_channels=64, num_blocks=4, num_heads=4, dropout=0.3):
        super().__init__()

        self.num_joints = num_joints
        self.in_channels = in_channels

        # Data normalization
        self.data_bn = nn.BatchNorm1d(in_channels * num_joints)

        # Input projection
        self.input_proj = nn.Sequential(
            nn.Conv2d(in_channels, base_channels, kernel_size=1),
            nn.BatchNorm2d(base_channels),
            nn.ReLU(inplace=True)
        )

        # SRM blocks với increasing channels
        channels = [base_channels, base_channels * 2, base_channels * 4, base_channels * 4]
        self.srm_blocks = nn.ModuleList()

        for i in range(num_blocks):
            in_c = base_channels if i == 0 else channels[i-1]
            out_c = channels[i]
            stride = 2 if i in [1, 2] else 1  # Downsample at middle layers

            self.srm_blocks.append(
                SRMBlock(
                    in_channels=in_c,
                    out_channels=out_c,
                    num_joints=num_joints,
                    temporal_kernel=3,
                    stride=stride,
                    num_heads=num_heads,
                    dropout=dropout
                )
            )

        # Global pooling
        self.global_pool = nn.AdaptiveAvgPool2d((1, 1))

        # Classifier
        self.classifier = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(channels[-1], channels[-1] // 2),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout / 2),
            nn.Linear(channels[-1] // 2, num_class)
        )

        # Initialize weights
        self._initialize_weights()

    def _initialize_weights(self):
        """Initialize weights với Xavier uniform"""
        for m in self.modules():
            if isinstance(m, nn.Conv2d):
                nn.init.xavier_uniform_(m.weight, gain=0.02)
                if m.bias is not None:
                    nn.init.constant_(m.bias, 0)
            elif isinstance(m, nn.BatchNorm2d) or isinstance(m, nn.BatchNorm1d):
                nn.init.constant_(m.weight, 1)
                nn.init.constant_(m.bias, 0)
            elif isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight, gain=0.02)
                nn.init.constant_(m.bias, 0)

    def forward(self, x):
        """
        Args:
            x: (N, C, T, V) hoặc (N, T, V, C) - sẽ được convert
        Returns:
            (N, num_class)
        """
        # Convert from (N, T, V, C) to (N, C, T, V) nếu cần
        if len(x.shape) == 4 and x.shape[-1] == self.in_channels:
            x = x.permute(0, 3, 1, 2)  # (N, T, V, C) -> (N, C, T, V)

        N, C, T, V = x.shape

        # Data normalization
        x = x.permute(0, 3, 1, 2).reshape(N, V * C, T)  # (N, V*C, T)
        x = self.data_bn(x)
        x = x.reshape(N, V, C, T).permute(0, 2, 3, 1)  # (N, C, T, V)

        # Input projection
        x = self.input_proj(x)

        # SRM blocks
        for block in self.srm_blocks:
            x = block(x)

        # Global pooling
        x = self.global_pool(x)  # (N, C, 1, 1)
        x = x.view(N, -1)  # (N, C)

        # Classification
        x = self.classifier(x)

        return x


def create_srm(num_joints, in_channels, num_class, **kwargs):
    """
    Factory function để tạo SRM model

    Args:
        num_joints: Số joints (23 hoặc 25)
        in_channels: Số channels đầu vào
        num_class: Số classes
        **kwargs: base_channels, num_blocks, num_heads, dropout

    Returns:
        SRM model
    """
    return SkeletonRelationMining(
        num_joints=num_joints,
        in_channels=in_channels,
        num_class=num_class,
        **kwargs
    )


if __name__ == "__main__":
    # Smoke test
    print("🚀 Testing SRM model...\n")

    # Test parameters
    batch_size = 4
    seq_len = 128
    num_joints_25 = 25
    num_joints_23 = 23
    in_channels = 2
    in_channels_dyn = 4  # x, y, vx, vy
    num_class = 2

    # Test 1: SRM with 25 joints
    print("=" * 60)
    print("TEST 1: SRM (25 joints, 2 channels)")
    print("=" * 60)
    model1 = create_srm(
        num_joints=num_joints_25,
        in_channels=in_channels,
        num_class=num_class,
        base_channels=64,
        num_blocks=4,
        num_heads=4,
        dropout=0.3
    )

    dummy_input_25 = torch.randn(batch_size, in_channels, seq_len, num_joints_25)
    print(f"✓ Input shape: {dummy_input_25.shape}")

    output1 = model1(dummy_input_25)
    print(f"✓ Output shape: {output1.shape}")
    print(f"✓ Number of parameters: {sum(p.numel() for p in model1.parameters()):,}")
    print("✅ Test 1 passed!\n")

    # Test 2: SRM with 23 joints
    print("=" * 60)
    print("TEST 2: SRM (23 joints, 2 channels)")
    print("=" * 60)
    model2 = create_srm(
        num_joints=num_joints_23,
        in_channels=in_channels,
        num_class=num_class,
        base_channels=64,
        num_blocks=4,
        num_heads=4,
        dropout=0.3
    )

    dummy_input_23 = torch.randn(batch_size, in_channels, seq_len, num_joints_23)
    print(f"✓ Input shape: {dummy_input_23.shape}")

    output2 = model2(dummy_input_23)
    print(f"✓ Output shape: {output2.shape}")
    print(f"✓ Number of parameters: {sum(p.numel() for p in model2.parameters()):,}")
    print("✅ Test 2 passed!\n")

    # Test 3: SRM with dynamic features
    print("=" * 60)
    print("TEST 3: SRM (25 joints + dynamics)")
    print("=" * 60)
    model3 = create_srm(
        num_joints=num_joints_25,
        in_channels=in_channels_dyn,
        num_class=num_class,
        base_channels=64,
        num_blocks=4,
        num_heads=4,
        dropout=0.3
    )

    dummy_input_dyn = torch.randn(batch_size, in_channels_dyn, seq_len, num_joints_25)
    print(f"✓ Input shape: {dummy_input_dyn.shape}")

    output3 = model3(dummy_input_dyn)
    print(f"✓ Output shape: {output3.shape}")
    print(f"✓ Number of parameters: {sum(p.numel() for p in model3.parameters()):,}")
    print("✅ Test 3 passed!\n")

    # Test 4: Với input shape (N, T, V, C)
    print("=" * 60)
    print("TEST 4: SRM (input shape N, T, V, C)")
    print("=" * 60)
    dummy_input_alt = torch.randn(batch_size, seq_len, num_joints_25, in_channels)
    print(f"✓ Input shape: {dummy_input_alt.shape}")

    output4 = model1(dummy_input_alt)
    print(f"✓ Output shape: {output4.shape}")
    print("✅ Test 4 passed!\n")

    print("=" * 60)
    print("🎉 All smoke tests passed successfully!")
    print("=" * 60)


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
from torch.utils.tensorboard import SummaryWriter
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score,
    f1_score, confusion_matrix, classification_report
)
import matplotlib.pyplot as plt
import seaborn as sns

# ====================== CONFIGURATION ======================

class Config:
    """Cấu hình training"""

    def __init__(self):
        # Dataset
        self.data_root = "../Dataset"
        self.sequence_length = 128
        self.train_ratio = 0.7
        self.val_ratio = 0.15
        self.split_seed = 42

        # Normalization method
        self.normalization = 'original'  # 'original', 'spine_base', 'scale', 'combined', 'bbox', 'zscore'
        self.remove_head_neck = False  # Loại bỏ Head và Neck (25 joints -> 23 joints)
        self.remove_fingers = False  # Loại bỏ finger joints (25 joints -> 19 joints)

        # Dynamic features
        self.include_dynamics = True  # Bật/tắt dynamic features
        self.fps = 30.0  # Frame rate của video
        self.dynamic_features = ['velocity', 'acceleration', 'motion_energy']  # Danh sách features
        self.dynamic_fusion = 'concat'  # 'concat', 'separate', 'none'

        # Model SRM
        self.in_channels = 2  # (x, y) - sẽ được cập nhật nếu dùng dynamics
        self.num_class = 2  # ASD vs Typical
        self.num_blocks = 4  # Số lượng SRM blocks
        self.spatial_heads = 4  # Số attention heads cho spatial relation mining (num_heads)
        self.hidden_channels = 64  # Base channels
        self.dropout = 0.3

        # Training
        self.batch_size = 16  # Giảm batch size như Transformer
        self.epochs = 80
        self.lr = 0.00005  # Learning rate thấp hơn ST-GCN
        self.weight_decay = 0.0001
        self.optimizer = 'adamw'  # adam, sgd, adamw
        self.lr_scheduler = 'plateau'  # step, cosine, plateau
        self.lr_step_size = 20
        self.lr_gamma = 0.5

        # Stability optimizations (learned from Transformer)
        self.warmup_epochs = 15  # Warmup learning rate
        self.warmup_lr_start = 1e-6
        self.grad_clip_norm = 1.0  # Gradient clipping
        self.label_smoothing = 0.1  # Label smoothing cho stability
        self.gradient_accumulation_steps = 2  # Tăng effective batch size

        # Early stopping
        self.early_stopping = False
        self.patience = 20

        # Device
        self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
        self.num_workers = 2

        # Logging
        self.log_freq = 10  # Log mỗi N batches
        self.use_tensorboard = True

        # Reproducibility
        self.seed = 42

        # Checkpointing
        self.save_dir = 'experiments_SRM'
        self.exp_name = self._generate_exp_name()
        self.save_freq = 5  # Lưu mỗi N epochs
        self.save_best = True

    def _generate_exp_name(self):
        """Tạo tên experiment tự động"""
        joints_suffix = ''
        if self.remove_head_neck and self.remove_fingers:
            joints_suffix = '_no_head_neck_no_fingers'
        elif self.remove_head_neck:
            joints_suffix = '_no_head_neck'
        elif self.remove_fingers:
            joints_suffix = '_no_fingers'
        
        dynamics_suffix = ''
        if self.include_dynamics:
            features_str = '_'.join(self.dynamic_features[:2])  # Lấy 2 features đầu
            dynamics_suffix = f'_dyn_{features_str}'
        return f'srm_{self.normalization}{joints_suffix}{dynamics_suffix}_seed{self.seed}_{datetime.now().strftime("%Y%m%d_%H%M%S")}'

    def update_exp_name(self):
        """Cập nhật tên experiment sau khi thay đổi config"""
        self.exp_name = self._generate_exp_name()

    def get_effective_in_channels(self):
        """Tính số channels đầu vào thực tế dựa trên dynamic features"""
        base_channels = 2  # x, y

        if not self.include_dynamics or self.dynamic_fusion == 'none':
            return base_channels

        if self.dynamic_fusion == 'concat':
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
        Xử lý batch data với dynamic features
        Args:
            batch: Dict chứa {'keypoints', 'label', 'dynamic_velocity', 'dynamic_acceleration', ...}
                  keypoints: (N, T, V, 2)
        Returns:
            tensor: (N, C, T, V) - shape cho SRM model
        """
        keypoints = batch['keypoints']  # (N, T, V, 2)
        N, T, V, _ = keypoints.shape

        if not self.config.include_dynamics or self.fusion_mode == 'none':
            # Chỉ dùng keypoints: (N, T, V, 2) -> (N, 2, T, V)
            return keypoints.permute(0, 3, 1, 2)

        if self.fusion_mode == 'concat':
            # Concat các dynamic features vào channel dimension
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
            # Permute cho SRM: (N, T, V, C) -> (N, C, T, V)
            return combined.permute(0, 3, 1, 2)

        return keypoints.permute(0, 3, 1, 2)


# ====================== METRICS TRACKER ======================

class MetricsTracker:
    """Theo dõi và tính toán metrics"""

    def __init__(self):
        self.reset()

    def reset(self):
        self.losses = []
        self.predictions = []
        self.labels = []

    def update(self, loss, preds, labels):
        """Cập nhật metrics với NaN filtering như Transformer"""
        # Filter NaN losses
        if loss is not None and not (np.isnan(loss) or np.isinf(loss)):
            self.losses.append(loss)

        if preds is not None and labels is not None:
            self.predictions.extend(preds)
            self.labels.extend(labels)

    def compute(self):
        """Tính toán metrics cuối cùng"""
        metrics = {}

        # Average loss với NaN check
        if len(self.losses) > 0:
            metrics['loss'] = np.mean(self.losses)
        else:
            metrics['loss'] = float('nan')

        if len(self.predictions) > 0 and len(self.labels) > 0:
            metrics['accuracy'] = accuracy_score(self.labels, self.predictions)
            metrics['precision'] = precision_score(self.labels, self.predictions, average='weighted', zero_division=0)
            metrics['recall'] = recall_score(self.labels, self.predictions, average='weighted', zero_division=0)
            metrics['f1'] = f1_score(self.labels, self.predictions, average='weighted', zero_division=0)

        return metrics


# ====================== TRAINER ======================

class Trainer:
    """Class quản lý quá trình training"""

    def __init__(self, config: Config):
        self.config = config
        self.device = torch.device(config.device)

        # Set random seed
        self._set_seed(config.seed)

        # Tạo thư mục lưu kết quả
        self.save_path = Path(config.save_dir) / config.exp_name
        self.save_path.mkdir(parents=True, exist_ok=True)

        # Lưu config
        with open(self.save_path / 'config.json', 'w') as f:
            json.dump(config.to_dict(), f, indent=4)

        # Tensorboard
        if config.use_tensorboard:
            self.writer = SummaryWriter(log_dir=str(self.save_path / 'logs'))
        else:
            self.writer = None

        # Dynamic features processor
        self.dynamic_processor = DynamicFeaturesProcessor(config)

        # Load dataset
        print("📊 Loading dataset...")
        self.train_loader, self.val_loader, self.test_loader = self._prepare_data()

        # Build model
        print("🏗️  Building SRM model...")
        self.model = self._build_model()

        # Loss and optimizer
        self.criterion = nn.CrossEntropyLoss(label_smoothing=config.label_smoothing)
        self.optimizer = self._build_optimizer()
        self.scheduler = self._build_scheduler()

        # Training state
        self.current_epoch = 0
        self.best_val_acc = 0.0
        self.best_epoch = 0
        self.epochs_no_improve = 0
        self.training_history = {
            'train_loss': [], 'train_acc': [],
            'val_loss': [], 'val_acc': [],
            'lr': []
        }

    def _set_seed(self, seed):
        """Set random seed cho reproducibility"""
        np.random.seed(seed)
        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed(seed)
            torch.cuda.manual_seed_all(seed)
            torch.backends.cudnn.deterministic = True
            torch.backends.cudnn.benchmark = False

    def _prepare_data(self):
        """Chuẩn bị data loaders"""
        # Build index
        entries = build_index(Path(self.config.data_root))
        print(f"Found {len(entries)} samples")

        # Split
        splits = subject_wise_split(
            entries,
            train_ratio=self.config.train_ratio,
            val_ratio=self.config.val_ratio,
            seed=self.config.split_seed
        )
        # splits returns indices, get actual entries
        train_entries = [entries[i] for i in splits.train]
        val_entries = [entries[i] for i in splits.val]
        test_entries = [entries[i] for i in splits.test]
        print(f"Split: Train={len(train_entries)}, Val={len(val_entries)}, Test={len(test_entries)}")

        # Create datasets
        train_dataset = Kinect2DNormalizedDataset(
            entries=entries,
            indices=splits.train,
            L=self.config.sequence_length,
            normalization=self.config.normalization,
            remove_head_neck=self.config.remove_head_neck,
            remove_fingers=self.config.remove_fingers,
            include_dynamics=self.config.include_dynamics,
            fps=self.config.fps,
            dynamic_features=self.config.dynamic_features
        )

        val_dataset = Kinect2DNormalizedDataset(
            entries=entries,
            indices=splits.val,
            L=self.config.sequence_length,
            normalization=self.config.normalization,
            remove_head_neck=self.config.remove_head_neck,
            remove_fingers=self.config.remove_fingers,
            include_dynamics=self.config.include_dynamics,
            fps=self.config.fps,
            dynamic_features=self.config.dynamic_features
        )

        test_dataset = Kinect2DNormalizedDataset(
            entries=entries,
            indices=splits.test,
            L=self.config.sequence_length,
            normalization=self.config.normalization,
            remove_head_neck=self.config.remove_head_neck,
            remove_fingers=self.config.remove_fingers,
            include_dynamics=self.config.include_dynamics,
            fps=self.config.fps,
            dynamic_features=self.config.dynamic_features
        )

        # Create data loaders
        train_loader = DataLoader(
            train_dataset,
            batch_size=self.config.batch_size,
            shuffle=True,
            num_workers=self.config.num_workers,
            collate_fn=collate_fixedlen,
            pin_memory=True
        )

        val_loader = DataLoader(
            val_dataset,
            batch_size=self.config.batch_size,
            shuffle=False,
            num_workers=self.config.num_workers,
            collate_fn=collate_fixedlen,
            pin_memory=True
        )

        test_loader = DataLoader(
            test_dataset,
            batch_size=self.config.batch_size,
            shuffle=False,
            num_workers=self.config.num_workers,
            collate_fn=collate_fixedlen,
            pin_memory=True
        )

        return train_loader, val_loader, test_loader

    def _build_model(self):
        """Build SRM model"""
        in_channels = self.config.get_effective_in_channels()
        num_joints = 25
        if self.config.remove_head_neck:
            num_joints -= 2
        if self.config.remove_fingers:
            num_joints -= 6

        print(f"Model config: in_channels={in_channels}, num_joints={num_joints}, "
              f"num_blocks={self.config.num_blocks}")

        model = create_srm(
            num_joints=num_joints,
            in_channels=in_channels,
            num_class=self.config.num_class,
            base_channels=self.config.hidden_channels,
            num_blocks=self.config.num_blocks,
            num_heads=self.config.spatial_heads,
            dropout=self.config.dropout
        )

        model = model.to(self.device)

        # Initialize weights
        self._initialize_weights(model)

        # Print model info
        total_params = sum(p.numel() for p in model.parameters())
        trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
        print(f"Total parameters: {total_params:,}")
        print(f"Trainable parameters: {trainable_params:,}")

        return model

    def _initialize_weights(self, model):
        """Initialize model weights như Transformer"""
        for m in model.modules():
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight, gain=0.02)
                if m.bias is not None:
                    nn.init.constant_(m.bias, 0)
            elif isinstance(m, nn.Conv2d):
                nn.init.kaiming_normal_(m.weight, mode='fan_out', nonlinearity='relu')
                if m.bias is not None:
                    nn.init.constant_(m.bias, 0)
            elif isinstance(m, (nn.BatchNorm1d, nn.BatchNorm2d)):
                nn.init.constant_(m.weight, 1)
                nn.init.constant_(m.bias, 0)

    def _build_optimizer(self):
        """Build optimizer"""
        if self.config.optimizer == 'adam':
            return optim.Adam(
                self.model.parameters(),
                lr=self.config.lr,
                weight_decay=self.config.weight_decay
            )
        elif self.config.optimizer == 'sgd':
            return optim.SGD(
                self.model.parameters(),
                lr=self.config.lr,
                momentum=0.9,
                weight_decay=self.config.weight_decay,
                nesterov=True
            )
        elif self.config.optimizer == 'adamw':
            return optim.AdamW(
                self.model.parameters(),
                lr=self.config.lr,
                weight_decay=self.config.weight_decay
            )

    def _build_scheduler(self):
        """Build learning rate scheduler"""
        if self.config.lr_scheduler == 'step':
            return optim.lr_scheduler.StepLR(
                self.optimizer,
                step_size=self.config.lr_step_size,
                gamma=self.config.lr_gamma
            )
        elif self.config.lr_scheduler == 'cosine':
            return optim.lr_scheduler.CosineAnnealingLR(
                self.optimizer,
                T_max=self.config.epochs
            )
        elif self.config.lr_scheduler == 'plateau':
            return optim.lr_scheduler.ReduceLROnPlateau(
                self.optimizer,
                mode='max',
                factor=self.config.lr_gamma,
                patience=10,
                verbose=True
            )

    def _get_warmup_lr(self, epoch):
        """Tính learning rate cho warmup period"""
        if epoch >= self.config.warmup_epochs:
            return self.config.lr

        # Linear warmup
        warmup_progress = epoch / self.config.warmup_epochs
        lr = self.config.warmup_lr_start + (self.config.lr - self.config.warmup_lr_start) * warmup_progress
        return lr

    def _set_learning_rate(self, lr):
        """Set learning rate cho optimizer"""
        for param_group in self.optimizer.param_groups:
            param_group['lr'] = lr

    def train_epoch(self):
        """Train một epoch"""
        self.model.train()
        metrics_tracker = MetricsTracker()

        # Warmup learning rate
        if self.current_epoch < self.config.warmup_epochs:
            warmup_lr = self._get_warmup_lr(self.current_epoch)
            self._set_learning_rate(warmup_lr)
            print(f"Warmup LR: {warmup_lr:.6f}")

        # Gradient accumulation
        accumulation_steps = self.config.gradient_accumulation_steps
        self.optimizer.zero_grad()

        for batch_idx, batch in enumerate(self.train_loader):
            try:
                # Process input
                inputs = self.dynamic_processor.process_batch(batch)  # (N, C, T, V)
                labels = batch['label']

                inputs = inputs.to(self.device, non_blocking=True)
                labels = labels.to(self.device, non_blocking=True)

                # Forward pass
                outputs = self.model(inputs)
                loss = self.criterion(outputs, labels)

                # Check for NaN/Inf
                if torch.isnan(loss) or torch.isinf(loss):
                    print(f"\n⚠️  NaN/Inf loss detected at batch {batch_idx}, skipping...")
                    self.optimizer.zero_grad()
                    continue

                # Backward pass với gradient accumulation
                loss = loss / accumulation_steps
                loss.backward()

                # Gradient clipping và update
                if (batch_idx + 1) % accumulation_steps == 0:
                    # Clip gradients
                    torch.nn.utils.clip_grad_norm_(
                        self.model.parameters(),
                        self.config.grad_clip_norm
                    )

                    # Check for NaN gradients
                    has_nan_grad = False
                    for param in self.model.parameters():
                        if param.grad is not None:
                            if torch.isnan(param.grad).any() or torch.isinf(param.grad).any():
                                has_nan_grad = True
                                break

                    if has_nan_grad:
                        print(f"\n⚠️  NaN/Inf gradient at batch {batch_idx}, skipping update...")
                        self.optimizer.zero_grad()
                        continue

                    self.optimizer.step()
                    self.optimizer.zero_grad()

                # Predictions
                _, preds = torch.max(outputs, 1)

                # Update metrics
                metrics_tracker.update(
                    loss.item() * accumulation_steps,
                    preds.cpu().numpy().tolist(),
                    labels.cpu().numpy().tolist()
                )

                # Logging
                if (batch_idx + 1) % self.config.log_freq == 0:
                    current_metrics = metrics_tracker.compute()
                    print(f"Batch [{batch_idx + 1}/{len(self.train_loader)}] "
                          f"Loss: {current_metrics['loss']:.4f}, "
                          f"Acc: {current_metrics.get('accuracy', 0):.4f}")

            except RuntimeError as e:
                if "out of memory" in str(e):
                    print(f"\n⚠️  OOM at batch {batch_idx}, skipping...")
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                    self.optimizer.zero_grad()
                    continue
                else:
                    raise e

        return metrics_tracker.compute()

    def validate(self, data_loader):
        """Validate trên một data loader"""
        self.model.eval()
        metrics_tracker = MetricsTracker()

        with torch.no_grad():
            for batch in data_loader:
                # Process input
                inputs = self.dynamic_processor.process_batch(batch)
                labels = batch['label']

                inputs = inputs.to(self.device, non_blocking=True)
                labels = labels.to(self.device, non_blocking=True)

                # Forward pass
                outputs = self.model(inputs)
                loss = self.criterion(outputs, labels)

                # Predictions
                _, preds = torch.max(outputs, 1)

                # Update metrics
                metrics_tracker.update(
                    loss.item(),
                    preds.cpu().numpy().tolist(),
                    labels.cpu().numpy().tolist()
                )

        return metrics_tracker.compute()

    def train(self):
        """Training loop chính"""
        print(f"\n🚀 Starting training for {self.config.epochs} epochs...")
        print(f"Device: {self.device}")
        print(f"Batch size: {self.config.batch_size} x {self.config.gradient_accumulation_steps} (effective)")
        print(f"Save path: {self.save_path}\n")

        for epoch in range(self.config.epochs):
            self.current_epoch = epoch
            epoch_start_time = time.time()

            # Train
            train_metrics = self.train_epoch()

            # Validate
            val_metrics = self.validate(self.val_loader)

            # Learning rate
            current_lr = self.optimizer.param_groups[0]['lr']

            # Update scheduler
            if self.config.lr_scheduler == 'plateau':
                self.scheduler.step(val_metrics['accuracy'])
            elif epoch >= self.config.warmup_epochs:
                self.scheduler.step()

            # Time
            epoch_time = time.time() - epoch_start_time

            # Print
            print(f"\nEpoch [{epoch + 1}/{self.config.epochs}] ({epoch_time:.1f}s)")
            print(f"Train - Loss: {train_metrics['loss']:.4f}, "
                  f"Acc: {train_metrics.get('accuracy', 0):.4f}, "
                  f"F1: {train_metrics.get('f1', 0):.4f}")
            print(f"Val   - Loss: {val_metrics['loss']:.4f}, "
                  f"Acc: {val_metrics.get('accuracy', 0):.4f}, "
                  f"F1: {val_metrics.get('f1', 0):.4f}")
            print(f"LR: {current_lr:.6f}")

            # Save history
            self.training_history['train_loss'].append(train_metrics['loss'])
            self.training_history['train_acc'].append(train_metrics.get('accuracy', 0))
            self.training_history['val_loss'].append(val_metrics['loss'])
            self.training_history['val_acc'].append(val_metrics.get('accuracy', 0))
            self.training_history['lr'].append(current_lr)

            # Tensorboard
            if self.writer:
                self.writer.add_scalars('Loss', {
                    'train': train_metrics['loss'],
                    'val': val_metrics['loss']
                }, epoch + 1)
                self.writer.add_scalars('Accuracy', {
                    'train': train_metrics.get('accuracy', 0),
                    'val': val_metrics.get('accuracy', 0)
                }, epoch + 1)
                self.writer.add_scalar('Learning_Rate', current_lr, epoch + 1)


            # Test lưu best loss vall + best acc val==================
            self.best_val_loss = float('inf')
            val_acc = val_metrics.get('accuracy', 0)
            val_loss = val_metrics.get('loss', float('inf'))

            if val_acc > self.best_val_acc or val_loss < self.best_val_loss:
                if val_acc > self.best_val_acc:
                    self.best_val_acc = val_acc

                if val_loss < self.best_val_loss:
                    self.best_val_loss = val_loss

                self.best_epoch = epoch + 1
                self.epochs_no_improve = 0
                if self.config.save_best:
                    self.save_checkpoint('best_checkpoint.pt')
                    print(f"✅ Saved best model (Acc: {val_acc:.4f}, Loss: {val_loss:.4f})")
            else:
                self.epochs_no_improve += 1
            # ========================================================


            # Save periodic checkpoint
            if (epoch + 1) % self.config.save_freq == 0:
                self.save_checkpoint(f'checkpoint_epoch_{epoch + 1}.pt')

            # Early stopping warning (nhưng không dừng training)
            if self.config.early_stopping and self.epochs_no_improve >= self.config.patience:
                print(f"\n⚠️  No improvement for {self.config.patience} epochs (best: epoch {self.best_epoch}, val_acc={self.best_val_acc:.4f})")
                print(f"    Training continues to collect data...")

        # Save final
        self.save_checkpoint('final_model.pt')
        self.save_training_history()
        print("\n✅ Training completed!")

    def test(self):
        """Evaluate trên test set"""
        print("\n📊 Evaluating on test set...")

        # Load best model
        best_model_path = self.save_path / 'best_checkpoint.pt'
        if best_model_path.exists():
            checkpoint = torch.load(best_model_path, map_location=self.device)
            self.model.load_state_dict(checkpoint['model_state_dict'])
            print(f"Loaded best checkpoint from epoch {checkpoint['epoch']} (val_acc={checkpoint['best_val_acc']:.4f})")

        # Test
        test_metrics = self.validate(self.test_loader)

        print(f"\n📈 Test Results:")
        print(f"Accuracy:  {test_metrics['accuracy']:.4f}")
        print(f"Precision: {test_metrics['precision']:.4f}")
        print(f"Recall:    {test_metrics['recall']:.4f}")
        print(f"F1 Score:  {test_metrics['f1']:.4f}")

        # Save test results
        with open(self.save_path / 'test_results.json', 'w') as f:
            json.dump(test_metrics, f, indent=4)

        # Confusion matrix
        self.plot_confusion_matrix(test_metrics)

        return test_metrics

    def plot_confusion_matrix(self, metrics):
        """Vẽ confusion matrix"""
        if 'predictions' not in metrics or 'labels' not in metrics:
            # Get predictions for confusion matrix
            self.model.eval()
            all_preds = []
            all_labels = []

            with torch.no_grad():
                for batch in self.test_loader:
                    inputs = self.dynamic_processor.process_batch(batch)
                    labels = batch['label']

                    inputs = inputs.to(self.device)
                    outputs = self.model(inputs)
                    _, preds = torch.max(outputs, 1)

                    all_preds.extend(preds.cpu().numpy().tolist())
                    all_labels.extend(labels.numpy().tolist())
        else:
            all_preds = metrics['predictions']
            all_labels = metrics['labels']

        cm = confusion_matrix(all_labels, all_preds)

        plt.figure(figsize=(8, 6))
        sns.heatmap(cm, annot=True, fmt='d', cmap='Blues',
                    xticklabels=['Typical', 'ASD'],
                    yticklabels=['Typical', 'ASD'])
        plt.title('Confusion Matrix - SRM')
        plt.ylabel('True Label')
        plt.xlabel('Predicted Label')
        plt.tight_layout()
        plt.savefig(self.save_path / 'confusion_matrix.png', dpi=300)
        plt.close()

    def save_checkpoint(self, filename):
        """Lưu checkpoint"""
        checkpoint = {
            'epoch': self.current_epoch + 1,
            'model_state_dict': self.model.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict(),
            'scheduler_state_dict': self.scheduler.state_dict(),
            'best_val_acc': self.best_val_acc,
            'best_epoch': self.best_epoch,
            'training_history': self.training_history,
            'config': self.config.to_dict()
        }
        torch.save(checkpoint, self.save_path / filename)

    def save_training_history(self):
        """Lưu training history"""
        with open(self.save_path / 'training_history.json', 'w') as f:
            json.dump(self.training_history, f, indent=4)

        # Plot training curves
        self.plot_training_curves()

    def plot_training_curves(self):
        """Vẽ training curves"""
        epochs = range(1, len(self.training_history['train_loss']) + 1)

        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(15, 5))

        # Loss
        ax1.plot(epochs, self.training_history['train_loss'], 'b-', label='Train')
        ax1.plot(epochs, self.training_history['val_loss'], 'r-', label='Val')
        ax1.set_xlabel('Epoch')
        ax1.set_ylabel('Loss')
        ax1.set_title('Training and Validation Loss')
        ax1.legend()
        ax1.grid(True)

        # Accuracy
        ax2.plot(epochs, self.training_history['train_acc'], 'b-', label='Train')
        ax2.plot(epochs, self.training_history['val_acc'], 'r-', label='Val')
        ax2.set_xlabel('Epoch')
        ax2.set_ylabel('Accuracy')
        ax2.set_title('Training and Validation Accuracy')
        ax2.legend()
        ax2.grid(True)

        plt.tight_layout()
        plt.savefig(self.save_path / 'training_curves.png', dpi=300)
        plt.close()


# ====================== MAIN ======================

def parse_args():
    """Parse command line arguments"""
    parser = argparse.ArgumentParser(description='Train SRM for ASD classification')

    # Dataset
    parser.add_argument('--data_root', type=str, default='Datas')
    parser.add_argument('--sequence_length', type=int, default=128)
    parser.add_argument('--normalization', type=str, default='original',
                        choices=['original', 'spine_base', 'scale', 'combined', 'combined_bbox_rotate', 'bbox', 'zscore'])
    parser.add_argument('--remove_head_neck', action='store_true')
    parser.add_argument('--remove_fingers', action='store_true',
                        help='Remove finger keypoints (ThumbLeft, ThumbRight, HandLeft, HandRight, HandTipLeft, HandTipRight)')
    parser.add_argument('--split_seed', type=int, default=42)

    # Dynamic features
    parser.add_argument('--include_dynamics', action='store_true', default=False)
    parser.add_argument('--no_dynamics', action='store_false', dest='include_dynamics')
    parser.add_argument('--dynamic_features', nargs='+', 
                        default=['velocity', 'acceleration', 'motion_energy'],
                        choices=['velocity', 'acceleration', 'motion_energy'],
                        help='List of dynamic features to include')
    parser.add_argument('--fps', type=float, default=30.0,
                        help='Frame rate for computing dynamic features')

    # Model
    parser.add_argument('--num_blocks', type=int, default=4)
    parser.add_argument('--spatial_heads', type=int, default=4)
    parser.add_argument('--hidden_channels', type=int, default=64)
    parser.add_argument('--dropout', type=float, default=0.3)

    # Training
    parser.add_argument('--batch_size', type=int, default=32)
    parser.add_argument('--epochs', type=int, default=80)
    parser.add_argument('--lr', type=float, default=0.00005)
    parser.add_argument('--weight_decay', type=float, default=0.0001)
    parser.add_argument('--optimizer', type=str, default='adamw',
                        choices=['adam', 'sgd', 'adamw'])
    parser.add_argument('--lr_scheduler', type=str, default='plateau',
                        choices=['step', 'cosine', 'plateau'])

    # Stability
    parser.add_argument('--warmup_epochs', type=int, default=15)
    parser.add_argument('--grad_clip_norm', type=float, default=1.0)
    parser.add_argument('--label_smoothing', type=float, default=0.1)
    parser.add_argument('--gradient_accumulation_steps', type=int, default=2)

    # Other
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--save_dir', type=str, default='experiments_SRM')
    parser.add_argument('--no_tensorboard', action='store_true')

    return parser.parse_args()


def main():
    """Main function"""
    args = parse_args()

    # Create config
    config = Config()

    # Update config from args
    for key, value in vars(args).items():
        if hasattr(config, key):
            setattr(config, key, value)

    # Special handling for tensorboard
    if args.no_tensorboard:
        config.use_tensorboard = False

    # Update experiment name
    config.update_exp_name()

    # Print config
    print("=" * 50)
    print("Configuration:")
    print("=" * 50)
    for key, value in config.to_dict().items():
        print(f"{key}: {value}")
    print("=" * 50)

    # Create trainer
    trainer = Trainer(config)

    # Train
    trainer.train()

    # Test
    trainer.test()

#!/usr/bin/env python
# coding: utf-8

"""
K-Fold Cross-Validation cho SRM Model

Thực hiện 5-fold cross-validation để đánh giá model một cách công bằng hơn
khi dataset nhỏ (~50 subjects/class).

Usage:
    python train_srm_kfold.py --normalization combined --include_dynamics --seed 41
"""

import random
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Tuple, Dict, Optional
import argparse
import sys
import json
from datetime import datetime

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
from sklearn.model_selection import StratifiedKFold
from sklearn.metrics import accuracy_score, precision_recall_fscore_support, confusion_matrix

# ======================= K-FOLD UTILITIES =======================

def subject_wise_kfold_split(entries: List[SampleInfo], 
                             n_splits: int = 5, 
                             seed: Optional[int] = 42) -> List[Tuple[List[int], List[int]]]:
    """
    Chia dataset thành K folds theo subject (stratified).
    
    Parameters
    ----------
    entries : List[SampleInfo]
        Danh sách tất cả samples
    n_splits : int
        Số lượng folds (mặc định 5)
    seed : int
        Random seed
        
    Returns
    -------
    List[Tuple[List[int], List[int]]]
        Danh sách các (train_indices, test_indices) cho mỗi fold
    """
    rng = random.Random(seed) if seed is not None else random.Random()
    np_rng = np.random.RandomState(seed) if seed is not None else np.random.RandomState()
    
    # Gom theo (label, subject_id)
    by_subject: Dict[Tuple[int, str], List[int]] = {}
    for i, e in enumerate(entries):
        by_subject.setdefault((e.label, e.subject_id), []).append(i)
    
    # Tách danh sách subject ASD và TD
    subjects_asd = [k for k in by_subject if k[0] == 1]
    subjects_td = [k for k in by_subject if k[0] == 0]
    
    print(f"\nDataset Statistics:")
    print(f"  Total subjects: {len(by_subject)}")
    print(f"  ASD subjects: {len(subjects_asd)}")
    print(f"  TD subjects: {len(subjects_td)}")
    
    # Tạo danh sách subjects và labels cho StratifiedKFold
    all_subjects = subjects_asd + subjects_td
    subject_labels = [1] * len(subjects_asd) + [0] * len(subjects_td)
    
    # Shuffle để random hóa
    combined = list(zip(all_subjects, subject_labels))
    rng.shuffle(combined)
    all_subjects, subject_labels = zip(*combined)
    all_subjects = list(all_subjects)
    subject_labels = list(subject_labels)
    
    # Tạo K-Fold stratified
    skf = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=seed)
    
    folds = []
    for fold_idx, (train_sub_idx, test_sub_idx) in enumerate(skf.split(all_subjects, subject_labels)):
        # Lấy subjects cho train và test
        train_subjects = [all_subjects[i] for i in train_sub_idx]
        test_subjects = [all_subjects[i] for i in test_sub_idx]
        
        # Gather indices của các samples
        train_indices = []
        test_indices = []
        
        for subj in train_subjects:
            train_indices.extend(by_subject[subj])
        
        for subj in test_subjects:
            test_indices.extend(by_subject[subj])
        
        # Shuffle indices
        rng.shuffle(train_indices)
        rng.shuffle(test_indices)
        
        # Count labels
        train_asd = sum(1 for i in train_indices if entries[i].label == 1)
        train_td = len(train_indices) - train_asd
        test_asd = sum(1 for i in test_indices if entries[i].label == 1)
        test_td = len(test_indices) - test_asd
        
        print(f"\nFold {fold_idx + 1}:")
        print(f"  Train: {len(train_indices)} samples ({train_asd} ASD, {train_td} TD)")
        print(f"  Test:  {len(test_indices)} samples ({test_asd} ASD, {test_td} TD)")
        
        folds.append((train_indices, test_indices))
    
    return folds


# ======================= TRAINER FOR ONE FOLD =======================

class FoldTrainer:
    """Trainer cho một fold trong K-Fold CV"""
    
    def __init__(self, config: Config, fold_idx: int):
        self.config = config
        self.fold_idx = fold_idx
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        
        print(f"\n{'='*70}")
        print(f"FOLD {fold_idx + 1}/{config.n_folds}")
        print(f"{'='*70}")
        print(f"Device: {self.device}")
        
        # Set random seed
        self._set_seed(config.seed)
        
        # Build model
        self.model = self._build_model()
        
        # Optimizer and scheduler
        self.optimizer = optim.AdamW(
            self.model.parameters(),
            lr=config.lr,
            weight_decay=config.weight_decay
        )
        
        self.scheduler = optim.lr_scheduler.ReduceLROnPlateau(
            self.optimizer,
            mode='max',
            factor=0.5,
            patience=config.patience,
            verbose=True
        )
        
        # Loss function
        self.criterion = nn.CrossEntropyLoss()
        
        # Training state
        self.best_val_acc = 0.0
        self.best_model_state = None
        self.epochs_no_improve = 0
        
        # Training history tracking
        self.history = {
            'train_loss': [],
            'train_acc': [],
            'val_loss': [],
            'val_acc': []
        }
        
    def _set_seed(self, seed):
        """Set random seeds"""
        random.seed(seed)
        np.random.seed(seed)
        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed(seed)
            torch.cuda.manual_seed_all(seed)
            torch.backends.cudnn.deterministic = True
            torch.backends.cudnn.benchmark = False
    
    def _build_model(self):
        """Build SRM model"""
        in_channels = self.config.get_effective_in_channels()
        num_joints = 25
        if self.config.remove_head_neck:
            num_joints -= 2
        if self.config.remove_fingers:
            num_joints -= 6
        
        print(f"\n=== Model Configuration ===")
        print(f"  in_channels: {in_channels}")
        print(f"  num_joints: {num_joints}")
        print(f"  include_dynamics: {self.config.include_dynamics}")
        print(f"  dynamic_features: {self.config.dynamic_features}")
        print(f"  dynamic_fusion: {self.config.dynamic_fusion}")
        print(f"===========================\n")
        
        model = create_srm(
            num_joints=num_joints,
            in_channels=in_channels,
            num_class=self.config.num_class,
            base_channels=self.config.hidden_channels,
            num_blocks=self.config.num_blocks,
            num_heads=self.config.spatial_heads,
            dropout=self.config.dropout
        )
        
        model = model.to(self.device)
        
        # Initialize weights
        self._initialize_weights(model)
        
        total_params = sum(p.numel() for p in model.parameters())
        trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
        print(f"Total parameters: {total_params:,}")
        print(f"Trainable parameters: {trainable_params:,}")
        
        return model
    
    def _initialize_weights(self, model):
        """Initialize model weights"""
        for m in model.modules():
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight)
                if m.bias is not None:
                    nn.init.constant_(m.bias, 0)
            elif isinstance(m, nn.Conv2d):
                nn.init.kaiming_normal_(m.weight, mode='fan_out', nonlinearity='relu')
                if m.bias is not None:
                    nn.init.constant_(m.bias, 0)
            elif isinstance(m, (nn.BatchNorm2d, nn.BatchNorm1d)):
                nn.init.constant_(m.weight, 1)
                nn.init.constant_(m.bias, 0)
    
    def _prepare_input(self, batch):
        """
        Chuẩn bị input từ batch, concat dynamic features nếu cần
        
        Args:
            batch: Dict chứa 'keypoints' và các dynamic features
            
        Returns:
            torch.Tensor: (B, T, J, C) với C là tổng số channels
        """
        keypoints = batch['keypoints']  # (B, T, J, 2)
        
        if not self.config.include_dynamics or self.config.dynamic_fusion != 'concat':
            return keypoints
        
        # Concat dynamic features
        features_to_concat = [keypoints]
        
        if 'velocity' in self.config.dynamic_features and 'dynamic_velocity' in batch:
            features_to_concat.append(batch['dynamic_velocity'])
        
        if 'acceleration' in self.config.dynamic_features and 'dynamic_acceleration' in batch:
            features_to_concat.append(batch['dynamic_acceleration'])
        
        if 'motion_energy' in self.config.dynamic_features and 'dynamic_motion_energy' in batch:
            motion_energy = batch['dynamic_motion_energy'].unsqueeze(-1)  # (B, T, J, 1)
            features_to_concat.append(motion_energy)
        
        # Concat along channel dimension
        concatenated = torch.cat(features_to_concat, dim=-1)  # (B, T, J, C)
        
        return concatenated
    
    def train_epoch(self, train_loader):
        """Train one epoch"""
        self.model.train()
        total_loss = 0.0
        all_preds = []
        all_labels = []
        
        for batch_idx, batch in enumerate(train_loader):
            # Concat dynamic features if needed
            keypoints = self._prepare_input(batch)
            keypoints = keypoints.to(self.device)  # (B, T, J, C)
            labels = batch['label'].to(self.device)  # (B,)
            
            # Forward
            logits = self.model(keypoints)  # (B, num_class)
            loss = self.criterion(logits, labels)
            
            # Backward
            self.optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=1.0)
            self.optimizer.step()
            
            # Stats
            total_loss += loss.item()
            preds = torch.argmax(logits, dim=1)
            all_preds.extend(preds.cpu().numpy())
            all_labels.extend(labels.cpu().numpy())
        
        avg_loss = total_loss / len(train_loader)
        acc = accuracy_score(all_labels, all_preds)
        
        return avg_loss, acc
    
    def validate(self, val_loader):
        """Validate"""
        self.model.eval()
        total_loss = 0.0
        all_preds = []
        all_labels = []
        
        with torch.no_grad():
            for batch in val_loader:
                # Concat dynamic features if needed
                keypoints = self._prepare_input(batch)
                keypoints = keypoints.to(self.device)
                labels = batch['label'].to(self.device)
                
                logits = self.model(keypoints)
                loss = self.criterion(logits, labels)
                
                total_loss += loss.item()
                preds = torch.argmax(logits, dim=1)
                all_preds.extend(preds.cpu().numpy())
                all_labels.extend(labels.cpu().numpy())
        
        avg_loss = total_loss / len(val_loader)
        acc = accuracy_score(all_labels, all_preds)
        
        return avg_loss, acc
    
    def train(self, train_loader, val_loader):
        """Train the model"""
        print(f"\nTraining Fold {self.fold_idx + 1}...")
        
        for epoch in range(self.config.epochs):
            # Train
            train_loss, train_acc = self.train_epoch(train_loader)
            
            # Validate
            val_loss, val_acc = self.validate(val_loader)
            
            # Save to history
            self.history['train_loss'].append(float(train_loss))
            self.history['train_acc'].append(float(train_acc))
            self.history['val_loss'].append(float(val_loss))
            self.history['val_acc'].append(float(val_acc))
            
            # Learning rate scheduling
            self.scheduler.step(val_acc)
            
            # Print progress
            if (epoch + 1) % 5 == 0 or epoch == 0:
                print(f"Epoch {epoch+1:3d}/{self.config.epochs} | "
                      f"Train Loss: {train_loss:.4f} Acc: {train_acc:.4f} | "
                      f"Val Loss: {val_loss:.4f} Acc: {val_acc:.4f}")
            
            # Save best model
            if val_acc > self.best_val_acc:
                self.best_val_acc = val_acc
                self.best_model_state = {k: v.cpu().clone() for k, v in self.model.state_dict().items()}
                self.epochs_no_improve = 0
            else:
                self.epochs_no_improve += 1
            
            # Early stopping
#             if self.epochs_no_improve >= self.config.early_stopping:
#                 print(f"Early stopping at epoch {epoch + 1}")
#                 break
        
        # Load best model
        if self.best_model_state is not None:
            self.model.load_state_dict({k: v.to(self.device) for k, v in self.best_model_state.items()})
        
        print(f"\nFold {self.fold_idx + 1} Training Complete!")
        print(f"Best Validation Accuracy: {self.best_val_acc:.4f}")
    
    def test(self, test_loader):
        """Test the model"""
        self.model.eval()
        all_preds = []
        all_labels = []
        
        with torch.no_grad():
            for batch in test_loader:
                # Concat dynamic features if needed
                keypoints = self._prepare_input(batch)
                keypoints = keypoints.to(self.device)
                labels = batch['label'].to(self.device)
                
                logits = self.model(keypoints)
                preds = torch.argmax(logits, dim=1)
                
                all_preds.extend(preds.cpu().numpy())
                all_labels.extend(labels.cpu().numpy())
        
        # Calculate metrics
        acc = accuracy_score(all_labels, all_preds)
        precision, recall, f1, _ = precision_recall_fscore_support(
            all_labels, all_preds, average='binary', zero_division=0
        )
        cm = confusion_matrix(all_labels, all_preds)
        
        results = {
            'accuracy': acc,
            'precision': precision,
            'recall': recall,
            'f1': f1,
            'confusion_matrix': cm,
            'predictions': all_preds,
            'labels': all_labels
        }
        
        print(f"\nFold {self.fold_idx + 1} Test Results:")
        print(f"  Accuracy:  {acc:.4f}")
        print(f"  Precision: {precision:.4f}")
        print(f"  Recall:    {recall:.4f}")
        print(f"  F1-Score:  {f1:.4f}")
        print(f"  Confusion Matrix:\n{cm}")
        
        return results


# ======================= MAIN K-FOLD TRAINER =======================

class KFoldTrainer:
    """Main trainer thực hiện K-Fold Cross-Validation"""
    
    def __init__(self, config: Config):
        self.config = config
        
        # Prepare data
        print(f"\n{'='*70}")
        print("PREPARING DATA FOR K-FOLD CROSS-VALIDATION")
        print(f"{'='*70}")
        
        # Build index
        self.entries = build_index(Path(config.data_root))
        print(f"Found {len(self.entries)} samples")
        
        # Create K-Fold splits
        self.folds = subject_wise_kfold_split(
            self.entries,
            n_splits=config.n_folds,
            seed=config.split_seed
        )
        
        # Results storage
        self.fold_results = []
    
    def run(self):
        """Run K-Fold Cross-Validation"""
        print(f"\n{'='*70}")
        print(f"STARTING {self.config.n_folds}-FOLD CROSS-VALIDATION")
        print(f"{'='*70}")
        
        for fold_idx, (train_indices, test_indices) in enumerate(self.folds):
            # Chia train thành train + validation (80/20)
            n_train = len(train_indices)
            n_val = int(n_train * 0.2)
            
            # Shuffle và chia
            rng = random.Random(self.config.seed)
            rng.shuffle(train_indices)
            
            val_indices = train_indices[:n_val]
            train_indices_final = train_indices[n_val:]
            
            # Create datasets
            train_dataset = Kinect2DNormalizedDataset(
                entries=self.entries,
                indices=train_indices_final,
                L=self.config.sequence_length,
                normalization=self.config.normalization,
                remove_head_neck=self.config.remove_head_neck,
                remove_fingers=self.config.remove_fingers,
                include_dynamics=self.config.include_dynamics,
                fps=self.config.fps,
                dynamic_features=self.config.dynamic_features
            )
            
            val_dataset = Kinect2DNormalizedDataset(
                entries=self.entries,
                indices=val_indices,
                L=self.config.sequence_length,
                normalization=self.config.normalization,
                remove_head_neck=self.config.remove_head_neck,
                remove_fingers=self.config.remove_fingers,
                include_dynamics=self.config.include_dynamics,
                fps=self.config.fps,
                dynamic_features=self.config.dynamic_features
            )
            
            test_dataset = Kinect2DNormalizedDataset(
                entries=self.entries,
                indices=test_indices,
                L=self.config.sequence_length,
                normalization=self.config.normalization,
                remove_head_neck=self.config.remove_head_neck,
                remove_fingers=self.config.remove_fingers,
                include_dynamics=self.config.include_dynamics,
                fps=self.config.fps,
                dynamic_features=self.config.dynamic_features
            )
            
            # Create data loaders
            train_loader = DataLoader(
                train_dataset,
                batch_size=self.config.batch_size,
                shuffle=True,
                num_workers=self.config.num_workers,
                collate_fn=collate_fixedlen,
                pin_memory=True
            )
            
            val_loader = DataLoader(
                val_dataset,
                batch_size=self.config.batch_size,
                shuffle=False,
                num_workers=self.config.num_workers,
                collate_fn=collate_fixedlen,
                pin_memory=True
            )
            
            test_loader = DataLoader(
                test_dataset,
                batch_size=self.config.batch_size,
                shuffle=False,
                num_workers=self.config.num_workers,
                collate_fn=collate_fixedlen,
                pin_memory=True
            )
            
            # Train fold
            fold_trainer = FoldTrainer(self.config, fold_idx)
            fold_trainer.train(train_loader, val_loader)
            
            # Test fold
            results = fold_trainer.test(test_loader)
            
            # Add training history to results
            results['history'] = fold_trainer.history
            
            self.fold_results.append(results)
        
        # Print summary
        self._print_summary()
        
        # Save results
        self._save_results()
    
    def _print_summary(self):
        """Print summary of all folds"""
        print(f"\n{'='*70}")
        print("K-FOLD CROSS-VALIDATION RESULTS SUMMARY")
        print(f"{'='*70}")
        
        accuracies = [r['accuracy'] for r in self.fold_results]
        precisions = [r['precision'] for r in self.fold_results]
        recalls = [r['recall'] for r in self.fold_results]
        f1s = [r['f1'] for r in self.fold_results]
        
        print(f"\nFold-wise Results:")
        for i, (acc, prec, rec, f1) in enumerate(zip(accuracies, precisions, recalls, f1s)):
            print(f"  Fold {i+1}: Acc={acc:.4f}, Prec={prec:.4f}, Rec={rec:.4f}, F1={f1:.4f}")
        
        print(f"\nAverage Results ({self.config.n_folds}-Fold CV):")
        print(f"  Accuracy:  {np.mean(accuracies):.4f} ± {np.std(accuracies):.4f}")
        print(f"  Precision: {np.mean(precisions):.4f} ± {np.std(precisions):.4f}")
        print(f"  Recall:    {np.mean(recalls):.4f} ± {np.std(recalls):.4f}")
        print(f"  F1-Score:  {np.mean(f1s):.4f} ± {np.std(f1s):.4f}")
        
        print(f"\n{'='*70}")
    
    def _save_results(self):
        """Save results to file"""
        save_dir = Path(self.config.save_dir) / 'kfold_results'
        save_dir.mkdir(parents=True, exist_ok=True)
        
        # Generate experiment name with timestamp
        exp_name = self.config._generate_exp_name()
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        exp_name_with_time = f"{exp_name}_seed{self.config.seed}_{timestamp}"
        
        # Save summary CSV
        results_df = pd.DataFrame({
            'Fold': list(range(1, self.config.n_folds + 1)),
            'Accuracy': [r['accuracy'] for r in self.fold_results],
            'Precision': [r['precision'] for r in self.fold_results],
            'Recall': [r['recall'] for r in self.fold_results],
            'F1-Score': [r['f1'] for r in self.fold_results]
        })
        
        # Add mean and std
        mean_row = {
            'Fold': 'Mean',
            'Accuracy': results_df['Accuracy'].mean(),
            'Precision': results_df['Precision'].mean(),
            'Recall': results_df['Recall'].mean(),
            'F1-Score': results_df['F1-Score'].mean()
        }
        std_row = {
            'Fold': 'Std',
            'Accuracy': results_df['Accuracy'].std(),
            'Precision': results_df['Precision'].std(),
            'Recall': results_df['Recall'].std(),
            'F1-Score': results_df['F1-Score'].std()
        }
        
        results_df = pd.concat([
            results_df,
            pd.DataFrame([mean_row]),
            pd.DataFrame([std_row])
        ], ignore_index=True)
        
        results_path = save_dir / f'{exp_name_with_time}_results.csv'
        results_df.to_csv(results_path, index=False)
        print(f"\nResults saved to: {results_path}")
        
        # Save training history for each fold
        history_data = {
            'config': {
                'normalization': self.config.normalization,
                'include_dynamics': self.config.include_dynamics,
                'dynamic_features': self.config.dynamic_features,
                'remove_head_neck': self.config.remove_head_neck,
                'remove_fingers': self.config.remove_fingers,
                'seed': self.config.seed,
                'n_folds': self.config.n_folds,
                'epochs': self.config.epochs,
                'batch_size': self.config.batch_size,
                'lr': self.config.lr
            },
            'folds': []
        }
        
        for fold_idx, result in enumerate(self.fold_results):
            fold_data = {
                'fold': fold_idx + 1,
                'test_accuracy': result['accuracy'],
                'test_precision': result['precision'],
                'test_recall': result['recall'],
                'test_f1': result['f1'],
                'history': result['history']
            }
            history_data['folds'].append(fold_data)
        
        history_path = save_dir / f'{exp_name_with_time}_history.json'
        with open(history_path, 'w') as f:
            json.dump(history_data, f, indent=2)
        print(f"Training history saved to: {history_path}")


# ======================= MAIN =======================

def main():
    """Main function"""
    args = parse_args()
    
    # Create config
    config = Config()
    
    # Update config from args
    for key, value in vars(args).items():
        if hasattr(config, key):
            setattr(config, key, value)
    
    # Add n_folds to config if not exists
    if not hasattr(config, 'n_folds'):
        config.n_folds = 5  # Default 5-fold
    
    # Special handling for tensorboard
    if args.no_tensorboard:
        config.use_tensorboard = False
    
    # Update experiment name
    config.update_exp_name()
    
    # Print config
    print("=" * 70)
    print("K-FOLD CROSS-VALIDATION CONFIGURATION")
    print("=" * 70)
    for key, value in config.to_dict().items():
        print(f"{key}: {value}")
    print(f"n_folds: {config.n_folds}")
    print("=" * 70)
    
    # Create trainer
    kfold_trainer = KFoldTrainer(config)
    
    # Run K-Fold CV
    kfold_trainer.run()

# Test
if __name__ == '__main__':
  sys.argv = [
    'train_srm_k_fold.py',
    '--normalization', 'original',
    '--save_dir', 'Training_logs/experiments_SRM_SpineBase_KFold',
    '--no_dynamics',
    '--dropout', '0.3',
    '--seed', '41'
]
  main()