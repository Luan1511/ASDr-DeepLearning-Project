"""ST-GCN inference on OpenPose BODY_25 API frames.

Pipeline (one video -> one probability):

1. Track the walking child across frames (greedy nearest-neighbour tracking,
   normalised by body size) and keep ONE identity for the whole clip. Frames
   where that person is not detected stay in the sequence as all-zero rows,
   so timing is preserved and short gaps can be imputed.
2. Clean the trajectories once, using OpenPose confidences
   (services.preprocessing: spike rejection, short-gap imputation, median).
3. Report a data-quality summary; refuse clips with too few usable frames.
4. Feed the whole clip (default) or fixed-length sliding windows to
   openpose_excel_stgcn_pipeline._predict_sequence, which mirrors the
   fine-tune preprocessing of the deployed checkpoint (nearest resample ->
   normalisation -> dynamics). Window logits are averaged.

Checkpoints whose config carries ``domain_v2`` (trained with --domain-v2) skip
steps 2 and 4 and use services/gait_domain.py instead, the SAME file the
training script imports: OpenPose -> 17 joints with a validity mask, gap
interpolation, resampling to 30 fps using the video's real fps, Gaussian
smoothing, body-length normalisation, dynamics per second, then fixed-length
windows (stride = half a window) whose logits are averaged.
"""

from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
import torch

from services import gait_domain as gd
from services.preprocessing import preprocess_skeleton_sequence
from openpose_excel_stgcn_pipeline import (
    _load_stgcn_from_checkpoint,
    _predict_one,
    _predict_sequence,
)

FPS_FALLBACK = 30.0

NUM_BODY25 = 25
OP_NECK = 1
OP_MID_HIP = 8
# Hips, knees, ankles, heels and toes: the joints a gait model actually needs.
LOWER_BODY_JOINTS = (9, 10, 11, 12, 13, 14, 19, 20, 21, 22, 23, 24)


class TrackCandidate:
    """One detected person in one frame, with the summary numbers tracking needs."""

    __slots__ = ("frame", "xy", "conf", "center", "scale", "mean_conf", "n_valid", "lower_body")

    def __init__(self, frame: int, xy: np.ndarray, conf: np.ndarray, min_joint_conf: float):
        self.frame = frame
        self.xy = xy
        self.conf = conf
        valid = (conf >= min_joint_conf) & ((xy[:, 0] != 0.0) | (xy[:, 1] != 0.0))
        self.n_valid = int(valid.sum())
        self.mean_conf = float(conf[valid].mean()) if self.n_valid else 0.0
        self.lower_body = float(valid[list(LOWER_BODY_JOINTS)].mean())
        if self.n_valid:
            pts = xy[valid]
            self.center = pts.mean(axis=0)
            neck, hip = xy[OP_NECK], xy[OP_MID_HIP]
            torso = float(np.linalg.norm(neck - hip)) if valid[OP_NECK] and valid[OP_MID_HIP] else 0.0
            if torso <= 1.0:
                span = pts.max(axis=0) - pts.min(axis=0)
                torso = 0.4 * float(np.hypot(span[0], span[1]))
            self.scale = max(torso, 1.0)
        else:
            self.center = np.zeros(2, dtype=np.float32)
            self.scale = 1.0


class Track:
    __slots__ = ("candidates", "last", "track_id")

    def __init__(self, track_id: int, first: TrackCandidate):
        self.track_id = track_id
        self.candidates: List[TrackCandidate] = [first]
        self.last = first

    def add(self, cand: TrackCandidate) -> None:
        self.candidates.append(cand)
        self.last = cand

    def score(self) -> float:
        """Long, confident, lower body visible: the child walking past the camera."""
        n = len(self.candidates)
        mean_conf = float(np.mean([c.mean_conf for c in self.candidates]))
        lower = float(np.mean([c.lower_body for c in self.candidates]))
        return n * mean_conf * (0.25 + 0.75 * lower)


class STGCNPredictor:
    def __init__(
        self,
        checkpoint_path: Path,
        device: str = "cuda",
        seq_len: int = 128,
        input_layout: str = "openpose",
        normalization: Optional[str] = None,
        impute_max_gap: int = 5,
        impute_method: str = "linear",
        preprocess: bool = True,
        resample: Optional[str] = None,
        window_frames: int = 0,
        window_stride: int = 0,
        min_person_frames: int = 16,
        min_window_coverage: float = 0.5,
        min_joint_conf: float = 0.05,
        track_max_jump: float = 1.5,
        track_max_missing: int = 30,
        reliable_min_coverage: float = 0.5,
        reliable_min_lower_body: float = 0.5,
        reliable_min_conf: float = 0.3,
    ):
        self.checkpoint_path = Path(checkpoint_path)
        self.device = device
        self.seq_len = int(seq_len)
        self.input_layout = input_layout
        self.normalization = normalization
        self.impute_max_gap = int(impute_max_gap)
        self.impute_method = impute_method
        self.preprocess = bool(preprocess)
        self.resample = resample or None
        self.window_frames = max(0, int(window_frames))
        self.window_stride = int(window_stride) if int(window_stride) > 0 else max(1, self.window_frames // 2)
        self.min_person_frames = max(1, int(min_person_frames))
        self.min_window_coverage = float(min_window_coverage)
        self.min_joint_conf = float(min_joint_conf)
        self.track_max_jump = float(track_max_jump)
        self.track_max_missing = int(track_max_missing)
        self.reliable_min_coverage = float(reliable_min_coverage)
        self.reliable_min_lower_body = float(reliable_min_lower_body)
        self.reliable_min_conf = float(reliable_min_conf)

        if self.device.startswith("cuda") and not torch.cuda.is_available():
            self.device = "cpu"

        if not self.checkpoint_path.exists():
            raise FileNotFoundError(f"ST-GCN checkpoint not found: {self.checkpoint_path}")

        self.model, self.ckpt = _load_stgcn_from_checkpoint(self.checkpoint_path)
        self.model = self.model.to(self.device)
        self.model.eval()

        dv2 = (self.ckpt.get("config") or {}).get("domain_v2")
        self.domain_v2 = gd.DomainV2Config.from_dict(dv2) if dv2 else None
        if self.domain_v2 is not None:
            self._check_domain_v2_checkpoint()

    def _check_domain_v2_checkpoint(self) -> None:
        """The checkpoint's channel layout must be exactly what gait_domain produces."""
        cfg = self.ckpt.get("config") or {}
        if int(self.ckpt.get("num_joints", 0)) != len(gd.KINECT17):
            raise ValueError("domain_v2 checkpoint must use 17 joints")
        dyn = list(cfg.get("dynamic_features") or []) if cfg.get("include_dynamics") else []
        if sorted(dyn) != sorted(self.domain_v2.dynamic_features):
            raise ValueError(f"checkpoint dynamic_features {dyn} != domain_v2 {list(self.domain_v2.dynamic_features)}")
        if dyn and list(dyn) != [f for f in gd.DYNAMIC_FEATURES if f in dyn]:
            raise ValueError(f"dynamic_features order {dyn} differs from gait_domain {gd.DYNAMIC_FEATURES}")
        if self.domain_v2.version != gd.VERSION:
            raise ValueError(f"checkpoint preprocessing {self.domain_v2.version} != server {gd.VERSION}")

    # ------------------------------------------------------------------ public

    def settings(self) -> Dict[str, object]:
        """What the server reports next to the checkpoint hash."""
        if self.domain_v2 is not None:
            return {
                "preprocessing": self.domain_v2.version,
                "seq_len": self.domain_v2.window,
                "target_fps": self.domain_v2.target_fps,
                "window_frames": self.domain_v2.window,
                "window_stride": max(1, self.domain_v2.window // 2),
                "resample": "linear",
                "min_person_frames": self.min_person_frames,
            }
        return {
            "seq_len": self.seq_len,
            "preprocess": self.preprocess,
            "resample": self.resample or str((self.ckpt.get("config") or {}).get("resample") or "nearest"),
            "window_frames": self.window_frames,
            "window_stride": self.window_stride if self.window_frames else 0,
            "min_person_frames": self.min_person_frames,
        }

    def predict_from_api_frames(
        self,
        frames: List[dict],
        sample_id: str = "api_sample",
        threshold: float = 0.5,
        temperature: float = 1.0,
        fps: Optional[float] = None,
    ) -> Dict[str, object]:
        """fps: frame rate of the source video (used by domain_v2 checkpoints only)."""
        seq_xy, confs, quality = self.frames_to_sequence(frames)

        if quality["frames_tracked"] < self.min_person_frames:
            raise ValueError(
                f"chỉ có {quality['frames_tracked']} frame theo dõi được người "
                f"(cần tối thiểu {self.min_person_frames})"
            )

        if self.domain_v2 is not None:
            result = self._predict_domain_v2(seq_xy, confs, fps, sample_id, threshold, temperature)
            result["T_in"] = quality["frames_total"]
            result["quality"] = quality
            result["reliable"] = self._is_reliable(quality)
            result["label_name"] = self._label_name(result)
            return result

        if self.preprocess:
            seq_xy = preprocess_skeleton_sequence(
                seq_xy,
                confidences=confs,
                max_gap=self.impute_max_gap,
                method=self.impute_method,
            )

        windows = self._windows(seq_xy)
        if len(windows) <= 1:
            start, end = windows[0] if windows else (0, int(seq_xy.shape[0]))
            result = self._predict_window(seq_xy[start:end], sample_id, threshold, temperature)
            result["T_in"] = quality["frames_total"]
            result["n_windows"] = 1
            result["windows"] = [{"start": start, "end": end, "p_asd": result["p_asd"]}]
        else:
            result = self._predict_windows(seq_xy, windows, sample_id, threshold, temperature)
            result["T_in"] = quality["frames_total"]

        result["quality"] = quality
        result["reliable"] = self._is_reliable(quality)
        result["label_name"] = self._label_name(result)
        return result

    # --------------------------------------------------------------- tracking

    def frames_to_sequence(self, frames: List[dict]) -> Tuple[np.ndarray, np.ndarray, Dict[str, object]]:
        """API frames -> (T,25,2) xy, (T,25) confidence, quality dict.

        T spans every frame index from the first to the last one received;
        frames with no tracked person are all-zero rows (OpenPose convention).
        """
        sorted_frames = sorted(frames, key=lambda item: int(item.get("frame_index", 0)))
        if not sorted_frames:
            empty = np.zeros((0, NUM_BODY25, 2), dtype=np.float32)
            return empty, np.zeros((0, NUM_BODY25), dtype=np.float32), self._quality(0, 0, 0, 0, 0, None)

        first_index = int(sorted_frames[0].get("frame_index", 0))
        last_index = int(sorted_frames[-1].get("frame_index", first_index))
        T = max(last_index - first_index + 1, len(sorted_frames))

        tracks: List[Track] = []
        frames_with_person = 0
        multi_person_frames = 0

        for position, frame in enumerate(sorted_frames):
            t = int(frame.get("frame_index", position)) - first_index
            if t < 0 or t >= T:
                t = position
            candidates = [c for c in self._candidates(t, frame.get("people", [])) if c.n_valid > 0]
            if not candidates:
                continue
            frames_with_person += 1
            if len(candidates) > 1:
                multi_person_frames += 1
            self._assign(tracks, candidates, t)

        if not tracks:
            empty = np.zeros((T, NUM_BODY25, 2), dtype=np.float32)
            return empty, np.zeros((T, NUM_BODY25), dtype=np.float32), self._quality(
                T, frames_with_person, 0, multi_person_frames, 0, None
            )

        best = max(tracks, key=Track.score)
        seq = np.zeros((T, NUM_BODY25, 2), dtype=np.float32)
        conf = np.zeros((T, NUM_BODY25), dtype=np.float32)
        for cand in best.candidates:
            seq[cand.frame] = cand.xy
            conf[cand.frame] = cand.conf

        quality = self._quality(T, frames_with_person, len(best.candidates), multi_person_frames, len(tracks), best)
        return seq, conf, quality

    def _candidates(self, t: int, people: Sequence[dict]) -> List[TrackCandidate]:
        out: List[TrackCandidate] = []
        for person in people:
            body25 = person.get("body25") or []
            if len(body25) < NUM_BODY25:
                continue
            points = sorted(body25, key=lambda item: int(item.get("id", 0)))[:NUM_BODY25]
            xy = np.zeros((NUM_BODY25, 2), dtype=np.float32)
            conf = np.zeros(NUM_BODY25, dtype=np.float32)
            for j, point in enumerate(points):
                xy[j, 0] = float(point.get("x", 0.0))
                xy[j, 1] = float(point.get("y", 0.0))
                conf[j] = float(point.get("confidence", 0.0))
            xy[~np.isfinite(xy)] = 0.0
            conf[~np.isfinite(conf)] = 0.0
            # Joints OpenPose did not see are (0,0) with confidence 0.
            xy[conf < self.min_joint_conf] = 0.0
            out.append(TrackCandidate(t, xy, conf, self.min_joint_conf))
        return out

    def _assign(self, tracks: List[Track], candidates: List[TrackCandidate], t: int) -> None:
        """Greedy one-to-one matching by body-size-normalised centre distance."""
        active = [tr for tr in tracks if t - tr.last.frame <= self.track_max_missing]
        pairs: List[Tuple[float, int, int]] = []
        for i, tr in enumerate(active):
            for k, cand in enumerate(candidates):
                scale = 0.5 * (tr.last.scale + cand.scale)
                dist = float(np.linalg.norm(cand.center - tr.last.center)) / scale
                # Allow drift for every frame the track was unseen.
                gap = max(1, t - tr.last.frame)
                if dist <= self.track_max_jump * gap:
                    pairs.append((dist, i, k))
        pairs.sort()
        used_tracks: set = set()
        used_cands: set = set()
        for dist, i, k in pairs:
            if i in used_tracks or k in used_cands:
                continue
            active[i].add(candidates[k])
            used_tracks.add(i)
            used_cands.add(k)
        for k, cand in enumerate(candidates):
            if k not in used_cands:
                tracks.append(Track(len(tracks), cand))

    def _quality(
        self,
        frames_total: int,
        frames_with_person: int,
        frames_tracked: int,
        multi_person_frames: int,
        n_tracks: int,
        track: Optional[Track],
    ) -> Dict[str, object]:
        coverage = frames_tracked / frames_total if frames_total else 0.0
        mean_conf = float(np.mean([c.mean_conf for c in track.candidates])) if track else None
        lower_body = float(np.mean([c.lower_body for c in track.candidates])) if track else None
        return {
            "frames_total": int(frames_total),
            "frames_with_person": int(frames_with_person),
            "frames_tracked": int(frames_tracked),
            "person_coverage": round(float(coverage), 4),
            "multi_person_frames": int(multi_person_frames),
            "n_tracks": int(n_tracks),
            "mean_keypoint_confidence": None if mean_conf is None else round(mean_conf, 4),
            "lower_body_coverage": None if lower_body is None else round(lower_body, 4),
        }

    def _is_reliable(self, quality: Dict[str, object]) -> bool:
        conf = quality.get("mean_keypoint_confidence")
        lower = quality.get("lower_body_coverage")
        return (
            float(quality.get("person_coverage") or 0.0) >= self.reliable_min_coverage
            and conf is not None
            and float(conf) >= self.reliable_min_conf
            and lower is not None
            and float(lower) >= self.reliable_min_lower_body
        )

    # ---------------------------------------------------------------- windows

    def _windows(self, seq_xy: np.ndarray) -> List[Tuple[int, int]]:
        T = int(seq_xy.shape[0])
        W = self.window_frames
        if W <= 0 or T <= W:
            return [(0, T)]
        present = np.abs(seq_xy).sum(axis=(1, 2)) > 0.0
        starts = list(range(0, T - W + 1, self.window_stride))
        if starts[-1] != T - W:
            starts.append(T - W)
        windows = [(s, s + W) for s in starts if present[s : s + W].mean() >= self.min_window_coverage]
        return windows or [(0, T)]

    def _predict_window(self, seq_xy: np.ndarray, sample_id: str, threshold: float, temperature: float) -> Dict[str, object]:
        return _predict_sequence(
            model=self.model,
            ckpt=self.ckpt,
            seq_xy=seq_xy,
            sample_id=sample_id,
            seq_len=self.seq_len,
            input_layout=self.input_layout,
            normalization=self.normalization,
            trim_zero_ends=True,
            threshold=threshold,
            temperature=temperature,
            device=self.device,
            debug=False,
            remove_to_18=False,
            remove_to_17=False,
            remove_kp=None,
            excel_removed_kp=None,
            expect_joints=None,
            preprocess=False,  # done above, with confidences
            resample=self.resample,
        )

    def _predict_windows(
        self,
        seq_xy: np.ndarray,
        windows: Sequence[Tuple[int, int]],
        sample_id: str,
        threshold: float,
        temperature: float,
    ) -> Dict[str, object]:
        """Average window LOGITS, then softmax(T): keeps the result on the same
        scale the calibration (temperature fitted on logits) expects."""
        per_window = []
        logits = []
        for start, end in windows:
            r = self._predict_window(seq_xy[start:end], f"{sample_id}[{start}:{end}]", threshold, temperature)
            logits.append([r["logit_typical"], r["logit_asd"]])
            per_window.append({"start": int(start), "end": int(end), "p_asd": r["p_asd"]})

        mean_logits = np.mean(np.asarray(logits, dtype=np.float64), axis=0)
        probs = torch.softmax(torch.from_numpy(mean_logits) / float(temperature), dim=0).numpy()
        p_asd = float(probs[1])
        base = r  # last window: carries J / resample / threshold fields
        return {
            "file": sample_id,
            "T_in": int(seq_xy.shape[0]),
            "T_used": int(sum(end - start for start, end in windows)),
            "J": base["J"],
            "p_typical": float(probs[0]),
            "p_asd": p_asd,
            "logit_typical": float(mean_logits[0]),
            "logit_asd": float(mean_logits[1]),
            "pred_argmax": int(np.argmax(probs)),
            "label_threshold": int(p_asd >= float(threshold)),
            "threshold": float(threshold),
            "temperature": float(temperature),
            "resample": base["resample"],
            "n_windows": len(windows),
            "windows": per_window,
            "p_asd_window_mean": float(np.mean([w["p_asd"] for w in per_window])),
        }

    # ------------------------------------------------------------- domain v2

    def domain_v2_windows(self, seq_xy: np.ndarray, confs: np.ndarray, fps: Optional[float]):
        """Tracked BODY_25 clip -> (model inputs (n, W, 17, C), window spans in source frames, info).

        Exposed separately so tests can compare it with the training dataset output.
        """
        cfg = self.domain_v2
        fps_ok = fps is not None and np.isfinite(fps) and 1.0 <= float(fps) <= 240.0
        fps_used = float(fps) if fps_ok else FPS_FALLBACK

        present = np.any(confs > 0, axis=1)
        idx = np.flatnonzero(present)
        if idx.size == 0:
            raise ValueError("không có frame nào theo dõi được người")
        first, last = int(idx[0]), int(idx[-1]) + 1  # bỏ đoạn không có người ở hai đầu
        seq17, valid = gd.openpose25_to_17(seq_xy[first:last], confs[first:last], cfg.min_conf)
        feat, prep = gd.prepare_clip(seq17, valid, fps_used, cfg)

        # Frames with a tracked person, on the resampled time axis (same resample as the joints)
        present_t = gd.resample_fps(present[first:last].astype(np.float64)[:, None], fps_used, cfg.target_fps)[:, 0] >= 0.5
        W = cfg.window
        stride = max(1, W // 2)
        starts = gd.window_starts(feat.shape[0], W, stride)
        kept = [s for s in starts if present_t[s:s + W].mean() >= self.min_window_coverage] or starts
        inputs = np.stack([gd.crop(feat, W, s) for s in kept])

        scale = fps_used / cfg.target_fps  # resampled frame -> source frame
        # [start, end) in source frames: map the first and LAST (inclusive) resampled frame back
        spans = [(first + int(round(s * scale)),
                  min(last, first + int(round((min(s + W, feat.shape[0]) - 1) * scale)) + 1)) for s in kept]
        info = {
            "version": cfg.version,
            "fps_source": round(fps_used, 3),
            "fps_assumed": not fps_ok,
            "target_fps": cfg.target_fps,
            "window_frames": W,
            "window_stride": stride,
            "frames_prepared": prep["frames_prepared"],
            "missing_joint_fraction": round(prep["missing_frac"], 4),
            "stretched": feat.shape[0] < W,
        }
        return inputs, spans, info

    def _predict_domain_v2(
        self,
        seq_xy: np.ndarray,
        confs: np.ndarray,
        fps: Optional[float],
        sample_id: str,
        threshold: float,
        temperature: float,
    ) -> Dict[str, object]:
        """Average window LOGITS, then softmax(T) — same convention as _predict_windows."""
        inputs, spans, info = self.domain_v2_windows(seq_xy, confs, fps)
        logits, per_window = [], []
        for x, (start, end) in zip(inputs, spans):
            _, p_asd_w, _, lg = _predict_one(self.model, x, self.device, temperature=temperature)
            logits.append(lg)
            per_window.append({"start": int(start), "end": int(end), "p_asd": float(p_asd_w)})

        mean_logits = np.mean(np.asarray(logits, dtype=np.float64), axis=0)
        probs = torch.softmax(torch.from_numpy(mean_logits) / float(temperature), dim=0).numpy()
        p_asd = float(probs[1])
        return {
            "file": sample_id,
            "T_used": int(sum(end - start for start, end in spans)),
            "J": len(gd.KINECT17),
            "p_typical": float(probs[0]),
            "p_asd": p_asd,
            "logit_typical": float(mean_logits[0]),
            "logit_asd": float(mean_logits[1]),
            "pred_argmax": int(np.argmax(probs)),
            "label_threshold": int(p_asd >= float(threshold)),
            "threshold": float(threshold),
            "temperature": float(temperature),
            "resample": "linear",
            "n_windows": len(spans),
            "windows": per_window,
            "p_asd_window_mean": float(np.mean([w["p_asd"] for w in per_window])),
            "preprocessing": info,
        }

    def _label_name(self, result: Dict[str, object]) -> str:
        label = int(result.get("label_threshold", result.get("pred_argmax", 0)))
        return "ASD" if label == 1 else "Typical"
