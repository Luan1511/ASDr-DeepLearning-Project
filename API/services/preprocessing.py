"""Temporal Imputation and Outlier Filtering for Skeleton Keypoint Sequences.

Addresses common OpenPose extraction artifacts:
1. Sudden joint jumping / flicker / limb-swap (outlier spikes where a keypoint
   violates biological velocity limits for 1-2 frames then bounces back).
2. Missing keypoints (temporarily dropping to (0,0) or low confidence for <= max_gap frames).
3. Trajectory smoothing (temporal median filtering to eliminate jitter).
"""

from typing import Dict, Optional, Tuple
import numpy as np


def estimate_body_scale(
    seq_xy: np.ndarray,
    neck_idx: int = 1,
    mid_hip_idx: int = 8,
) -> float:
    """Estimates characteristic body scale (torso length) from keypoints.

    Uses the median distance between neck and mid-hip across valid frames.
    Falls back to median bounding box diagonal if neck/hip are unavailable.
    """
    T, J, _ = seq_xy.shape
    torso_lengths = []

    if neck_idx < J and mid_hip_idx < J:
        for t in range(T):
            p_neck = seq_xy[t, neck_idx]
            p_hip = seq_xy[t, mid_hip_idx]
            if (
                np.isfinite(p_neck).all()
                and np.isfinite(p_hip).all()
                and not (p_neck[0] == 0.0 and p_neck[1] == 0.0)
                and not (p_hip[0] == 0.0 and p_hip[1] == 0.0)
            ):
                dist = float(np.linalg.norm(p_neck - p_hip))
                if dist > 5.0:  # non-trivial distance
                    torso_lengths.append(dist)

    if torso_lengths:
        return float(np.median(torso_lengths))

    # Fallback: estimate from bounding box of all valid joints per frame
    bbox_diags = []
    for t in range(T):
        valid = (seq_xy[t, :, 0] != 0.0) | (seq_xy[t, :, 1] != 0.0)
        if np.sum(valid) >= 4:
            pts = seq_xy[t, valid]
            xmin, ymin = np.min(pts, axis=0)
            xmax, ymax = np.max(pts, axis=0)
            diag = float(np.hypot(xmax - xmin, ymax - ymin))
            if diag > 10.0:
                bbox_diags.append(diag * 0.4)  # approx torso fraction

    if bbox_diags:
        return float(np.median(bbox_diags))

    return 100.0  # sensible default pixel scale if completely untracked


def reject_outlier_spikes(
    seq_xy: np.ndarray,
    max_displacement_ratio: float = 0.35,
    confidences: Optional[np.ndarray] = None,
    low_conf_threshold: float = 0.15,
) -> Tuple[np.ndarray, np.ndarray]:
    """Detects and zeros out unnatural outlier spikes (joints jumping far away for 1-2 frames).

    A point P[t, j] is marked as a spike if:
      - The displacement ||P[t] - P[t-1]|| exceeds max_displacement_ratio * torso_scale.
      - AND ||P[t] - P[t+1]|| also exceeds that threshold.
      - AND ||P[t+1] - P[t-1]|| is small (joint returns back near where it started).
      - OR detection confidence is below low_conf_threshold.

    Args:
        seq_xy: Shape (T, J, 2) or (T, J, C).
        max_displacement_ratio: Fraction of torso length allowed per frame (default 0.35).
        confidences: Optional shape (T, J) array of confidence scores.
        low_conf_threshold: Below this, a point with suspicious movement is suppressed.

    Returns:
        Tuple[np.ndarray, np.ndarray]: Cleaned seq_xy (spikes set to 0.0), and boolean spike_mask.
    """
    T, J, C = seq_xy.shape
    if T <= 2:
        return seq_xy.copy(), np.zeros((T, J), dtype=bool)

    out = np.array(seq_xy, dtype=np.float32, copy=True)
    out[~np.isfinite(out)] = 0.0
    spike_mask = np.zeros((T, J), dtype=bool)

    torso_scale = estimate_body_scale(out)
    threshold = max(10.0, float(max_displacement_ratio * torso_scale))

    for j in range(J):
        # 1-frame spikes: t is spike between t-1 and t+1
        for t in range(1, T - 1):
            p_prev = out[t - 1, j, :2]
            p_curr = out[t, j, :2]
            p_next = out[t + 1, j, :2]

            # All three must be non-zero
            if (p_prev == 0.0).all() or (p_curr == 0.0).all() or (p_next == 0.0).all():
                continue

            d_prev = float(np.linalg.norm(p_curr - p_prev))
            d_next = float(np.linalg.norm(p_curr - p_next))
            d_base = float(np.linalg.norm(p_next - p_prev))

            # Spike condition: sharp detours returning back
            is_spike = (
                (d_prev > threshold and d_next > threshold and (d_prev + d_next) > 1.8 * d_base)
                or (d_prev > 1.5 * threshold and d_base < 0.6 * threshold)
            )

            # If confidence is available and low, even moderate jumps are flagged
            if not is_spike and confidences is not None:
                c_val = float(confidences[t, j])
                if c_val < low_conf_threshold and (d_prev > 0.6 * threshold or d_next > 0.6 * threshold):
                    is_spike = True

            if is_spike:
                spike_mask[t, j] = True
                out[t, j, :] = 0.0

        # 2-frame spikes: frames t and t+1 jump together and return at t+2
        for t in range(1, T - 2):
            p_prev = out[t - 1, j, :2]
            p_1 = out[t, j, :2]
            p_2 = out[t + 1, j, :2]
            p_next = out[t + 2, j, :2]

            if (
                (p_prev == 0.0).all()
                or (p_1 == 0.0).all()
                or (p_2 == 0.0).all()
                or (p_next == 0.0).all()
            ):
                continue

            d_in = float(np.linalg.norm(p_1 - p_prev))
            d_out = float(np.linalg.norm(p_next - p_2))
            d_base = float(np.linalg.norm(p_next - p_prev))

            if d_in > threshold and d_out > threshold and d_base < 0.8 * threshold:
                spike_mask[t, j] = True
                spike_mask[t + 1, j] = True
                out[t, j, :] = 0.0
                out[t + 1, j, :] = 0.0

    return out, spike_mask


def impute_missing_keypoints(
    seq_xy: np.ndarray,
    max_gap: int = 5,
    method: str = "linear",
    confidences: Optional[np.ndarray] = None,
    min_confidence: float = 0.05,
) -> np.ndarray:
    """Imputes missing keypoints across the temporal dimension (T).

    A keypoint at frame t is considered missing if:
      - x == 0.0 and y == 0.0 (OpenPose convention for unobserved joints)
      - or coordinates are NaN / Inf
      - or confidence is provided and < min_confidence.

    If a missing interval has length 1 <= gap_len <= max_gap and is bounded by
    valid keypoints both before and after, the missing frames are filled using
    temporal interpolation ('linear' or 'cubic' / 'pchip'). Gaps longer than
    max_gap or missing at the outer boundaries (start/end) are left unchanged to
    avoid hallucinated motion during prolonged occlusions.
    """
    if seq_xy.ndim != 3:
        raise ValueError(f"Expected seq_xy with shape (T, J, C), got ndim={seq_xy.ndim}")

    T, J, C = seq_xy.shape
    if T <= 2:
        return seq_xy.copy()

    out = np.array(seq_xy, dtype=np.float32, copy=True)
    out[~np.isfinite(out)] = 0.0

    is_zero = (out[..., 0] == 0.0) & (out[..., 1] == 0.0)
    valid_mask = ~is_zero

    if confidences is not None and confidences.shape[:2] == (T, J):
        valid_mask &= (confidences >= min_confidence) & np.isfinite(confidences)

    cubic_interpolator_cls = None
    if method in ("cubic", "spline", "pchip"):
        try:
            from scipy.interpolate import PchipInterpolator, CubicSpline
            cubic_interpolator_cls = PchipInterpolator if method == "pchip" else CubicSpline
        except ImportError:
            cubic_interpolator_cls = None

    for j in range(J):
        v = valid_mask[:, j]
        valid_indices = np.where(v)[0]

        if len(valid_indices) < 2:
            continue

        missing_runs = []
        in_run = False
        start_idx = 0

        for t in range(T):
            if not v[t]:
                if not in_run:
                    in_run = True
                    start_idx = t
            else:
                if in_run:
                    missing_runs.append((start_idx, t - 1))
                    in_run = False
        if in_run:
            missing_runs.append((start_idx, T - 1))

        for t_start, t_end in missing_runs:
            gap_len = t_end - t_start + 1

            if gap_len > max_gap:
                continue
            if t_start == 0 or t_end == T - 1:
                continue

            t_prev = t_start - 1
            t_next = t_end + 1

            gap_times = np.arange(t_start, t_end + 1, dtype=np.float32)

            if method == "linear" or cubic_interpolator_cls is None or len(valid_indices) < 4:
                alpha = (gap_times - t_prev) / float(t_next - t_prev)
                for c in range(C):
                    val_prev = out[t_prev, j, c]
                    val_next = out[t_next, j, c]
                    out[t_start : t_end + 1, j, c] = val_prev + alpha * (val_next - val_prev)
            else:
                try:
                    for c in range(C):
                        cs = cubic_interpolator_cls(valid_indices, out[valid_indices, j, c])
                        out[t_start : t_end + 1, j, c] = cs(gap_times)
                except Exception:
                    alpha = (gap_times - t_prev) / float(t_next - t_prev)
                    for c in range(C):
                        val_prev = out[t_prev, j, c]
                        val_next = out[t_next, j, c]
                        out[t_start : t_end + 1, j, c] = val_prev + alpha * (val_next - val_prev)

    return out


def temporal_median_filter(
    seq_xy: np.ndarray,
    window_size: int = 3,
) -> np.ndarray:
    """Applies a 1D temporal median filter to suppress high-frequency jitter.

    Preserves monotonic motion trends (e.g. steady limb swing) while removing
    residual single-frame noise spikes. Ignores unobserved (0, 0) frames.
    """
    T, J, C = seq_xy.shape
    if T < window_size or window_size <= 1:
        return seq_xy.copy()

    out = np.array(seq_xy, dtype=np.float32, copy=True)
    half = window_size // 2

    for j in range(J):
        valid = (out[:, j, 0] != 0.0) | (out[:, j, 1] != 0.0)
        for t in range(half, T - half):
            # Only smooth if the current point and neighbours are valid
            window_valid = valid[t - half : t + half + 1]
            if np.all(window_valid):
                for c in range(C):
                    out[t, j, c] = float(np.median(seq_xy[t - half : t + half + 1, j, c]))

    return out


def preprocess_skeleton_sequence(
    seq_xy: np.ndarray,
    confidences: Optional[np.ndarray] = None,
    max_gap: int = 5,
    max_displacement_ratio: float = 0.35,
    method: str = "linear",
    apply_median_filter: bool = True,
) -> np.ndarray:
    """Unified skeleton preprocessing pipeline:

    1. Outlier Rejection: Identifies physically impossible jump spikes (limb swaps,
       glitches) and marks them as missing.
    2. Temporal Imputation: Interpolates short missing gaps (<= max_gap frames).
    3. Trajectory Smoothing: 3-frame median filter to remove high-frequency jitter.

    Args:
        seq_xy: Shape (T, J, C) where C >= 2.
        confidences: Optional shape (T, J) array of confidence scores.
        max_gap: Maximum missing frames to interpolate (default 5).
        max_displacement_ratio: Outlier jump threshold as fraction of torso scale (default 0.35).
        method: Interpolation mode ('linear' or 'cubic').
        apply_median_filter: Whether to run 3-frame temporal median filter (default True).

    Returns:
        np.ndarray: Cleaned, continuous skeleton sequence ready for ST-GCN inference.
    """
    if seq_xy.shape[0] == 0:
        return seq_xy

    # Step 1: Reject unnatural outlier spikes
    cleaned, _ = reject_outlier_spikes(
        seq_xy,
        max_displacement_ratio=max_displacement_ratio,
        confidences=confidences,
    )

    # Step 2: Impute missing frames and suppressed outliers
    imputed = impute_missing_keypoints(
        cleaned,
        max_gap=max_gap,
        method=method,
        confidences=confidences,
    )

    # Step 3: Temporal median filtering
    if apply_median_filter:
        imputed = temporal_median_filter(imputed, window_size=3)

    return imputed


def get_imputation_stats(
    raw_seq: np.ndarray,
    imputed_seq: np.ndarray,
) -> Dict[str, int]:
    """Calculates statistics on how many joint coordinates were recovered."""
    raw_missing = (raw_seq[..., 0] == 0.0) & (raw_seq[..., 1] == 0.0)
    imputed_missing = (imputed_seq[..., 0] == 0.0) & (imputed_seq[..., 1] == 0.0)
    recovered = raw_missing & (~imputed_missing)

    return {
        "raw_missing_joint_frames": int(np.sum(raw_missing)),
        "recovered_joint_frames": int(np.sum(recovered)),
        "remaining_missing_joint_frames": int(np.sum(imputed_missing)),
    }
