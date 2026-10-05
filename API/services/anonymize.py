"""Face anonymisation for stored videos (đề cương: "trẻ được che mặt").

OpenPose has already located the head (BODY_25 nose, eyes, ears, neck), so no
extra face detector is needed: each head region is pixelated and blurred. A
frame where nobody was detected is blurred entirely, because a missed
detection must not leave a child's face visible.
"""

from __future__ import annotations

from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import cv2
import numpy as np

NOSE = 0
NECK = 1
MID_HIP = 8
HEAD_JOINTS = (0, 15, 16, 17, 18)  # nose, right/left eye, right/left ear

Box = Tuple[int, int, int, int]  # x0, y0, x1, y1 (exclusive)


def _joint(body25: Sequence[dict], joint_id: int, min_conf: float) -> Optional[Tuple[float, float]]:
    for joint in body25:
        if int(joint.get("id", -1)) != joint_id:
            continue
        x = float(joint.get("x", 0.0))
        y = float(joint.get("y", 0.0))
        conf = float(joint.get("confidence", 0.0))
        if conf >= min_conf and (x != 0.0 or y != 0.0) and np.isfinite(x) and np.isfinite(y):
            return x, y
    return None


def head_box(
    body25: Sequence[dict],
    frame_width: int,
    frame_height: int,
    min_conf: float = 0.05,
) -> Optional[Box]:
    """Generous square around the head of one OpenPose person, or None."""
    head = [p for p in (_joint(body25, j, min_conf) for j in HEAD_JOINTS) if p is not None]
    neck = _joint(body25, NECK, min_conf)
    mid_hip = _joint(body25, MID_HIP, min_conf)

    if head:
        pts = np.asarray(head, dtype=np.float32)
        center = pts.mean(axis=0)
        spread = float(np.max(np.linalg.norm(pts - center, axis=1))) if len(pts) > 1 else 0.0
        radius = spread * 1.8
        if neck is not None:
            # Nose-to-neck distance is roughly one head height.
            radius = max(radius, 1.1 * float(np.hypot(center[0] - neck[0], center[1] - neck[1])))
    elif neck is not None and mid_hip is not None:
        # Face not detected (e.g. turned away): estimate the head above the neck.
        torso = float(np.hypot(neck[0] - mid_hip[0], neck[1] - mid_hip[1]))
        center = np.asarray([neck[0], neck[1] - 0.45 * torso], dtype=np.float32)
        radius = 0.5 * torso
    else:
        return None

    radius = max(radius, 0.04 * max(frame_width, frame_height))
    x0 = int(max(0, np.floor(center[0] - radius)))
    y0 = int(max(0, np.floor(center[1] - radius)))
    x1 = int(min(frame_width, np.ceil(center[0] + radius)))
    y1 = int(min(frame_height, np.ceil(center[1] + radius)))
    if x1 - x0 < 2 or y1 - y0 < 2:
        return None
    return x0, y0, x1, y1


def frame_head_boxes(people: Iterable[dict], frame_width: int, frame_height: int) -> List[Box]:
    boxes = []
    for person in people or []:
        box = head_box(person.get("body25", []), frame_width, frame_height)
        if box is not None:
            boxes.append(box)
    return boxes


def obscure_region(frame: np.ndarray, box: Box) -> None:
    """Pixelate then blur in place: unreadable even after sharpening."""
    x0, y0, x1, y1 = box
    roi = frame[y0:y1, x0:x1]
    if roi.size == 0:
        return
    h, w = roi.shape[:2]
    small = cv2.resize(roi, (max(1, w // 12), max(1, h // 12)), interpolation=cv2.INTER_AREA)
    pixelated = cv2.resize(small, (w, h), interpolation=cv2.INTER_NEAREST)
    k = max(3, (min(w, h) // 4) | 1)
    frame[y0:y1, x0:x1] = cv2.GaussianBlur(pixelated, (k, k), 0)


def obscure_frame(frame: np.ndarray) -> None:
    h, w = frame.shape[:2]
    obscure_region(frame, (0, 0, w, h))


def anonymize_video(
    input_path: Path,
    output_path: Path,
    frames: Sequence[dict],
    *,
    carry_frames: int = 10,
) -> Dict[str, object]:
    """Write a copy of `input_path` with every detected head obscured.

    `frames` is the API keypoint format (`[{frame_index, people:[{body25}]}]`).
    Head boxes are carried forward for up to `carry_frames` frames to cover
    short detection drop-outs; frames with no detection at all are blurred
    entirely. Returns statistics; raises RuntimeError if the video can't be read
    or written.
    """
    by_index = {int(f.get("frame_index", i)): f.get("people", []) for i, f in enumerate(frames)}

    cap = cv2.VideoCapture(str(input_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video for anonymisation: {input_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
    if not np.isfinite(fps) or fps <= 0:
        fps = 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(str(output_path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    if not writer.isOpened():
        cap.release()
        raise RuntimeError(f"Cannot open video writer: {output_path}")

    stats = {"frames": 0, "head_boxes": 0, "carried_frames": 0, "fully_blurred_frames": 0}
    last_boxes: List[Box] = []
    last_seen = -10**9
    index = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            boxes = frame_head_boxes(by_index.get(index, []), width, height)
            if boxes:
                last_boxes, last_seen = boxes, index
            elif last_boxes and index - last_seen <= carry_frames:
                boxes = last_boxes
                stats["carried_frames"] += 1

            if boxes:
                for box in boxes:
                    obscure_region(frame, box)
                stats["head_boxes"] += len(boxes)
            else:
                obscure_frame(frame)
                stats["fully_blurred_frames"] += 1

            writer.write(frame)
            stats["frames"] += 1
            index += 1
    finally:
        cap.release()
        writer.release()

    if stats["frames"] == 0:
        output_path.unlink(missing_ok=True)
        raise RuntimeError(f"No frames could be decoded from {input_path}")
    return stats


def probe_video(path: Path) -> Dict[str, Optional[float]]:
    """fps / size / frame count from the container (None when unknown)."""
    info: Dict[str, Optional[float]] = {
        "fps": None,
        "width": None,
        "height": None,
        "frame_count": None,
        "duration_sec": None,
    }
    cap = cv2.VideoCapture(str(path))
    try:
        if not cap.isOpened():
            return info
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        count = float(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        if np.isfinite(fps) and 1.0 <= fps <= 240.0:
            info["fps"] = round(fps, 3)
        if width > 0 and height > 0:
            info["width"], info["height"] = width, height
        if np.isfinite(count) and count > 0:
            info["frame_count"] = int(count)
            if info["fps"]:
                info["duration_sec"] = round(count / fps, 3)
        return info
    finally:
        cap.release()
