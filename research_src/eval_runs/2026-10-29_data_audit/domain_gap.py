"""So sánh domain Kinect25 (train base) và Dataset_video/OpenPose (fine-tune).

Đưa cả hai về đúng đầu vào model 18 khớp (layout kinect23) theo code train gốc:
  Kinect : _read_2d_excel_pairwise → bỏ khớp [1,9..14] → bbox từng frame → resample tuyến tính 128
  Video  : Excel wide → trim → BODY_25 → Kinect25 → bỏ khớp [1,9..14] → resample nearest 128 → bbox
rồi tính đặc trưng tư thế / xương / chuyển động / nhiễu, AUC phân biệt domain và hướng
khác biệt ASD–Typical trong từng domain. Ghi domain_features.csv, domain_gap_summary.csv,
domain_gap.png cạnh script.

    python domain_gap.py --root "E:/Scientific research 2025-2026/Linux_src_2/NCKH_25-26"
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupKFold, cross_val_predict
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

OUT = Path(__file__).resolve().parent
L = 128
REMOVE_18 = (1, 9, 10, 11, 12, 13, 14)
K25 = ["Head", "Neck", "SpineShoulder", "ShoulderLeft", "ShoulderRight", "ElbowLeft", "ElbowRight",
       "WristLeft", "WristRight", "ThumbLeft", "ThumbRight", "HandLeft", "HandRight", "HandTipLeft",
       "HandTipRight", "SpineMid", "SpineBase", "HipLeft", "HipRight", "KneeLeft", "KneeRight",
       "AnkleLeft", "AnkleRight", "FootLeft", "FootRight"]
K18 = [j for i, j in enumerate(K25) if i not in REMOVE_18]
J = {n: i for i, n in enumerate(K18)}
KINECT_DUP_DROP = {("ASD", 34), ("ASD", 18), ("ASD", 40), ("Typical", 7), ("Typical", 16), ("Typical", 20),
                   ("Typical", 29), ("Typical", 26), ("Typical", 40), ("Typical", 23), ("Typical", 28),
                   ("Typical", 14)}
KINECT_BROKEN = {("ASD", 8)}
VIDEO_DUP_DROP = {("Typical", i) for i in (32, 33, 44, 45, 47)}


def import_training(root: Path):
    argv = sys.argv[:]
    sys.argv = sys.argv[:1]
    sys.path.insert(0, str(root))
    import ULTIMATE_FINAL_TRAINING_ROUND as F  # noqa: E402
    import ULTIMATE_TRAINING_OPENPOSE_STGCN as O  # noqa: E402
    sys.argv = argv
    return F, O


def kinect_seq(F, path: Path):
    reader = F.__dict__[_dataset_class(F)]._read_2d_excel_pairwise
    raw = reader(None, path)  # (T,25,2) — hàm không dùng self
    keep = [i for i in range(25) if i not in REMOVE_18]
    x = F.normalize_by_bbox(raw[:, keep, :])
    return raw, F._resample_time(x, L)


def _dataset_class(F):
    for name, obj in vars(F).items():
        if isinstance(obj, type) and hasattr(obj, "_read_2d_excel_pairwise"):
            return name
    raise RuntimeError("không tìm thấy dataset class Kinect")


def video_seq(O, path: Path):
    xy, _ = O._parse_wide_excel(path, include_score=False)
    xy = O._trim_all_zero_ends(xy.astype(np.float32))
    if xy.shape[1] == 17:
        xy = O._expand_reduced_to_body25(xy, O.DEFAULT_EXCEL_REMOVED_KP)
    k25 = O._openpose25_to_kinect25(xy)
    keep = [i for i in range(25) if i not in REMOVE_18]
    x = O._resample_nearest(k25[:, keep, :], L)
    return k25, O._apply_normalization(x, "bbox")


# ------------------------------------------------------------------ features
def _d(x, a, b):
    return np.linalg.norm(x[:, J[a]] - x[:, J[b]], axis=-1)


def _dominant_cycles(sig):
    s = sig - sig.mean()
    if np.allclose(s, 0):
        return np.nan
    p = np.abs(np.fft.rfft(s * np.hanning(len(s)))) ** 2
    p[0] = 0
    return float(np.argmax(p[1:20]) + 1)  # số chu kỳ trong 128 frame


def features(raw25, x):
    """raw25: (T,25,2) toạ độ ảnh trước chuẩn hoá; x: (128,18,2) đầu vào model."""
    f = {}
    # trái/phải: x(vai trái) - x(vai phải) trên ảnh gốc, chuẩn theo bề rộng vai
    sl, sr = raw25[:, K25.index("ShoulderLeft"), 0], raw25[:, K25.index("ShoulderRight"), 0]
    hl, hr = raw25[:, K25.index("HipLeft"), 0], raw25[:, K25.index("HipRight"), 0]
    f["lr_shoulder_sign"] = float(np.median(np.sign(sl - sr)))
    f["lr_hip_sign"] = float(np.median(np.sign(hl - hr)))
    torso = _d(x, "SpineShoulder", "SpineBase")
    tm = np.median(torso)
    bones = {
        "shoulder_w": ("ShoulderLeft", "ShoulderRight"), "hip_w": ("HipLeft", "HipRight"),
        "upperarm": ("ShoulderLeft", "ElbowLeft"), "forearm": ("ElbowLeft", "WristLeft"),
        "thigh": ("HipLeft", "KneeLeft"), "shank": ("KneeLeft", "AnkleLeft"),
        "foot": ("AnkleLeft", "FootLeft"), "head_neck": ("Head", "SpineShoulder"),
        "spinemid_off": ("SpineMid", "SpineBase"), "hip_to_base": ("HipLeft", "SpineBase"),
    }
    for k, (a, b) in bones.items():
        f[f"bone_{k}"] = float(np.median(_d(x, a, b)) / (tm + 1e-9))
    f["torso_abs"] = float(tm)  # cạnh dài bbox = 2 → torso theo đơn vị bbox
    leg = 0.5 * (_d(x, "HipLeft", "KneeLeft") + _d(x, "KneeLeft", "AnkleLeft")
                 + _d(x, "HipRight", "KneeRight") + _d(x, "KneeRight", "AnkleRight"))
    f["leg_torso"] = float(np.median(leg / (torso + 1e-9)))
    # tư thế trung bình: vị trí y/x của vài khớp trong bbox [-1,1]
    for n in ("Head", "SpineShoulder", "SpineBase", "WristLeft", "KneeLeft", "AnkleLeft"):
        f[f"pos_y_{n}"] = float(np.median(x[:, J[n], 1]))
    f["pos_x_spread"] = float(np.median(x[:, :, 0].max(1) - x[:, :, 0].min(1)))  # bề ngang bbox (cạnh dài=2)
    f["pos_y_spread"] = float(np.median(x[:, :, 1].max(1) - x[:, :, 1].min(1)))
    # chuyển động
    v = np.diff(x, axis=0)
    a = np.diff(x, 2, axis=0)
    f["vel_mean"] = float(np.linalg.norm(v, axis=-1).mean())
    f["acc_mean"] = float(np.linalg.norm(a, axis=-1).mean())
    f["jitter_ratio"] = f["acc_mean"] / (f["vel_mean"] + 1e-9)
    f["frac_static_frames"] = float((np.linalg.norm(v, axis=-1).max(1) < 1e-6).mean())  # frame lặp (resample)
    ank = x[:, J["AnkleLeft"], 1] - x[:, J["AnkleRight"], 1]
    f["gait_cycles_in_clip"] = _dominant_cycles(ank)
    f["ankle_sep_amp"] = float(np.ptp(np.abs(x[:, J["AnkleLeft"]] - x[:, J["AnkleRight"]]).sum(-1)))
    f["wrist_swing"] = float(0.5 * (np.ptp(x[:, J["WristLeft"], 1]) + np.ptp(x[:, J["WristRight"], 1])))
    f["base_drift_x"] = float(np.ptp(x[:, J["SpineBase"], 0]))
    f["T_raw"] = int(raw25.shape[0])
    return f


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    root = Path(ap.parse_args().root)
    F, O = import_training(root)

    rows, seqs = [], {}
    kroot = root / "Datas/Kinect25_ASD/Kinect25_ASD_NoVideos"
    for label, g in (("ASD", kroot / "Autism/children with ASD"), ("Typical", kroot / "Typical")):
        for sdir in sorted((p for p in g.iterdir() if p.is_dir()), key=lambda p: int(p.name)):
            key = (label, int(sdir.name))
            if key in KINECT_DUP_DROP or key in KINECT_BROKEN:
                continue
            raw, x = kinect_seq(F, sdir / "video/8_2d.xlsx")
            rows.append(dict(domain="kinect", label=label, idx=key[1], group=f"k_{label}_{key[1]}", **features(raw, x)))
            seqs[("kinect", label, key[1])] = x
    vroot = root / "sub_phase/exports_excels/Dataset_video"
    for label, sub in (("ASD", "Autism"), ("Typical", "Typical")):
        for p in sorted((vroot / sub).glob("*.xlsx"), key=lambda p: int(p.stem)):
            key = (label, int(p.stem))
            if key in VIDEO_DUP_DROP:
                continue
            raw, x = video_seq(O, p)
            rows.append(dict(domain="video", label=label, idx=key[1], group=f"v_{label}_{key[1]}", **features(raw, x)))
            seqs[("video", label, key[1])] = x
    df = pd.DataFrame(rows)
    df.to_csv(OUT / "domain_features.csv", index=False)
    print(df.groupby(["domain", "label"]).size())

    feats = [c for c in df.columns if c not in ("domain", "label", "idx", "group")]
    y_dom = (df.domain == "video").astype(int)
    summ = []
    for c in feats:
        x = df[c].fillna(df[c].median())
        a = roc_auc_score(y_dom, x)
        r = dict(feature=c, kinect_med=df[df.domain == "kinect"][c].median(),
                 video_med=df[df.domain == "video"][c].median(), auc_domain=max(a, 1 - a))
        for dom in ("kinect", "video"):
            s = df[df.domain == dom]
            yy = (s.label == "ASD").astype(int)
            r[f"auc_asd_{dom}"] = roc_auc_score(yy, s[c].fillna(s[c].median()))  # >0.5: cao = ASD
        r["same_direction"] = (r["auc_asd_kinect"] - 0.5) * (r["auc_asd_video"] - 0.5) > 0
        summ.append(r)
    S = pd.DataFrame(summ).sort_values("auc_domain", ascending=False)
    S.to_csv(OUT / "domain_gap_summary.csv", index=False)
    pd.set_option("display.width", 250)
    print(S.round(3).to_string(index=False))

    # domain classifier trên toàn bộ đặc trưng (CV 5 fold theo mẫu, mỗi mẫu là một trẻ/clip)
    X = df[feats].fillna(df[feats].median()).to_numpy()
    clf = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, C=0.5))
    p = cross_val_predict(clf, X, y_dom, cv=GroupKFold(5), groups=df.group, method="predict_proba")[:, 1]
    print("domain classifier AUC (all features):", round(roc_auc_score(y_dom, p), 3))
    nosign = [c for c in feats if not c.startswith("lr_") and c != "T_raw"]
    Xn = df[nosign].fillna(df[nosign].median()).to_numpy()
    p = cross_val_predict(clf, Xn, y_dom, cv=GroupKFold(5), groups=df.group, method="predict_proba")[:, 1]
    print("domain classifier AUC (bỏ lr_sign, T_raw):", round(roc_auc_score(y_dom, p), 3))
    # classifier ASD train trên Kinect, thử trên video, và ngược lại
    for tr, te in (("kinect", "video"), ("video", "kinect")):
        a, b = df[df.domain == tr], df[df.domain == te]
        clf.fit(a[nosign].fillna(df[nosign].median()), (a.label == "ASD").astype(int))
        pb = clf.predict_proba(b[nosign].fillna(df[nosign].median()))[:, 1]
        print(f"đặc trưng ASD học trên {tr} → AUC trên {te}: {roc_auc_score((b.label == 'ASD').astype(int), pb):.3f}")

    plot(df, seqs)


def plot(df, seqs):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    edges = [("Head", "SpineShoulder"), ("SpineShoulder", "SpineMid"), ("SpineMid", "SpineBase"),
             ("SpineShoulder", "ShoulderLeft"), ("ShoulderLeft", "ElbowLeft"), ("ElbowLeft", "WristLeft"),
             ("SpineShoulder", "ShoulderRight"), ("ShoulderRight", "ElbowRight"), ("ElbowRight", "WristRight"),
             ("SpineBase", "HipLeft"), ("HipLeft", "KneeLeft"), ("KneeLeft", "AnkleLeft"), ("AnkleLeft", "FootLeft"),
             ("SpineBase", "HipRight"), ("HipRight", "KneeRight"), ("KneeRight", "AnkleRight"), ("AnkleRight", "FootRight")]
    fig, axes = plt.subplots(1, 3, figsize=(15, 6))
    colors = {("kinect", "ASD"): "#b45309", ("kinect", "Typical"): "#f59e0b",
              ("video", "ASD"): "#166534", ("video", "Typical"): "#4ade80"}
    ax = axes[0]
    for (dom, lab), col in colors.items():
        xs = np.stack([v for k, v in seqs.items() if k[0] == dom and k[1] == lab])
        m = np.median(xs.reshape(-1, len(K18), 2), axis=0)
        for a, b in edges:
            ax.plot([m[J[a], 0], m[J[b], 0]], [m[J[a], 1], m[J[b], 1]], color=col, lw=2,
                    label=f"{dom} {lab}" if (a, b) == edges[0] else None)
        ax.scatter(m[[J["ShoulderLeft"], J["HipLeft"], J["KneeLeft"]], 0],
                   m[[J["ShoulderLeft"], J["HipLeft"], J["KneeLeft"]], 1], color=col, marker="s", s=25)
    ax.invert_yaxis(); ax.set_aspect("equal"); ax.legend(fontsize=8)
    ax.set_title("Tư thế trung vị sau chuẩn hoá bbox (ô vuông = khớp TRÁI)")
    for ax, c in zip(axes[1:], ("gait_cycles_in_clip", "leg_torso")):
        for (dom, lab), col in colors.items():
            s = df[(df.domain == dom) & (df.label == lab)][c].dropna()
            ax.hist(s, bins=20, alpha=0.5, color=col, label=f"{dom} {lab}")
        ax.set_title(c); ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(OUT / "domain_gap.png", dpi=110)


if __name__ == "__main__":
    main()
