"""Thử các bước sửa domain Kinect ↔ video và đo lại độ lệch (ablation).

Mỗi cấu hình áp dụng dồn các bước sửa, đưa cả hai bộ về (128, 18, 2), tính đặc trưng như
domain_gap.py (bỏ T_raw vì model không thấy), rồi đo:
  - AUC bộ phân loại domain (logistic, CV 5 fold theo trẻ/clip) trên đặc trưng tóm tắt;
  - AUC bộ phân loại domain trên tư thế trung bình + biên độ chuyển động từng khớp;
  - số đặc trưng còn lệch mạnh (AUC domain đơn lẻ > 0,8).
Ghi domain_fix_results.csv, domain_fix_features_<cfg>.csv cạnh script.

    python domain_fix.py --root "E:/Scientific research 2025-2026/Linux_src_2/NCKH_25-26"
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.signal import find_peaks, medfilt
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupKFold, cross_val_predict
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

import domain_gap as G

OUT = Path(__file__).resolve().parent
KEEP = [i for i in range(25) if i not in G.REMOVE_18]
J = G.J
L = G.L


# ------------------------------------------------------------------ bước sửa
def interp_missing(seq):
    """Khớp = (0,0) → nội suy tuyến tính theo thời gian (giữ đầu/cuối bằng giá trị gần nhất)."""
    out = seq.copy()
    T = len(out)
    t = np.arange(T)
    for j in range(out.shape[1]):
        ok = np.abs(out[:, j]).sum(-1) > 0
        if ok.sum() == 0 or ok.all():
            continue
        for c in range(2):
            out[:, j, c] = np.interp(t, t[ok], out[ok, j, c])
    return out


def smooth(seq):
    out = seq.copy()
    for j in range(out.shape[1]):
        for c in range(2):
            out[:, j, c] = medfilt(out[:, j, c], 5)
    return out


def one_gait_cycle(seq, fps):
    """Cắt 1 chu kỳ bước: giữa đỉnh khoảng cách hai cổ chân thứ k và k+2 (giống cách tác giả Kinect).
    seq (T,18,2). Trả (đoạn, ok)."""
    torso = np.median(np.linalg.norm(seq[:, J["SpineShoulder"]] - seq[:, J["SpineBase"]], axis=-1)) + 1e-9
    d = np.linalg.norm(seq[:, J["AnkleLeft"]] - seq[:, J["AnkleRight"]], axis=-1) / torso
    if len(d) >= 7:
        d = np.convolve(d, np.ones(5) / 5, mode="same")
    pk, _ = find_peaks(d, distance=max(2, int(0.2 * fps)), prominence=0.05)
    if len(pk) >= 3:
        # chọn chu kỳ có độ dài gần 1 giây nhất (trẻ em ~0,8–1,2 s)
        cand = [(abs((pk[i + 2] - pk[i]) / fps - 1.0), pk[i], pk[i + 2]) for i in range(len(pk) - 2)]
        _, a, b = min(cand)
        return seq[a : b + 1], True
    return seq, False


def bbox_norm(x):
    return G_F.normalize_by_bbox(x)


def torso_norm(x):
    """Tâm = SpineBase từng frame, chia cho chiều dài thân trung vị của clip (giữ tỉ lệ dọc/ngang)."""
    c = x[:, J["SpineBase"] : J["SpineBase"] + 1, :]
    torso = np.median(np.linalg.norm(x[:, J["SpineShoulder"]] - x[:, J["SpineBase"]], axis=-1)) + 1e-9
    return (x - c) / torso


def resample_linear(x, n=L):
    return G_F._resample_time(x.astype(np.float32), n)


# ------------------------------------------------------------------ pipeline theo cấu hình
CONFIGS = [
    ("0_hien_tai", dict()),
    ("1_lat_guong", dict(mirror=True)),
    ("2_+noi_suy_khop", dict(mirror=True, interp=True)),
    ("3_+loc_nhieu", dict(mirror=True, interp=True, smooth=True)),
    ("4_+1_chu_ky_buoc", dict(mirror=True, interp=True, smooth=True, cycle=True)),
    ("5_+resample_tuyen_tinh", dict(mirror=True, interp=True, smooth=True, cycle=True, linear=True)),
    ("6_+chuan_hoa_than", dict(mirror=True, interp=True, smooth=True, cycle=True, linear=True, torso=True)),
    ("7_bbox+spinemid_tong_hop", dict(mirror=True, interp=True, smooth=True, cycle=True, linear=True, spinemid=True)),
    ("8_+chinh_xuong_kinect", dict(mirror=True, interp=True, smooth=True, cycle=True, linear=True, spinemid=True,
                                   retarget=True)),
]

# cây khớp (cha → con) từ SpineBase, dùng để chỉnh độ dài xương
TREE = [("SpineBase", "SpineShoulder"), ("SpineShoulder", "Head"),
        ("SpineShoulder", "ShoulderLeft"), ("ShoulderLeft", "ElbowLeft"), ("ElbowLeft", "WristLeft"),
        ("SpineShoulder", "ShoulderRight"), ("ShoulderRight", "ElbowRight"), ("ElbowRight", "WristRight"),
        ("SpineBase", "HipLeft"), ("HipLeft", "KneeLeft"), ("KneeLeft", "AnkleLeft"), ("AnkleLeft", "FootLeft"),
        ("SpineBase", "HipRight"), ("HipRight", "KneeRight"), ("KneeRight", "AnkleRight"), ("AnkleRight", "FootRight")]
RETARGET = {}  # bone → hệ số (trung vị video / trung vị Kinect, theo tỉ lệ với thân), tính trong main()


def bone_ratios(x):
    torso = np.median(np.linalg.norm(x[:, J["SpineShoulder"]] - x[:, J["SpineBase"]], axis=-1)) + 1e-9
    return {(a, b): np.median(np.linalg.norm(x[:, J[b]] - x[:, J[a]], axis=-1)) / torso for a, b in TREE[1:]}


def retarget(x):
    out = x.copy()
    for a, b in TREE[1:]:  # cha luôn đứng trước con trong TREE
        off = x[:, J[b]] - x[:, J[a]]
        out[:, J[b]] = out[:, J[a]] + off * RETARGET[(a, b)]
    return out


def synth_spinemid(x):
    x = x.copy()
    x[:, J["SpineMid"]] = 0.5 * (x[:, J["SpineShoulder"]] + x[:, J["SpineBase"]])
    return x


def prep_kinect(raw25, cfg):
    x = raw25[:, KEEP, :].astype(np.float32)
    if cfg.get("mirror"):
        x = x.copy()
        x[..., 0] = -x[..., 0]
    if cfg.get("retarget"):
        x = retarget(x)
    if cfg.get("spinemid"):
        x = synth_spinemid(x)
    if cfg.get("torso"):
        return resample_linear(torso_norm(x))
    return resample_linear(bbox_norm(x))  # Kinect luôn: chuẩn hoá rồi resample tuyến tính (code gốc)


def prep_video(k25, cfg):
    x = k25[:, KEEP, :].astype(np.float32)
    ok = True
    if cfg.get("interp"):
        x = interp_missing(x)
    if cfg.get("smooth"):
        x = smooth(x)
    if cfg.get("cycle"):
        x = x[::2]  # 60 → 30 fps như Kinect
        x, ok = one_gait_cycle(x, 30.0)
    if cfg.get("torso"):
        x = torso_norm(x)
        return resample_linear(x), ok
    if cfg.get("linear"):
        return resample_linear(bbox_norm(x)), ok
    return G_O._apply_normalization(G_O._resample_nearest(x, L), "bbox"), ok


def feats_from(x):
    f = G.features(np.zeros((1, 25, 2)), x)  # raw không dùng nữa → tính lr từ x
    for k in ("lr_shoulder_sign", "lr_hip_sign", "T_raw"):
        f.pop(k, None)
    f["lr_shoulder"] = float(np.median(x[:, J["ShoulderLeft"], 0] - x[:, J["ShoulderRight"], 0]))
    f["lr_hip"] = float(np.median(x[:, J["HipLeft"], 0] - x[:, J["HipRight"], 0]))
    return f


def pose_vec(x):
    """Tư thế trung bình + biên độ chuyển động từng khớp (đầu vào gần với cái model thấy)."""
    return np.concatenate([x.mean(0).ravel(), x.std(0).ravel(), np.abs(np.diff(x, axis=0)).mean(0).ravel()])


def domain_auc(X, y, groups):
    clf = make_pipeline(StandardScaler(), LogisticRegression(max_iter=4000, C=0.1))
    p = cross_val_predict(clf, X, y, cv=GroupKFold(5), groups=groups, method="predict_proba")[:, 1]
    return roc_auc_score(y, p)


def main():
    global G_F, G_O
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    root = Path(ap.parse_args().root)
    G_F, G_O = G.import_training(root)

    # đọc dữ liệu thô một lần
    kin, vid = [], []
    kroot = root / "Datas/Kinect25_ASD/Kinect25_ASD_NoVideos"
    reader = G_F.__dict__[G._dataset_class(G_F)]._read_2d_excel_pairwise
    for label, g in (("ASD", kroot / "Autism/children with ASD"), ("Typical", kroot / "Typical")):
        for sdir in sorted((p for p in g.iterdir() if p.is_dir()), key=lambda p: int(p.name)):
            key = (label, int(sdir.name))
            if key in G.KINECT_DUP_DROP or key in G.KINECT_BROKEN:
                continue
            kin.append((label, key[1], reader(None, sdir / "video/8_2d.xlsx")))
    vroot = root / "sub_phase/exports_excels/Dataset_video"
    for label, sub in (("ASD", "Autism"), ("Typical", "Typical")):
        for p in sorted((vroot / sub).glob("*.xlsx"), key=lambda p: int(p.stem)):
            key = (label, int(p.stem))
            if key in G.VIDEO_DUP_DROP:
                continue
            xy, _ = G_O._parse_wide_excel(p)
            xy = G_O._trim_all_zero_ends(xy.astype(np.float32))
            if xy.shape[1] == 17:
                xy = G_O._expand_reduced_to_body25(xy, G_O.DEFAULT_EXCEL_REMOVED_KP)
            vid.append((label, key[1], G_O._openpose25_to_kinect25(xy)))

    # hệ số chỉnh xương: so trung vị tỉ lệ xương/thân của hai domain (sau nội suy khớp thiếu ở video)
    kr = pd.DataFrame([bone_ratios(raw[:, KEEP, :]) for _, _, raw in kin]).median()
    vr = pd.DataFrame([bone_ratios(interp_missing(raw[:, KEEP, :])) for _, _, raw in vid]).median()
    RETARGET.update((vr / kr).to_dict())
    print("hệ số chỉnh xương:", {f"{a}->{b}": round(v, 2) for (a, b), v in RETARGET.items()})

    results = []
    for name, cfg in CONFIGS:
        rows, poses = [], []
        n_cycle = 0
        for label, idx, raw in kin:
            x = prep_kinect(raw, cfg)
            rows.append(dict(domain="kinect", label=label, group=f"k{label}{idx}", **feats_from(x)))
            poses.append(pose_vec(x))
        for label, idx, raw in vid:
            x, ok = prep_video(raw, cfg)
            n_cycle += ok
            rows.append(dict(domain="video", label=label, group=f"v{label}{idx}", **feats_from(x)))
            poses.append(pose_vec(x))
        df = pd.DataFrame(rows)
        df.to_csv(OUT / f"domain_fix_features_{name}.csv", index=False)
        feats = [c for c in df.columns if c not in ("domain", "label", "group")]
        y = (df.domain == "video").astype(int).to_numpy()
        Xf = df[feats].fillna(df[feats].median()).to_numpy()
        single = {c: max(a, 1 - a) for c in feats for a in [roc_auc_score(y, df[c].fillna(df[c].median()))]}
        worst = sorted(single.items(), key=lambda kv: -kv[1])[:5]
        r = dict(config=name, auc_domain_features=domain_auc(Xf, y, df.group),
                 auc_domain_pose=domain_auc(np.stack(poses), y, df.group),
                 n_feat_gt_0_8=sum(v > 0.8 for v in single.values()), n_feat=len(feats),
                 video_cycle_found=f"{n_cycle}/{len(vid)}" if cfg.get("cycle") else "",
                 worst=", ".join(f"{k}={v:.2f}" for k, v in worst))
        # tín hiệu ASD có chuyển được giữa hai domain không
        for tr, te in (("kinect", "video"), ("video", "kinect")):
            a, b = df[df.domain == tr], df[df.domain == te]
            clf = make_pipeline(StandardScaler(), LogisticRegression(max_iter=4000, C=0.5))
            clf.fit(a[feats].fillna(df[feats].median()), (a.label == "ASD").astype(int))
            pb = clf.predict_proba(b[feats].fillna(df[feats].median()))[:, 1]
            r[f"asd_{tr}_to_{te}"] = roc_auc_score((b.label == "ASD").astype(int), pb)
        results.append(r)
        print(name, {k: (round(v, 3) if isinstance(v, float) else v) for k, v in r.items() if k != "config"})
    pd.DataFrame(results).to_csv(OUT / "domain_fix_results.csv", index=False)

    # phần lệch còn lại (cấu hình cuối) là do tiền xử lý hay do cách quay? So Kinect với từng nhóm video,
    # và đặt cạnh mức tách được giữa hai nhãn trong cùng domain để biết 0,9x nghĩa là gì.
    P = np.stack(poses)
    vm = pd.read_csv(OUT / "video_audit_merged.csv")[["label", "idx", "cam"]]
    cam = {(r.label, r.idx): r.cam for r in vm.itertuples()}
    df["cam"] = [cam.get((l, int(g[len("v" + l):])), "") if d == "video" else "kinect"
                 for d, l, g in zip(df.domain, df.label, df.group)]
    df["cycle_ok"] = [True] * len(kin) + [prep_video(raw, CONFIGS[-1][1])[1] for _, _, raw in vid]
    print("\nphân tách tư thế (pose vector, cấu hình cuối):")
    subsets = {
        "Kinect vs video Typical (cố định)": (df.domain == "kinect") | ((df.cam == "static") & (df.label == "Typical")),
        "Kinect vs video ASD cố định": (df.domain == "kinect") | ((df.cam == "static") & (df.label == "ASD")),
        "Kinect vs video ASD cầm tay": (df.domain == "kinect") | ((df.cam == "handheld") & (df.label == "ASD")),
        "Kinect vs video có chu kỳ bước": (df.domain == "kinect") | ((df.domain == "video") & df.cycle_ok),
    }
    for nm, m in subsets.items():
        m = m.to_numpy()
        yy = (df.domain[m] == "video").astype(int).to_numpy()
        print(f"  {nm}: n_video={yy.sum()}  AUC={domain_auc(P[m], yy, df.group[m]):.3f}")
    for d in ("kinect", "video"):
        m = (df.domain == d).to_numpy()
        yy = (df.label[m] == "ASD").astype(int).to_numpy()
        print(f"  mốc so sánh — ASD vs Typical trong {d}: AUC={domain_auc(P[m], yy, df.group[m]):.3f}")


if __name__ == "__main__":
    main()
