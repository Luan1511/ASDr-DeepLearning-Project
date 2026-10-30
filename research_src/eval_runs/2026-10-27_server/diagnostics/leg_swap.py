"""Body-proportion and leg-dynamics checks.

1. proportions per group (pixels, before normalisation): leg length / torso
   length, body height / torso, shoulder width / torso — static shape cues
   that survive per-frame bbox normalisation.
2. leg transplant: recipient keeps its own trunk/arms, gets the donor's leg
   trajectories (relative to mid-hip, scaled by torso length, time-resampled).
3. shape-only transplant: recipient's own motion, but every frame rescaled so
   its leg/torso proportion equals the donor's median (legs stretched or
   shortened along the hip->joint direction).
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch

ap = argparse.ArgumentParser()
ap.add_argument("--api-dir", required=True)
ap.add_argument("--checkpoint", required=True)
ap.add_argument("--calibration", default=None)
ap.add_argument("--root", required=True)
ap.add_argument("--pairs", nargs="+", required=True, help="recipient:donor subject names")
args = ap.parse_args()

sys.path.insert(0, args.api_dir)
from services.stgcn_service import STGCNPredictor  # noqa: E402
from services.preprocessing import preprocess_skeleton_sequence  # noqa: E402
import openpose_excel_stgcn_pipeline as pl  # noqa: E402

pred = STGCNPredictor(checkpoint_path=Path(args.checkpoint), device="cuda" if torch.cuda.is_available() else "cpu")
cfg = pred.ckpt.get("config") or {}
norm = str(cfg.get("normalization", "original"))
T_cal = float(json.load(open(args.calibration))["temperature"]) if args.calibration else 1.0
ROOT = Path(args.root)

NOSE, NECK, MIDHIP = 0, 1, 8
RSH, LSH = 2, 5
RHIP, RKNEE, RANK, LHIP, LKNEE, LANK = 9, 10, 11, 12, 13, 14
LEG = [RHIP, RKNEE, RANK, LHIP, LKNEE, LANK, 19, 20, 21, 22, 23, 24]


def to18(seq25):
    s = pl._trim_all_zero_ends(seq25)
    s = pl._openpose25_to_kinect25(s)
    return pl._remove_joint_indices(s, pl.DEFAULT_REMOVE_TO_18)


def p_asd(seq25):
    x = pl._build_model_input(to18(seq25), cfg=cfg, seq_len=pred.seq_len, normalization=norm, num_joints=18,
                              resample=pl._resolve_resample(pred.resample, cfg))
    t = torch.from_numpy(x).float().unsqueeze(0).permute(0, 3, 1, 2).contiguous().to(pred.device)
    with torch.no_grad():
        lg = pred.model(t)[0].cpu().numpy().astype(np.float64)
    z = lg / T_cal
    e = np.exp(z - z.max())
    return float(e[1] / e.sum()), float(lg[1] - lg[0])


def load(name):
    frames = json.load(open(ROOT / name / "keypoints_body25.json"))["frames"]
    seq, conf, _ = pred.frames_to_sequence(frames)
    return preprocess_skeleton_sequence(seq, confidences=conf, max_gap=pred.impute_max_gap, method=pred.impute_method)


def valid(seq, j):
    return np.abs(seq[:, j]).sum(axis=1) > 0


def proportions(seq):
    ok = valid(seq, NECK) & valid(seq, MIDHIP) & valid(seq, RANK) & valid(seq, LANK) & valid(seq, RHIP) & valid(seq, LHIP) & valid(seq, NOSE)
    torso = np.linalg.norm(seq[:, NECK] - seq[:, MIDHIP], axis=1)
    leg = 0.5 * (np.linalg.norm(seq[:, RANK] - seq[:, RHIP], axis=1) + np.linalg.norm(seq[:, LANK] - seq[:, LHIP], axis=1))
    height = 0.5 * (seq[:, RANK, 1] + seq[:, LANK, 1]) - seq[:, NOSE, 1]
    sh = np.linalg.norm(seq[:, RSH] - seq[:, LSH], axis=1)
    t = np.maximum(torso[ok], 1e-3)
    return dict(leg_torso=float(np.median(leg[ok] / t)), height_torso=float(np.median(height[ok] / t)),
                shoulder_torso=float(np.median(sh[ok] / t)), leg_height=float(np.median(leg[ok] / np.maximum(height[ok], 1e-3))))


def resample_T(seq, T):
    idx = np.clip(np.rint(np.linspace(0, seq.shape[0] - 1, T)).astype(int), 0, seq.shape[0] - 1)
    return seq[idx]


def hip_frame(seq):
    c = seq[:, MIDHIP]
    t = np.linalg.norm(seq[:, NECK] - seq[:, MIDHIP], axis=1)
    return c, np.maximum(t, 1e-3)


def transplant_legs(recipient, donor):
    d = resample_T(donor, recipient.shape[0])
    rc, rt = hip_frame(recipient)
    dc, dt = hip_frame(d)
    out = recipient.copy()
    for j in LEG:
        rel = (d[:, j] - dc) / dt[:, None]
        out[:, j] = rc + rel * rt[:, None]
    return out


def rescale_legs(seq, factor):
    """Stretch every leg joint away from its hip by `factor` (shape only)."""
    out = seq.copy()
    for hip, joints in ((RHIP, [RKNEE, RANK, 22, 23, 24]), (LHIP, [LKNEE, LANK, 19, 20, 21])):
        for j in joints:
            v = valid(seq, j) & valid(seq, hip)
            out[v, j] = seq[v, hip] + (seq[v, j] - seq[v, hip]) * factor
    return out


# ---- group proportions over the calibration set
groups = {"Autism": [], "Typical": []}
for d in sorted(ROOT.glob("calib-*")):
    g = d.name.split("-")[1]
    groups[g].append(proportions(load(d.name)))
print("== body proportions (pixels before normalisation), median [10th, 90th pct]")
for g, items in groups.items():
    line = [f"{g:<8} n={len(items)}"]
    for k in ("leg_torso", "height_torso", "shoulder_torso", "leg_height"):
        v = np.array([i[k] for i in items])
        line.append(f"{k}={np.median(v):.2f} [{np.percentile(v,10):.2f}, {np.percentile(v,90):.2f}]")
    print("  " + " | ".join(line))
for name in sorted({p.split(":")[0] for p in args.pairs}):
    pr = proportions(load(name))
    print(f"  {name:<26} " + " | ".join(f"{k}={pr[k]:.2f}" for k in ("leg_torso", "height_torso", "shoulder_torso", "leg_height")))

# ---- transplants
for pair in args.pairs:
    rn, dn = pair.split(":")
    r, d = load(rn), load(dn)
    pr, pdn = proportions(r), proportions(d)
    print(f"\n#### {rn}  (donor {dn})")
    p0, m0 = p_asd(r)
    print(f"  original                                p_asd={p0:.4f} margin={m0:+.2f}")
    p1, m1 = p_asd(transplant_legs(r, d))
    print(f"  with donor's legs (dynamics + shape)    p_asd={p1:.4f} margin={m1:+.2f}")
    f = pdn["leg_torso"] / max(pr["leg_torso"], 1e-6)
    p2, m2 = p_asd(rescale_legs(r, f))
    print(f"  own motion, legs rescaled x{f:.2f} to donor's leg/torso   p_asd={p2:.4f} margin={m2:+.2f}")
    for f2 in (0.7, 0.85, 1.15, 1.3):
        p3, m3 = p_asd(rescale_legs(r, f2))
        print(f"  own motion, legs x{f2:.2f}                      p_asd={p3:.4f} margin={m3:+.2f}")
    pd0, md0 = p_asd(d)
    pd1, md1 = p_asd(transplant_legs(d, r))
    print(f"  donor original p_asd={pd0:.4f} margin={md0:+.2f} -> with recipient's legs p_asd={pd1:.4f} margin={md1:+.2f}")
