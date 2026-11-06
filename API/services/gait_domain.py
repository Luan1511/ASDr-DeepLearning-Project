#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tiền xử lý "domain v2": MỘT pipeline cho cả Kinect (lúc train) và video OpenPose (server).

Vì sao: train và server từng xử lý khác nhau (train: chuẩn hoá → kéo cả clip ~35 frame lên
128 → gia tốc với fps=30 trên chuỗi đã kéo; server: resample nearest → chuẩn hoá → gia tốc),
và hai nguồn lệch về quy ước khớp, thang thời gian, khớp mất, nhiễu (master_prompt §22.6).
File này phải GIỐNG HỆT ở hai nơi:

  NCKH_25-26/gait_domain.py                      (script train, cv_stgcn.py)
  Main/API/services/gait_domain.py               (ML server)

Các bước (đều trên 17 khớp KINECT17, quy ước trái/phải như OpenPose — khớp trái của trẻ
nằm bên PHẢI ảnh khi trẻ đi về phía camera):

  1. Đưa về cùng quy ước khớp: Kinect 2D lật gương + định nghĩa khớp kiểu OpenPose
     (`kinect2d_align`); OpenPose BODY_25 → 17 khớp + mặt nạ hợp lệ (`openpose25_to_17`).
     Skeleton từ camera ảo (virtual_camera.py) đã đúng quy ước → không cần bước này.
  2. Loại frame/khớp bất thường (thân dài/ngắn bất thường, khớp quá xa hông), rồi nội suy
     khớp mất theo thời gian (không giữ (0,0)).
  3. Resample về `target_fps` theo thời gian thật.
  4. Làm mượt Gauss như nhau cho hai nguồn.
  5. Chuẩn hoá theo thân: gốc SpineBase từng frame, chia cho chiều dài thân làm mượt theo
     thời gian (~0,5 s) → bỏ đơn vị pixel và việc người to dần khi lại gần camera.
  6. Vận tốc / gia tốc trên chuỗi 30 fps thật (đơn vị: chiều dài thân / giây).
  7. Cắt cửa sổ cố định `window` frame (không kéo giãn clip dài); clip ngắn hơn cửa sổ
     mới kéo giãn tuyến tính lên đủ cửa sổ.

Chỉ phụ thuộc numpy.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

VERSION = "domain-v2.2"

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
    "FootLeft", "FootRight",
]
# Cùng thứ tự với KINECT17_REDUCED của script train và Graph(layout="kinect17")
KINECT17 = [
    "Head", "SpineShoulder",
    "ShoulderLeft", "ShoulderRight",
    "ElbowLeft", "ElbowRight",
    "WristLeft", "WristRight",
    "SpineBase",
    "HipLeft", "HipRight",
    "KneeLeft", "KneeRight",
    "AnkleLeft", "AnkleRight",
    "FootLeft", "FootRight",
]
J17 = {n: i for i, n in enumerate(KINECT17)}
SPINE_BASE = J17["SpineBase"]
SPINE_SHOULDER = J17["SpineShoulder"]
LR_PAIRS = [(J17[f"{n}Left"], J17[f"{n}Right"])
            for n in ("Shoulder", "Elbow", "Wrist", "Hip", "Knee", "Ankle", "Foot")]
KINECT25_TO_17 = [KINECT25.index(n) for n in KINECT17]

# BODY_25
OP = {"Nose": 0, "Neck": 1, "RShoulder": 2, "RElbow": 3, "RWrist": 4, "LShoulder": 5, "LElbow": 6,
      "LWrist": 7, "MidHip": 8, "RHip": 9, "RKnee": 10, "RAnkle": 11, "LHip": 12, "LKnee": 13,
      "LAnkle": 14, "LBigToe": 19, "LHeel": 21, "RBigToe": 22, "RHeel": 24}
_OP_FOR_17 = {
    "Head": ["Nose"], "SpineShoulder": ["Neck"],
    "ShoulderLeft": ["LShoulder"], "ShoulderRight": ["RShoulder"],
    "ElbowLeft": ["LElbow"], "ElbowRight": ["RElbow"],
    "WristLeft": ["LWrist"], "WristRight": ["RWrist"],
    "SpineBase": ["MidHip"], "HipLeft": ["LHip"], "HipRight": ["RHip"],
    "KneeLeft": ["LKnee"], "KneeRight": ["RKnee"],
    "AnkleLeft": ["LAnkle"], "AnkleRight": ["RAnkle"],
    # bàn chân: ngón cái → gót → cổ chân, chọn TỪNG frame
    "FootLeft": ["LBigToe", "LHeel", "LAnkle"], "FootRight": ["RBigToe", "RHeel", "RAnkle"],
}

DYNAMIC_FEATURES = ("velocity", "acceleration")


@dataclass
class DomainV2Config:
    target_fps: float = 30.0
    window: int = 32              # frame ở target_fps (~1,07 s ≈ 1 chu kỳ bước)
    smooth_sigma: float = 1.0     # độ lệch chuẩn Gauss, tính bằng frame ở target_fps; 0 = tắt
    kinect_hip_width: float = 1.4  # nới hông Kinect 2D cho giống OpenPose (§22.6)
    scale_smooth_s: float = 0.5   # chiều dài thân làm mượt theo thời gian (giây); 0 = một hệ số cả clip
    min_conf: float = 0.05        # OpenPose: khớp có confidence thấp hơn coi như mất
    dynamic_features: Tuple[str, ...] = ()
    version: str = VERSION

    def __post_init__(self):
        self.dynamic_features = tuple(self.dynamic_features or ())
        bad = [f for f in self.dynamic_features if f not in DYNAMIC_FEATURES]
        if bad:
            raise ValueError(f"domain v2 chỉ hỗ trợ {DYNAMIC_FEATURES}, nhận {bad}")
        if self.window < 8:
            raise ValueError("window phải ≥ 8 frame")

    @property
    def channels(self) -> int:
        return 2 + 2 * len(self.dynamic_features)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["dynamic_features"] = list(self.dynamic_features)
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "DomainV2Config":
        known = {k: v for k, v in (d or {}).items() if k in cls.__dataclass_fields__}
        return cls(**known)


# ============================================================ 1. quy ước khớp

def select17(seq25: np.ndarray) -> np.ndarray:
    """(T, 25, C) thứ tự KINECT25 → (T, 17, C) thứ tự KINECT17."""
    return seq25[:, KINECT25_TO_17]


def kinect2d_align(seq17: np.ndarray, valid: Optional[np.ndarray] = None,
                   hip_width: float = 1.4) -> np.ndarray:
    """File 2D Kinect → cùng quy ước với OpenPose.

    - Lật gương (x → −x): ảnh 2D Kinect là ảnh gương, khớp "Left" nằm bên trái ảnh.
      Chỉ đổi dấu; gốc toạ độ không quan trọng vì sau đó chuẩn hoá theo SpineBase.
    - SpineShoulder := trung điểm hai vai (OpenPose Neck).
    - Hông nới `hip_width` lần quanh trung điểm; SpineBase := trung điểm hông (OpenPose MidHip).
    Khớp không hợp lệ (valid False) giữ nguyên để bước nội suy xử lý.
    """
    s = np.asarray(seq17, dtype=np.float64).copy()
    s[..., 0] = -s[..., 0]
    v = np.ones(s.shape[:2], bool) if valid is None else np.asarray(valid, bool)

    sl, sr = J17["ShoulderLeft"], J17["ShoulderRight"]
    ok = v[:, sl] & v[:, sr]
    s[ok, SPINE_SHOULDER] = 0.5 * (s[ok, sl] + s[ok, sr])

    hl, hr = J17["HipLeft"], J17["HipRight"]
    ok = v[:, hl] & v[:, hr]
    mid = 0.5 * (s[ok, hl] + s[ok, hr])
    s[ok, hl] = mid + hip_width * (s[ok, hl] - mid)
    s[ok, hr] = mid + hip_width * (s[ok, hr] - mid)
    s[ok, SPINE_BASE] = mid
    return s


def openpose25_to_17(xy25: np.ndarray, conf25: Optional[np.ndarray] = None,
                     min_conf: float = 0.05) -> Tuple[np.ndarray, np.ndarray]:
    """BODY_25 (T, 25, 2) [+ confidence (T, 25)] → (T, 17, 2) và mặt nạ hợp lệ (T, 17).

    Khớp hợp lệ khi khác (0, 0) và confidence ≥ min_conf (nếu có confidence).
    """
    xy25 = np.asarray(xy25, dtype=np.float64)
    T = xy25.shape[0]
    ok25 = np.any(xy25 != 0, axis=-1)
    if conf25 is not None:
        ok25 &= np.asarray(conf25) >= min_conf
    out = np.zeros((T, 17, 2))
    valid = np.zeros((T, 17), bool)
    for j, name in enumerate(KINECT17):
        for src in reversed(_OP_FOR_17[name]):  # nguồn ưu tiên cao nhất ghi sau cùng
            m = ok25[:, OP[src]]
            out[m, j] = xy25[m, OP[src]]
            valid[:, j] |= m
    # Cùng định nghĩa với kinect2d_align: thân = trung điểm vai / hông khi thấy đủ hai bên
    for mid_j, (a, b) in ((SPINE_SHOULDER, ("ShoulderLeft", "ShoulderRight")),
                          (SPINE_BASE, ("HipLeft", "HipRight"))):
        ok = valid[:, J17[a]] & valid[:, J17[b]]
        out[ok, mid_j] = 0.5 * (out[ok, J17[a]] + out[ok, J17[b]])
        valid[:, mid_j] |= ok
    return out, valid


def mirror(seq17: np.ndarray) -> np.ndarray:
    """Augmentation lật gương hợp lệ về giải phẫu: x → −x VÀ đổi nhãn trái/phải."""
    s = np.asarray(seq17).copy()
    s[..., 0] = -s[..., 0]
    for a, b in LR_PAIRS:
        s[:, [a, b]] = s[:, [b, a]]
    return s


# ============================================================ 2–6. làm sạch, thời gian, chuẩn hoá

def reject_outliers(seq: np.ndarray, valid: np.ndarray, trunk_ratio: float = 2.0,
                    max_reach: float = 5.0) -> np.ndarray:
    """Đánh dấu không hợp lệ: (a) cả frame khi chiều dài thân lệch quá `trunk_ratio` lần so với
    trung vị clip; (b) khớp nằm xa SpineBase hơn `max_reach` lần chiều dài thân trung vị.

    Bắt được frame hỏng trong file Kinect 3D (chiếu ra thân dài hàng chục nghìn pixel) và
    khớp OpenPose nhận nhầm. Trả về mặt nạ mới; toạ độ giữ nguyên để fill_missing nội suy.
    """
    v = np.asarray(valid, bool).copy()
    both = v[:, SPINE_BASE] & v[:, SPINE_SHOULDER]
    if not both.any():
        return v
    trunk = np.linalg.norm(seq[:, SPINE_SHOULDER] - seq[:, SPINE_BASE], axis=-1)
    med = float(np.median(trunk[both]))
    if med < 1e-6:
        return v
    bad = both & ((trunk > trunk_ratio * med) | (trunk < med / trunk_ratio))
    v[bad] = False
    reach = np.linalg.norm(seq - seq[:, SPINE_BASE:SPINE_BASE + 1], axis=-1)
    v &= ~((reach > max_reach * med) & v[:, SPINE_BASE:SPINE_BASE + 1])
    return v


def fill_missing(seq: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Nội suy tuyến tính theo thời gian cho khớp mất; hai đầu giữ giá trị gần nhất.

    Khớp không lúc nào hợp lệ → lấy vị trí SpineBase (nếu SpineBase cũng không có → lỗi).
    """
    s = np.asarray(seq, dtype=np.float64).copy()
    v = np.asarray(valid, bool)
    T, J = v.shape
    t = np.arange(T)
    never = []
    for j in range(J):
        m = v[:, j]
        if m.all():
            continue
        if not m.any():
            never.append(j)
            continue
        for c in range(s.shape[2]):
            s[:, j, c] = np.interp(t, t[m], s[m, j, c])
    if never:
        if SPINE_BASE in never:
            raise ValueError("không có frame nào thấy SpineBase (hông)")
        for j in never:
            s[:, j] = s[:, SPINE_BASE]
    return s


def resample_fps(seq: np.ndarray, src_fps: float, dst_fps: float) -> np.ndarray:
    """Resample tuyến tính theo thời gian thật. (T, ...) → (T', ...), T' ≈ T·dst/src."""
    if src_fps <= 0 or dst_fps <= 0:
        raise ValueError("fps phải > 0")
    T = seq.shape[0]
    if T < 2 or abs(src_fps - dst_fps) < 1e-6:
        return np.asarray(seq, dtype=np.float64)
    t_src = np.arange(T) / src_fps
    t_dst = np.arange(0.0, t_src[-1] + 1e-9, 1.0 / dst_fps)
    flat = np.asarray(seq, dtype=np.float64).reshape(T, -1)
    out = np.stack([np.interp(t_dst, t_src, flat[:, k]) for k in range(flat.shape[1])], axis=1)
    return out.reshape((len(t_dst),) + seq.shape[1:])


def smooth(seq: np.ndarray, sigma: float, pad: str = "edge") -> np.ndarray:
    """Lọc Gauss theo thời gian.

    pad='edge': biên lặp giá trị đầu/cuối. pad='odd': phản xạ lẻ quanh điểm đầu/cuối
    (2·x0 − x[k]) — giữ nguyên xu hướng tuyến tính ở hai đầu clip (dùng cho chiều dài thân
    khi trẻ lại gần camera); bán kính bị giới hạn ở T − 1.
    """
    if sigma <= 0 or seq.shape[0] < 2:
        return np.asarray(seq, dtype=np.float64)
    T = seq.shape[0]
    r = max(1, int(round(3 * sigma)))
    if pad == "odd":
        r = min(r, T - 1)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    flat = np.asarray(seq, dtype=np.float64).reshape(T, -1)
    if pad == "odd":
        padded = np.concatenate([2 * flat[:1] - flat[r:0:-1], flat, 2 * flat[-1:] - flat[-2:-r - 2:-1]])
    elif pad == "edge":
        padded = np.concatenate([np.repeat(flat[:1], r, 0), flat, np.repeat(flat[-1:], r, 0)])
    else:
        raise ValueError(f"pad không hợp lệ: {pad!r}")
    out = np.stack([np.convolve(padded[:, c], k, mode="valid") for c in range(flat.shape[1])], axis=1)
    return out.reshape(seq.shape)


def body_normalize(seq17: np.ndarray, scale_sigma: float = 0.0) -> Tuple[np.ndarray, float]:
    """Gốc SpineBase từng frame; chia cho chiều dài thân (SpineBase–SpineShoulder).

    scale_sigma = 0: một hệ số cho cả clip (trung vị). scale_sigma > 0 (frame): chiều dài thân
    làm mượt Gauss theo thời gian, bỏ việc người to dần khi đi lại gần camera nhưng giữ dao động
    trong từng bước (chu kỳ ~1 s ≫ sigma ~0,5 s không bị san phẳng hoàn toàn chỉ vì thân gần như
    không đổi độ dài trong một bước). Trả về (chuỗi, chiều dài thân trung vị).
    """
    rel = seq17 - seq17[:, SPINE_BASE:SPINE_BASE + 1]
    trunk_t = np.linalg.norm(rel[:, SPINE_SHOULDER], axis=-1)
    trunk = float(np.median(trunk_t))
    if not np.isfinite(trunk) or trunk < 1e-6:
        raise ValueError("chiều dài thân bằng 0 (thiếu vai/hông)")
    if scale_sigma <= 0:
        return rel / trunk, trunk
    # kẹp quanh trung vị trước khi làm mượt: một frame lệch không kéo cả đoạn
    scale = smooth(np.clip(trunk_t, 0.5 * trunk, 2.0 * trunk)[:, None], scale_sigma, pad="odd")[:, 0]
    scale = np.maximum(scale, 0.25 * trunk)  # phản xạ lẻ có thể vọt ở mép khi đầu clip nhiễu
    return rel / scale[:, None, None], trunk


def dynamics(seq: np.ndarray, fps: float, features: Sequence[str]) -> List[np.ndarray]:
    """Vận tốc / gia tốc (sai phân trung tâm) theo đơn vị thời gian thật."""
    out = []
    if not features:
        return out
    dt = 1.0 / fps
    vel = np.gradient(seq, dt, axis=0) if seq.shape[0] > 1 else np.zeros_like(seq)
    if "velocity" in features:
        out.append(vel)
    if "acceleration" in features:
        out.append(np.gradient(vel, dt, axis=0) if seq.shape[0] > 1 else np.zeros_like(seq))
    return out


# ============================================================ pipeline + cửa sổ

def prepare_clip(seq17: np.ndarray, valid: Optional[np.ndarray], fps: float,
                 cfg: DomainV2Config) -> Tuple[np.ndarray, Dict[str, float]]:
    """(T, 17, 2) cùng quy ước OpenPose → đặc trưng (T', 17, C) ở cfg.target_fps.

    C = 2 (x, y) + 2 cho mỗi đặc trưng động, theo thứ tự [xy, velocity, acceleration].
    """
    seq17 = np.asarray(seq17, dtype=np.float64)
    if seq17.ndim != 3 or seq17.shape[1:] != (17, 2):
        raise ValueError(f"cần (T, 17, 2), nhận {seq17.shape}")
    v = np.ones(seq17.shape[:2], bool) if valid is None else np.asarray(valid, bool)
    missing_frac = float(1.0 - v.mean()) if v.size else 1.0
    v2 = reject_outliers(seq17, v)
    rejected_frac = float((v & ~v2).mean()) if v.size else 0.0
    s = fill_missing(seq17, v2)
    # Thân luôn là trung điểm vai / hông cho MỌI nguồn (Kinect, camera ảo, OpenPose):
    # nhiễu của hai khớp này đến từ vai/hông, không phải nhiễu riêng
    s[:, SPINE_SHOULDER] = 0.5 * (s[:, J17["ShoulderLeft"]] + s[:, J17["ShoulderRight"]])
    s[:, SPINE_BASE] = 0.5 * (s[:, J17["HipLeft"]] + s[:, J17["HipRight"]])
    s = resample_fps(s, fps, cfg.target_fps)
    s = smooth(s, cfg.smooth_sigma)
    s, trunk = body_normalize(s, cfg.scale_smooth_s * cfg.target_fps)
    feat = np.concatenate([s] + dynamics(s, cfg.target_fps, cfg.dynamic_features), axis=-1)
    return feat.astype(np.float32), {"missing_frac": missing_frac, "rejected_frac": rejected_frac,
                                     "trunk_px": trunk, "frames_prepared": int(feat.shape[0])}


def fit_window(feat: np.ndarray, window: int) -> np.ndarray:
    """Clip ngắn hơn cửa sổ → kéo giãn tuyến tính lên đúng `window` frame; đủ dài thì giữ nguyên."""
    T = feat.shape[0]
    if T >= window:
        return feat
    if T < 2:
        return np.repeat(feat[:1], window, axis=0)
    t_old, t_new = np.linspace(0, 1, T), np.linspace(0, 1, window)
    flat = feat.reshape(T, -1)
    out = np.stack([np.interp(t_new, t_old, flat[:, k]) for k in range(flat.shape[1])], axis=1)
    return out.reshape((window,) + feat.shape[1:]).astype(feat.dtype)


def window_starts(T: int, window: int, stride: int) -> List[int]:
    """Điểm bắt đầu các cửa sổ phủ hết chuỗi (cửa sổ cuối khớp mép phải)."""
    if T <= window:
        return [0]
    starts = list(range(0, T - window + 1, max(1, stride)))
    if starts[-1] != T - window:
        starts.append(T - window)
    return starts


def crop(feat: np.ndarray, window: int, start: Optional[int] = None) -> np.ndarray:
    """Một cửa sổ `window` frame; start=None → giữa clip."""
    feat = fit_window(feat, window)
    T = feat.shape[0]
    if start is None:
        start = (T - window) // 2
    start = int(min(max(start, 0), T - window))
    return feat[start:start + window]
