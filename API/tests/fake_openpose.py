"""Stand-in for openpose.bin used by tests and local end-to-end runs.

Accepts the same flags the server passes (--video, --write_json, ...) and
writes one `<name>_<12 digits>_keypoints.json` per decoded frame:

* FAKE_OPENPOSE_SOURCE_JSON_DIR set → copy those real OpenPose JSON files
  (frame-aligned with the video being "processed");
* otherwise → a synthetic person whose head sits at a fixed, known position
  (see HEAD_X/HEAD_Y), walking in place.

Set FAKE_OPENPOSE_FAIL=1 to simulate the CUDA failure seen on the GPU server.
"""

import argparse
import json
import math
import os
import shutil
import sys
from pathlib import Path

import cv2

HEAD_X, HEAD_Y = 0.5, 0.2  # fraction of width / height


def synthetic_person(i: int, width: int, height: int) -> list:
    cx, top = HEAD_X * width, HEAD_Y * height
    unit = height / 10.0
    s = math.sin(i * math.pi / 6)
    joints = {
        0: (cx, top),
        1: (cx, top + unit),
        2: (cx - unit, top + 1.1 * unit),
        5: (cx + unit, top + 1.1 * unit),
        3: (cx - 1.1 * unit, top + 2 * unit),
        6: (cx + 1.1 * unit, top + 2 * unit),
        4: (cx - 1.2 * unit, top + 3 * unit),
        7: (cx + 1.2 * unit, top + 3 * unit),
        8: (cx, top + 3.5 * unit),
        9: (cx - 0.5 * unit, top + 3.5 * unit),
        12: (cx + 0.5 * unit, top + 3.5 * unit),
        10: (cx - 0.5 * unit, top + 5 * unit),
        13: (cx + 0.5 * unit, top + 5 * unit),
        11: (cx - 0.5 * unit, top + 6.5 * unit - 0.3 * unit * s),
        14: (cx + 0.5 * unit, top + 6.5 * unit + 0.3 * unit * s),
        15: (cx - 0.15 * unit, top - 0.15 * unit),
        16: (cx + 0.15 * unit, top - 0.15 * unit),
        17: (cx - 0.35 * unit, top - 0.05 * unit),
        18: (cx + 0.35 * unit, top - 0.05 * unit),
        19: (cx + 0.8 * unit, top + 6.7 * unit),
        20: (cx + 0.9 * unit, top + 6.7 * unit),
        21: (cx + 0.5 * unit, top + 6.6 * unit),
        22: (cx - 0.8 * unit, top + 6.7 * unit),
        23: (cx - 0.9 * unit, top + 6.7 * unit),
        24: (cx - 0.5 * unit, top + 6.6 * unit),
    }
    flat = []
    for j in range(25):
        x, y = joints[j]
        flat += [round(x, 2), round(y, 2), 0.9]
    return flat


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--write_json", required=True)
    args, _unknown = parser.parse_known_args()

    if os.getenv("FAKE_OPENPOSE_FAIL") == "1":
        sys.stderr.write("Error:\nCuda check failed (100 vs. 0): no CUDA-capable device is detected\n")
        return 1

    out_dir = Path(args.write_json)
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = Path(args.video).stem

    source = os.getenv("FAKE_OPENPOSE_SOURCE_JSON_DIR")
    if source:
        for k, src in enumerate(sorted(Path(source).glob("*_keypoints.json"))):
            shutil.copyfile(src, out_dir / f"{stem}_{k:012d}_keypoints.json")
        return 0

    cap = cv2.VideoCapture(args.video)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 640
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 480
    i = 0
    while True:
        ok, _ = cap.read()
        if not ok:
            break
        people = [] if i % 10 == 9 else [{"person_id": [-1], "pose_keypoints_2d": synthetic_person(i, width, height)}]
        with open(out_dir / f"{stem}_{i:012d}_keypoints.json", "w", encoding="utf-8") as f:
            json.dump({"version": 1.3, "people": people}, f)
        i += 1
    cap.release()
    return 0 if i else 2


if __name__ == "__main__":
    sys.exit(main())
