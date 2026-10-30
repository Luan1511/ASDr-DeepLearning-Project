"""Per-recording skeleton statistics from API keypoints_body25.json files.

Compares the debug videos with the calibration set: person size in pixels,
where the person is in the frame, how far they travel, view (shoulder width /
torso length ratio: ~1 frontal, ~0 profile), and vertical hip motion."""
import glob
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(sys.argv[1])
pattern = sys.argv[2] if len(sys.argv) > 2 else "*"

NECK, MIDHIP, RSH, LSH, RANK, LANK, RHIP, LHIP = 1, 8, 2, 5, 11, 14, 9, 12


def stats(path: Path):
    d = json.load(open(path))
    if "video" not in d:
        return None  # older API payloads (no video info) are not part of this comparison
    W, H = d["video"]["width"], d["video"]["height"]
    fps = d["video"]["fps"]
    rows = []
    for fr in d["frames"]:
        if not fr["people"]:
            continue
        p = max(fr["people"], key=lambda q: np.mean([k["confidence"] for k in q["body25"]]))
        xy = np.array([[k["x"], k["y"], k["confidence"]] for k in sorted(p["body25"], key=lambda k: k["id"])])
        rows.append(xy)
    if not rows:
        return None
    A = np.stack(rows)  # (T,25,3)
    valid = A[..., 2] > 0.05
    torso = np.linalg.norm(A[:, NECK, :2] - A[:, MIDHIP, :2], axis=1)
    ok = valid[:, NECK] & valid[:, MIDHIP]
    sh = np.linalg.norm(A[:, RSH, :2] - A[:, LSH, :2], axis=1)
    oks = ok & valid[:, RSH] & valid[:, LSH]
    ratio = sh[oks] / torso[oks] if oks.any() else np.array([np.nan])
    hip = A[:, MIDHIP, :2]
    ankle_sep = np.abs(A[:, RANK, 0] - A[:, LANK, 0])
    ank_ok = valid[:, RANK] & valid[:, LANK]
    bbox_h = []
    for t in range(A.shape[0]):
        v = A[t, valid[t], :2]
        if len(v) >= 4:
            bbox_h.append(v[:, 1].max() - v[:, 1].min())
    return dict(
        file=path.parent.name, W=W, H=H, fps=fps, T=A.shape[0],
        torso_px=float(np.median(torso[ok])) if ok.any() else np.nan,
        torso_rel_H=float(np.median(torso[ok]) / H) if ok.any() else np.nan,
        bbox_h_rel=float(np.median(bbox_h) / H) if bbox_h else np.nan,
        hip_x_rel=float(np.median(hip[ok, 0]) / W) if ok.any() else np.nan,
        hip_y_rel=float(np.median(hip[ok, 1]) / H) if ok.any() else np.nan,
        x_travel_torso=float((hip[ok, 0].max() - hip[ok, 0].min()) / np.median(torso[ok])) if ok.any() else np.nan,
        y_travel_torso=float((hip[ok, 1].max() - hip[ok, 1].min()) / np.median(torso[ok])) if ok.any() else np.nan,
        size_change=float(torso[ok].max() / max(torso[ok].min(), 1)) if ok.any() else np.nan,
        shoulder_torso=float(np.nanmedian(ratio)),
        ankle_sep_torso=float(np.median(ankle_sep[ank_ok] / torso[ank_ok])) if ank_ok.any() else np.nan,
        mean_conf=float(A[..., 2][valid].mean()),
    )


keys = ["file", "W", "H", "fps", "T", "torso_px", "torso_rel_H", "bbox_h_rel", "hip_x_rel", "hip_y_rel",
        "x_travel_torso", "y_travel_torso", "size_change", "shoulder_torso", "ankle_sep_torso", "mean_conf"]
out = []
for f in sorted(ROOT.glob(f"{pattern}/keypoints_body25.json")):
    s = stats(f)
    if s:
        out.append(s)

print(",".join(keys))
for s in out:
    print(",".join(f"{s[k]:.3f}" if isinstance(s[k], float) else str(s[k]) for k in keys))

# group summary
groups = {}
for s in out:
    g = s["file"].split("-")[1] if s["file"].startswith("calib-") else s["file"]
    groups.setdefault(g, []).append(s)
print("\n== medians per group (and 10-90 pct)")
for g, items in groups.items():
    line = [f"{g} n={len(items)}"]
    for k in keys[5:]:
        v = np.array([i[k] for i in items], dtype=float)
        line.append(f"{k}={np.nanmedian(v):.2f}[{np.nanpercentile(v,10):.2f},{np.nanpercentile(v,90):.2f}]")
    print(" | ".join(line))
