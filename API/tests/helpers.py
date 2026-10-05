import os
import stat
import sys
from pathlib import Path

import cv2
import numpy as np

API_DIR = Path(__file__).resolve().parents[1]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))


def write_textured_video(path: Path, frames: int = 40, width: int = 320, height: int = 240, fps: float = 25.0) -> Path:
    """Random high-frequency texture so any blurring is measurable."""
    rng = np.random.default_rng(0)
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    assert writer.isOpened(), "OpenCV cannot write mp4v test videos"
    for _ in range(frames):
        writer.write(rng.integers(0, 256, size=(height, width, 3), dtype=np.uint8))
    writer.release()
    return path


def read_frames(path: Path) -> list:
    cap = cv2.VideoCapture(str(path))
    out = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        out.append(frame)
    cap.release()
    return out


def sharpness(img: np.ndarray) -> float:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def make_fake_openpose(tmp: Path) -> Path:
    """Executable wrapper around tests/fake_openpose.py for subprocess.run."""
    script = Path(__file__).resolve().parent / "fake_openpose.py"
    if os.name == "nt":
        wrapper = tmp / "openpose.cmd"
        wrapper.write_text(f'@"{sys.executable}" "{script}" %*\n', encoding="utf-8")
    else:
        wrapper = tmp / "openpose.bin"
        wrapper.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{script}" "$@"\n', encoding="utf-8")
        wrapper.chmod(wrapper.stat().st_mode | stat.S_IEXEC)
    return wrapper


def make_random_checkpoint(path: Path, num_joints: int = 18) -> Path:
    """Untrained ST-GCN with the deployed checkpoint layout (smoke tests only)."""
    import torch

    from ST_GCN import ST_GCN, Graph

    layout = {17: "kinect17", 18: "kinect23", 25: "openpose25"}[num_joints]
    graph = Graph(layout=layout)
    torch.manual_seed(0)
    model = ST_GCN(in_channels=2, num_class=2, A=graph.A, edge_importance_weighting=True, dropout=0.2)
    torch.save(
        {"model_state_dict": model.state_dict(), "config": {"normalization": "bbox"}, "num_joints": num_joints},
        path,
    )
    return path
