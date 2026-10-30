"""Is the model mostly reading a static shape cue? For every recording:
leg/torso ratio (projected, pixels), knee angle, and the model's raw logit
margin. Then: correlation margin ~ leg/torso, and AUC of leg/torso ALONE for
ASD vs Typical, versus the model's AUC on the same recordings."""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch

ap = argparse.ArgumentParser()
ap.add_argument("--api-dir", required=True)
ap.add_argument("--checkpoint", required=True)
ap.add_argument("--root", required=True)
ap.add_argument("--splits", required=True)
ap.add_argument("--extra", nargs="*", default=[])
args = ap.parse_args()

sys.path.insert(0, args.api_dir)
from services.stgcn_service import STGCNPredictor  # noqa: E402
from services.preprocessing import preprocess_skeleton_sequence  # noqa: E402
import openpose_excel_stgcn_pipeline as pl  # noqa: E402

pred = STGCNPredictor(checkpoint_path=Path(args.checkpoint), device="cuda" if torch.cuda.is_available() else "cpu")
cfg = pred.ckpt.get("config") or {}
norm = str(cfg.get("normalization", "original"))
ROOT = Path(args.root)
NOSE, NECK, MIDHIP, RHIP, RKNEE, RANK, LHIP, LKNEE, LANK = 0, 1, 8, 9, 10, 11, 12, 13, 14


def margin(seq25):
    s = pl._trim_all_zero_ends(seq25)
    s = pl._openpose25_to_kinect25(s)
    s = pl._remove_joint_indices(s, pl.DEFAULT_REMOVE_TO_18)
    x = pl._build_model_input(s, cfg=cfg, seq_len=pred.seq_len, normalization=norm, num_joints=18,
                              resample=pl._resolve_resample(pred.resample, cfg))
    t = torch.from_numpy(x).float().unsqueeze(0).permute(0, 3, 1, 2).contiguous().to(pred.device)
    with torch.no_grad():
        lg = pred.model(t)[0].cpu().numpy().astype(np.float64)
    return float(lg[1] - lg[0])


def load(name):
    frames = json.load(open(ROOT / name / "keypoints_body25.json"))["frames"]
    seq, conf, _ = pred.frames_to_sequence(frames)
    return preprocess_skeleton_sequence(seq, confidences=conf, max_gap=pred.impute_max_gap, method=pred.impute_method)


def v(seq, j):
    return np.abs(seq[:, j]).sum(axis=1) > 0


def angle(a, b, c):
    u, w = a - b, c - b
    cos = (u * w).sum(axis=1) / np.maximum(np.linalg.norm(u, axis=1) * np.linalg.norm(w, axis=1), 1e-6)
    return np.degrees(np.arccos(np.clip(cos, -1, 1)))


def feats(seq):
    torso = np.linalg.norm(seq[:, NECK] - seq[:, MIDHIP], axis=1)
    out = {}
    ok = v(seq, NECK) & v(seq, MIDHIP) & v(seq, RHIP) & v(seq, RANK) & v(seq, LHIP) & v(seq, LANK)
    leg = 0.5 * (np.linalg.norm(seq[:, RANK] - seq[:, RHIP], axis=1) + np.linalg.norm(seq[:, LANK] - seq[:, LHIP], axis=1))
    out["leg_torso"] = float(np.median(leg[ok] / np.maximum(torso[ok], 1e-3))) if ok.any() else np.nan
    okk = ok & v(seq, RKNEE) & v(seq, LKNEE)
    knee = 0.5 * (angle(seq[:, RHIP], seq[:, RKNEE], seq[:, RANK]) + angle(seq[:, LHIP], seq[:, LKNEE], seq[:, LANK]))
    out["knee_deg"] = float(np.median(knee[okk])) if okk.any() else np.nan
    okh = v(seq, NOSE) & v(seq, MIDHIP) & v(seq, RANK) & v(seq, LANK)
    height = 0.5 * (seq[:, RANK, 1] + seq[:, LANK, 1]) - seq[:, NOSE, 1]
    out["torso_height"] = float(np.median(torso[okh] / np.maximum(height[okh], 1e-3))) if okh.any() else np.nan
    return out


def auc(y, s):
    y, s = np.asarray(y), np.asarray(s)
    pos, neg = s[y == 1], s[y == 0]
    return float(((pos[:, None] > neg[None, :]).mean() + 0.5 * (pos[:, None] == neg[None, :]).mean()))


splits = json.load(open(args.splits))
split_of = {}
for smp in splits["samples"]:
    split_of[Path(smp["path"]).parent.name] = smp["split"]

rows = []
for d in sorted(ROOT.glob("calib-*")) + [ROOT / e for e in args.extra]:
    seq = load(d.name)
    f = feats(seq)
    label = 1 if "-Autism-" in d.name else (0 if "-Typical-" in d.name else -1)
    rows.append(dict(name=d.name, label=label, split=split_of.get(d.name, "debug"), margin=margin(seq), **f))

print("name,label,split,margin,leg_torso,knee_deg,torso_height")
for r in rows:
    print(f"{r['name']},{r['label']},{r['split']},{r['margin']:.2f},{r['leg_torso']:.3f},{r['knee_deg']:.1f},{r['torso_height']:.3f}")

cal = [r for r in rows if r["label"] >= 0 and np.isfinite(r["leg_torso"])]
y = [r["label"] for r in cal]
lt = np.array([r["leg_torso"] for r in cal])
mg = np.array([r["margin"] for r in cal])
kn = np.array([r["knee_deg"] for r in cal])
print("\n== over all calibration recordings (n=%d)" % len(cal))
for g, lab in (("Typical", 0), ("ASD", 1)):
    sel = np.array(y) == lab
    print(f"  {g:<8} leg/torso median {np.median(lt[sel]):.2f} [{np.percentile(lt[sel],10):.2f}, {np.percentile(lt[sel],90):.2f}]"
          f"  knee {np.nanmedian(kn[sel]):.0f} deg  margin median {np.median(mg[sel]):+.2f}")
print(f"  Pearson r(margin, leg/torso) = {np.corrcoef(mg, lt)[0,1]:+.2f}   r(margin, knee) = {np.corrcoef(mg, kn)[0,1]:+.2f}")
print(f"  AUC model margin: {auc(y, mg):.3f}   AUC of -leg/torso alone: {auc(y, -lt):.3f}   AUC of -knee angle alone: {auc(y, -kn):.3f}")
held = [i for i, r in enumerate(cal) if r["split"] in ("val", "test")]
if held:
    yh = [y[i] for i in held]
    print(f"  val+test (n={len(held)}): AUC model {auc(yh, mg[held]):.3f} | -leg/torso alone {auc(yh, -lt[held]):.3f} | -knee alone {auc(yh, -kn[held]):.3f}")
for r in rows:
    if r["label"] < 0:
        print(f"  {r['name']}: leg/torso {r['leg_torso']:.2f}, knee {r['knee_deg']:.0f} deg, margin {r['margin']:+.2f}")
