"""Causal check: transplant the arm trajectories of a donor recording onto a
recipient (arms expressed relative to the shoulders, scaled by shoulder width,
time-resampled), and see how p_asd moves. Also lists which joints are (0,0)
per frame after preprocessing, in the 18-joint model layout."""
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
ap.add_argument("--pairs", nargs="+", required=True, help="recipient:donor subject dirs")
args = ap.parse_args()

sys.path.insert(0, args.api_dir)
from services.stgcn_service import STGCNPredictor  # noqa: E402
from services.preprocessing import preprocess_skeleton_sequence  # noqa: E402
import openpose_excel_stgcn_pipeline as pl  # noqa: E402

pred = STGCNPredictor(checkpoint_path=Path(args.checkpoint), device="cuda" if torch.cuda.is_available() else "cpu")
cfg = pred.ckpt.get("config") or {}
norm = str(cfg.get("normalization", "original"))
T_cal = 1.0
if args.calibration and Path(args.calibration).is_file():
    T_cal = float(json.load(open(args.calibration))["temperature"])

J18 = ["Head", "SpineShoulder", "ShoulderL", "ShoulderR", "ElbowL", "ElbowR", "WristL", "WristR",
       "SpineMid", "SpineBase", "HipL", "HipR", "KneeL", "KneeR", "AnkleL", "AnkleR", "FootL", "FootR"]
RSH, REL, RWR, LSH, LEL, LWR = 2, 3, 4, 5, 6, 7
ARM = [REL, RWR, LEL, LWR]


def to18(seq25):
    s = pl._trim_all_zero_ends(seq25)
    s = pl._openpose25_to_kinect25(s)
    return pl._remove_joint_indices(s, pl.DEFAULT_REMOVE_TO_18)


def model_input(seq25):
    return pl._build_model_input(to18(seq25), cfg=cfg, seq_len=pred.seq_len, normalization=norm, num_joints=18,
                                 resample=pl._resolve_resample(pred.resample, cfg))


def p_asd(seq25):
    x = model_input(seq25)
    t = torch.from_numpy(x).float().unsqueeze(0).permute(0, 3, 1, 2).contiguous().to(pred.device)
    with torch.no_grad():
        lg = pred.model(t)[0].cpu().numpy().astype(np.float64)
    z = lg / T_cal
    e = np.exp(z - z.max())
    return float(e[1] / e.sum()), float(lg[1] - lg[0])


def load(subj):
    frames = json.load(open(Path(subj) / "keypoints_body25.json"))["frames"]
    seq, conf, _ = pred.frames_to_sequence(frames)
    return preprocess_skeleton_sequence(seq, confidences=conf, max_gap=pred.impute_max_gap, method=pred.impute_method)


def resample_T(seq, T):
    idx = np.clip(np.rint(np.linspace(0, seq.shape[0] - 1, T)).astype(int), 0, seq.shape[0] - 1)
    return seq[idx]


def shoulder_frame(seq):
    """shoulder centre (T,2) and width (T,) from a 25-joint sequence."""
    c = 0.5 * (seq[:, RSH] + seq[:, LSH])
    w = np.linalg.norm(seq[:, RSH] - seq[:, LSH], axis=1)
    return c, np.maximum(w, 1e-3)


def transplant_arms(recipient, donor):
    d = resample_T(donor, recipient.shape[0])
    rc, rw = shoulder_frame(recipient)
    dc, dw = shoulder_frame(d)
    out = recipient.copy()
    for j in ARM:
        rel = (d[:, j] - dc) / dw[:, None]
        out[:, j] = rc + rel * rw[:, None]
    return out


def zero_report(seq25):
    s18 = to18(seq25)
    z = (np.abs(s18).sum(axis=2) == 0)
    per_joint = z.sum(axis=0)
    items = [f"{J18[j]}={int(per_joint[j])}" for j in np.argsort(per_joint)[::-1] if per_joint[j] > 0]
    return f"frames with any (0,0) joint in the 18-joint input: {int(z.any(axis=1).sum())}/{s18.shape[0]}; per joint: " + (", ".join(items) or "none")


for pair in args.pairs:
    r_dir, d_dir = pair.split(":")
    r, d = load(r_dir), load(d_dir)
    rn, dn = Path(r_dir).name, Path(d_dir).name
    print(f"\n#### recipient {rn}  (donor arms from {dn})")
    print("  " + zero_report(r))
    p0, m0 = p_asd(r)
    p1, m1 = p_asd(transplant_arms(r, d))
    print(f"  original                 p_asd={p0:.4f} margin={m0:+.2f}")
    print(f"  with donor's arms        p_asd={p1:.4f} margin={m1:+.2f}")
    # symmetric check: donor gets recipient's arms
    pd0, md0 = p_asd(d)
    pd1, md1 = p_asd(transplant_arms(d, r))
    print(f"  donor {dn}: original p_asd={pd0:.4f} margin={md0:+.2f} -> with {rn}'s arms p_asd={pd1:.4f} margin={md1:+.2f}")
