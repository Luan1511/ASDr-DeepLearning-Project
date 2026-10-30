"""Why does the deployed ST-GCN call a recording ASD?

For each subject folder given: builds the exact model input the server builds
(tracking -> preprocessing -> Kinect layout -> 18 joints -> nearest resample ->
bbox normalisation), then

  * saliency: |d(logit_asd - logit_typical) / d input| * |input|, summed per
    joint and per body part, so we see which joints drive the decision;
  * ablations: arms pinned to the shoulders (no arm information), legs pinned
    to the hips, frames duplicated (30 -> 60 fps), mirror, no preprocessing.

Usage (inside the ML image, asdr mounted at the same path):
  python3 diagnose.py --api-dir .../ml/server --checkpoint ... --calibration ... subj_dir [subj_dir ...]
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
ap.add_argument("subjects", nargs="+")
args = ap.parse_args()

sys.path.insert(0, args.api_dir)
from services.stgcn_service import STGCNPredictor  # noqa: E402
from services.preprocessing import preprocess_skeleton_sequence  # noqa: E402
import openpose_excel_stgcn_pipeline as pl  # noqa: E402

pred = STGCNPredictor(checkpoint_path=Path(args.checkpoint), device="cuda" if torch.cuda.is_available() else "cpu")
cfg = pred.ckpt.get("config") or {}
norm = str(cfg.get("normalization", "original"))
T_cal = 1.0
thr = 0.5
if args.calibration and Path(args.calibration).is_file():
    c = json.load(open(args.calibration))
    T_cal, thr = float(c["temperature"]), float(c["threshold"])

# 18-joint (kinect23) names, in order after removing [1,9..14] from Kinect25
J18 = ["Head", "SpineShoulder", "ShoulderL", "ShoulderR", "ElbowL", "ElbowR", "WristL", "WristR",
       "SpineMid", "SpineBase", "HipL", "HipR", "KneeL", "KneeR", "AnkleL", "AnkleR", "FootL", "FootR"]
PART = {"head/trunk": [0, 1, 8, 9], "arms": [2, 3, 4, 5, 6, 7], "hips": [10, 11], "legs": [12, 13, 14, 15, 16, 17]}
OP = dict(RSh=2, REl=3, RWr=4, LSh=5, LEl=6, LWr=7, RHip=9, RKnee=10, RAnk=11, LHip=12, LKnee=13, LAnk=14,
          LToe=19, LSmall=20, LHeel=21, RToe=22, RSmall=23, RHeel=24)


def model_input(seq25: np.ndarray) -> np.ndarray:
    """(T,25,2) OpenPose xy after preprocessing -> (128,18,2) model input."""
    s = pl._trim_all_zero_ends(seq25)
    s = pl._openpose25_to_kinect25(s)
    s = pl._remove_joint_indices(s, pl.DEFAULT_REMOVE_TO_18)
    return pl._build_model_input(s, cfg=cfg, seq_len=pred.seq_len, normalization=norm, num_joints=18,
                                 resample=pl._resolve_resample(pred.resample, cfg))


def logits_of(x: np.ndarray, grad: bool = False):
    t = torch.from_numpy(x).float().unsqueeze(0).permute(0, 3, 1, 2).contiguous().to(pred.device)
    if grad:
        t.requires_grad_(True)
    out = pred.model(t)[0]
    if not grad:
        return out.detach().cpu().numpy(), None
    margin = out[1] - out[0]
    margin.backward()
    sal = (t.grad * t).abs()[0].sum(dim=0).detach().cpu().numpy()  # (T,V)
    return out.detach().cpu().numpy(), sal


def p_asd(lg):
    z = np.asarray(lg, dtype=np.float64) / T_cal
    e = np.exp(z - z.max())
    return float(e[1] / e.sum())


def load_frames(subj: Path):
    d = json.load(open(subj / "keypoints_body25.json"))
    return d["frames"], d["video"]


def pin(seq: np.ndarray, pairs):
    """Copy joint b onto joint a (a loses its own motion)."""
    out = seq.copy()
    for a, b in pairs:
        out[:, a, :] = out[:, b, :]
    return out


def report(name, lg):
    return f"{name:<26} p_asd={p_asd(lg):.4f} logit_asd-typ={lg[1]-lg[0]:+.2f}"


for sdir in args.subjects:
    sdir = Path(sdir)
    frames, video = load_frames(sdir)
    seq, conf, q = pred.frames_to_sequence(frames)
    seq_p = preprocess_skeleton_sequence(seq, confidences=conf, max_gap=pred.impute_max_gap, method=pred.impute_method)
    x = model_input(seq_p)
    lg, sal = logits_of(x, grad=True)
    print(f"\n#### {sdir.name}  {video['width']}x{video['height']} {video['fps']}fps T={seq.shape[0]}  "
          f"coverage={q['person_coverage']} conf={q['mean_keypoint_confidence']}")
    print(report("deployed", lg), f"(threshold {thr:.3f}, T={T_cal:.3f})")
    zeros = float(((x[..., 0] == x[..., 0].min()) & (x[..., 1] == x[..., 1].min())).mean())
    print(f"  model input: x[{x[...,0].min():.2f},{x[...,0].max():.2f}] y[{x[...,1].min():.2f},{x[...,1].max():.2f}]"
          f"  frames with a (0,0) joint before norm: {int((np.abs(seq_p).sum(axis=2) == 0).any(axis=1).sum())}/{seq_p.shape[0]}")

    # saliency per part / joint
    per_joint = sal.sum(axis=0)
    per_joint = per_joint / per_joint.sum()
    parts = {k: float(per_joint[v].sum()) for k, v in PART.items()}
    print("  saliency by part: " + ", ".join(f"{k} {v*100:.0f}%" for k, v in parts.items()))
    top = np.argsort(per_joint)[::-1][:6]
    print("  top joints: " + ", ".join(f"{J18[j]} {per_joint[j]*100:.0f}%" for j in top))

    # posture facts from the model input (normalised, y down)
    wrist_y = x[:, [6, 7], 1].mean()
    hip_y = x[:, [10, 11], 1].mean()
    sh_y = x[:, [2, 3], 1].mean()
    arm_swing = float(np.std(x[:, [6, 7], 0] - x[:, [2, 3], 0]))
    wrist_sep = float(np.mean(np.abs(x[:, 6, 0] - x[:, 7, 0])))
    sh_sep = float(np.mean(np.abs(x[:, 2, 0] - x[:, 3, 0])))
    ankle_sw = float(np.std(x[:, [14, 15], 1]))
    print(f"  posture: wrists at {((wrist_y - sh_y) / max(hip_y - sh_y, 1e-6)):.2f} of shoulder->hip height "
          f"(1.0 = hip level), wrist separation/shoulder width {wrist_sep / max(sh_sep, 1e-6):.2f}, "
          f"arm swing std {arm_swing:.3f}, ankle vertical std {ankle_sw:.3f}")

    # ablations (on the preprocessed 25-joint sequence)
    var = {}
    var["arms pinned to shoulders"] = pin(seq_p, [(OP["REl"], OP["RSh"]), (OP["RWr"], OP["RSh"]), (OP["LEl"], OP["LSh"]), (OP["LWr"], OP["LSh"])])
    var["legs pinned to hips"] = pin(seq_p, [(OP["RKnee"], OP["RHip"]), (OP["RAnk"], OP["RHip"]), (OP["LKnee"], OP["LHip"]), (OP["LAnk"], OP["LHip"]),
                                            (OP["RToe"], OP["RHip"]), (OP["RHeel"], OP["RHip"]), (OP["RSmall"], OP["RHip"]),
                                            (OP["LToe"], OP["LHip"]), (OP["LHeel"], OP["LHip"]), (OP["LSmall"], OP["LHip"])])
    var["frames duplicated (x2 fps)"] = np.repeat(seq_p, 2, axis=0)
    var["every 2nd frame (/2 fps)"] = seq_p[::2]
    m = seq_p.copy(); m[..., 0] = np.where(np.abs(m).sum(axis=2) > 0, video["width"] - m[..., 0], 0.0)
    var["mirror"] = m
    var["no preprocessing"] = seq
    half = seq_p.shape[0] // 2
    var["first half only"] = seq_p[:half]
    var["second half only"] = seq_p[half:]
    for name, s in var.items():
        lgv, _ = logits_of(model_input(s))
        print("  " + report(name, lgv))
