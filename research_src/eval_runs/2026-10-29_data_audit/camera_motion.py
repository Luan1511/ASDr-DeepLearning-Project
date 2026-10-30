"""Đo chuyển động nền (camera cầm tay hay cố định) cho Dataset_video.

Optical flow Farneback trên ảnh thu nhỏ, che vùng người (bbox keypoint nới rộng),
lấy trung vị độ lớn flow của nền mỗi cặp frame, rồi trung vị theo clip (px/frame ở
ảnh rộng 270 px). Ghi camera_motion.csv cạnh script.

    python camera_motion.py --root "E:/Scientific research 2025-2026/Linux_src_2/NCKH_25-26"
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import cv2
import numpy as np
import pandas as pd

OUT = Path(__file__).resolve().parent
W = 270
STEP = 2  # 60 fps → so frame t với t+2


def person_mask(frame_people, sx, sy, shape):
    m = np.ones(shape, np.uint8)
    for p in frame_people:
        pts = np.array([(k["x"], k["y"]) for k in p["body25"] if k["confidence"] > 0.1])
        if len(pts) < 2:
            continue
        x0, y0 = pts.min(0)
        x1, y1 = pts.max(0)
        w, h = x1 - x0, y1 - y0
        x0, x1 = (x0 - 0.4 * w) * sx, (x1 + 0.4 * w) * sx
        y0, y1 = (y0 - 0.25 * h) * sy, (y1 + 0.15 * h) * sy
        m[max(0, int(y0)) : int(y1) + 1, max(0, int(x0)) : int(x1) + 1] = 0
    return m.astype(bool)


def clip_motion(avi: Path, js: Path):
    d = json.load(open(js, encoding="utf-8"))
    cap = cv2.VideoCapture(str(avi))
    frames = []
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        frames.append(fr)
    cap.release()
    h0, w0 = frames[0].shape[:2]
    H = int(round(W * h0 / w0))
    sx, sy = W / w0, H / h0
    gray = [cv2.cvtColor(cv2.resize(f, (W, H)), cv2.COLOR_BGR2GRAY) for f in frames]
    mags = []
    for t in range(0, len(gray) - STEP, STEP):
        flow = cv2.calcOpticalFlowFarneback(gray[t], gray[t + STEP], None, 0.5, 3, 15, 3, 5, 1.2, 0)
        people = d["frames"][t]["people"] + d["frames"][t + STEP]["people"] if t + STEP < len(d["frames"]) else []
        m = person_mask(people, sx, sy, (H, W))
        if m.mean() < 0.15:
            continue
        mags.append(float(np.median(np.linalg.norm(flow[m], axis=1))))
    return float(np.median(mags)) if mags else np.nan, float(np.percentile(mags, 90)) if mags else np.nan


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    root = Path(ap.parse_args().root) / "Datas/Kinect25_ASD_Video"
    rows = []
    for label, sub in (("ASD", "Autism"), ("Typical", "Typical")):
        for avi in sorted((root / "Dataset_video" / sub).glob("*.avi")):
            idx = int(re.findall(r"\d+", avi.stem)[0])
            med, p90 = clip_motion(avi, root / "Visualized_Results/keypoints" / sub / f"{avi.stem}.json")
            rows.append(dict(label=label, idx=idx, bg_flow_med=med, bg_flow_p90=p90))
        print(sub, "done")
    pd.DataFrame(rows).sort_values(["label", "idx"]).to_csv(OUT / "camera_motion.csv", index=False)


if __name__ == "__main__":
    main()
