"""Audit dữ liệu train ST-GCN: Kinect25 (Al-Jubouri 2020) và Dataset_video (OpenPose).

Chỉ đọc dữ liệu, ghi CSV + summary vào thư mục của script.

    python audit_data.py --root "E:/Scientific research 2025-2026/Linux_src_2/NCKH_25-26"
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

import cv2
import numpy as np
import pandas as pd

OUT = Path(__file__).resolve().parent
CONF = 0.3

# OpenPose BODY_25
OP = dict(nose=0, neck=1, rsh=2, lsh=5, midhip=8, rhip=9, rknee=10, rank=11, lhip=12, lknee=13, lank=14)

KINECT_RENAME = {"Midspain": "SpineMid", "MidSpine": "SpineMid", "SpanBase": "SpineBase"}


# ---------------------------------------------------------------- geometry
def _dist(a, b):
    return np.linalg.norm(a - b, axis=-1)


def _knee_angle(hip, knee, ank):
    v1, v2 = hip - knee, ank - knee
    cos = (v1 * v2).sum(-1) / (np.linalg.norm(v1, axis=-1) * np.linalg.norm(v2, axis=-1) + 1e-9)
    return np.degrees(np.arccos(np.clip(cos, -1, 1)))


def body_metrics(neck, midhip, lhip, lknee, lank, rhip, rknee, rank, valid, img_h=None):
    """Mỗi tham số (T, 2|3). valid (T,) bool. Trả dict số liệu trung vị theo frame."""
    torso = _dist(neck, midhip)
    leg_l = _dist(lhip, lknee) + _dist(lknee, lank)
    leg_r = _dist(rhip, rknee) + _dist(rknee, rank)
    leg = 0.5 * (leg_l + leg_r)
    ratio = leg / (torso + 1e-9)
    knee = 0.5 * (_knee_angle(lhip, lknee, lank) + _knee_angle(rhip, rknee, rank))
    ank_y = 0.5 * (lank[:, 1] + rank[:, 1])
    # độ cao hông trên ảnh tính theo chiều cao cổ→cổ chân (2D, trục y hướng xuống)
    hip_frac = (ank_y - midhip[:, 1]) / (ank_y - neck[:, 1] + 1e-9)
    height = np.abs(ank_y - neck[:, 1])
    v = valid & np.isfinite(ratio) & (torso > 0)
    out = {"n_valid": int(v.sum())}
    if v.sum() == 0:
        return out
    r = ratio[v]
    out.update(
        ratio_med=float(np.median(r)),
        ratio_p10=float(np.percentile(r, 10)),
        frac_ratio_lt1=float((r < 1.0).mean()),
        knee_med=float(np.median(knee[v])),
        frac_knee_lt140=float((knee[v] < 140).mean()),
        hip_frac_med=float(np.median(hip_frac[v])),
    )
    if img_h:
        hv = height[v] / img_h
        out.update(height_frac_med=float(np.median(hv)), height_frac_max=float(hv.max()),
                   height_growth=float(np.median(hv[-max(1, len(hv) // 5):]) / (np.median(hv[: max(1, len(hv) // 5)]) + 1e-9)))
    return out


# ---------------------------------------------------------------- Kinect
def read_kinect(path: Path):
    df = pd.read_excel(path)
    cols = [str(c).strip() for c in df.columns]
    J = {}
    for i, c in enumerate(cols):
        if c.startswith("Unnamed") or i == 0 or c in ("MaxDBFE", "MinDBFE", "Threshold"):
            continue
        name = KINECT_RENAME.get(c, c)
        xyz = df.iloc[:, i : i + 3].apply(pd.to_numeric, errors="coerce").to_numpy(np.float64)
        J[name] = xyz
    return J, len(df)


def kinect_metrics(J, is2d):
    d = 2 if is2d else 3
    g = lambda n: J[n][:, :d]
    valid = np.ones(len(g("SpineBase")), bool)
    for n in ("SpineShoulder", "SpineBase", "HipLeft", "KneeLeft", "AnkleLeft", "HipRight", "KneeRight", "AnkleRight"):
        valid &= np.isfinite(g(n)).all(1)
    m = body_metrics(g("SpineShoulder"), g("SpineBase"), g("HipLeft"), g("KneeLeft"), g("AnkleLeft"),
                     g("HipRight"), g("KneeRight"), g("AnkleRight"), valid, img_h=1080 if is2d else None)
    if not is2d:  # 3D: trục y hướng lên → bỏ hip_frac (định nghĩa cho ảnh)
        m.pop("hip_frac_med", None)
        z = g("SpineBase")[:, 2]
        m["z_start"], m["z_end"] = float(z[0]), float(z[-1])
    return m


def audit_kinect(root: Path):
    base = root / "Datas/Kinect25_ASD/Kinect25_ASD_NoVideos"
    rows = []
    for label, gdir in (("ASD", base / "Autism/children with ASD"), ("Typical", base / "Typical")):
        for sdir in sorted((p for p in gdir.iterdir() if p.is_dir()), key=lambda p: int(p.name)):
            for f2d in sorted(sdir.rglob("*_2d.xlsx")):
                kind = "video" if "video" in f2d.parts else "aug"
                variant = f2d.parent.name if kind == "aug" else "orig"
                J2, T = read_kinect(f2d)
                row = dict(label=label, subject=int(sdir.name), kind=kind, variant=variant, T=T)
                row.update({f"px_{k}": v for k, v in kinect_metrics(J2, True).items()})
                arr = np.stack([J2[k][:, :2] for k in sorted(J2)], 1)
                row["hash2d"] = hashlib.md5(np.round(np.nan_to_num(arr), 2).tobytes()).hexdigest()[:12]
                f3d = f2d.with_name(f2d.name.replace("_2d", ""))
                if f3d.exists():
                    J3, _ = read_kinect(f3d)
                    row.update({f"m_{k}": v for k, v in kinect_metrics(J3, False).items()})
                rows.append(row)
        print(f"kinect {label}: done")
    return pd.DataFrame(rows)


# ---------------------------------------------------------------- OpenPose video
def md5(path: Path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_op_json(path: Path):
    d = json.load(open(path, encoding="utf-8"))
    frames = d["frames"]
    T = len(frames)
    main = np.zeros((T, 25, 3))
    n_people = np.zeros(T, int)
    for t, fr in enumerate(frames):
        people = fr.get("people", [])
        n_people[t] = len(people)
        best, best_s = None, -1
        for p in people:
            kp = np.zeros((25, 3))
            for k in p.get("body25", []):
                kp[k["id"]] = (k["x"], k["y"], k["confidence"])
            ys = kp[kp[:, 2] > CONF, 1]
            s = (ys.max() - ys.min()) if len(ys) > 1 else 0  # người cao nhất trên ảnh = người chính
            if s > best_s:
                best, best_s = kp, s
        if best is not None:
            main[t] = best
    return d, main, n_people


def op_metrics(main, n_people, h):
    c = main[:, :, 2]
    need = [OP[k] for k in ("neck", "midhip", "lhip", "lknee", "lank", "rhip", "rknee", "rank")]
    valid = (c[:, need] > CONF).all(1)
    g = lambda k: main[:, OP[k], :2]
    m = body_metrics(g("neck"), g("midhip"), g("lhip"), g("lknee"), g("lank"), g("rhip"), g("rknee"), g("rank"),
                     valid, img_h=h)
    has = (c > 0).any(1)
    m.update(frac_person=float(has.mean()), frac_multi=float((n_people > 1).mean()),
             frac_legs_ok=float(((c[:, [OP["lank"], OP["rank"]]] > CONF).all(1) & has).sum() / max(1, has.sum())),
             mean_conf=float(c[c > 0].mean()) if (c > 0).any() else 0.0)
    # dịch chuyển hông theo chiều ngang / dọc (đơn vị: chiều cao thân trung vị)
    if valid.sum() > 2:
        mh = g("midhip")[valid]
        hgt = np.median(np.abs(0.5 * (g("lank")[valid, 1] + g("rank")[valid, 1]) - g("neck")[valid, 1]))
        m["hip_dx_body"] = float(np.ptp(mh[:, 0]) / (hgt + 1e-9))
        m["hip_dy_body"] = float(np.ptp(mh[:, 1]) / (hgt + 1e-9))
    return m


def old_finetune_split(root: Path):
    """Dựng lại split của sub_phase/tools/fine_tune.py (seed 44, train 0.3, val ép = 1/lớp)."""
    ex = root / "sub_phase/exports_excels/Dataset_video"
    out = {}
    rng = np.random.default_rng(44)
    for label, sub in (("ASD", "Autism"), ("Typical", "Typical")):
        paths = sorted(p for p in (ex / sub).glob("*.xlsx"))
        rng.shuffle(paths)
        n = len(paths)
        n_tr = max(1, min(n - 2, int(round(n * 0.3))))
        n_va = max(1, min(n - n_tr - 1, 0))
        for i, p in enumerate(paths):
            out[(label, int(p.stem))] = "train" if i < n_tr else ("val_dropped" if i < n_tr + n_va else "test")
    return out


def audit_video(root: Path):
    vroot = root / "Datas/Kinect25_ASD_Video"
    split = old_finetune_split(root)
    rows = []
    for label, sub in (("ASD", "Autism"), ("Typical", "Typical")):
        for avi in sorted((vroot / "Dataset_video" / sub).glob("*.avi"), key=lambda p: int(re.findall(r"\d+", p.stem)[0])):
            idx = int(re.findall(r"\d+", avi.stem)[0])
            cap = cv2.VideoCapture(str(avi))
            row = dict(label=label, idx=idx, md5=md5(avi)[:12], size_kb=avi.stat().st_size // 1024,
                       fps=cap.get(cv2.CAP_PROP_FPS), w=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
                       h=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)), frames=int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
                       old_ft_split=split.get((label, idx), "missing"))
            cap.release()
            row["dur"] = row["frames"] / row["fps"] if row["fps"] else np.nan
            js = vroot / "Visualized_Results/keypoints" / sub / f"{avi.stem}.json"
            if js.exists():
                d, main, npp = load_op_json(js)
                row["json_frames"] = len(main)
                row.update(op_metrics(main, npp, row["h"]))
                kp = main[:, :, :2]
                row["kp_hash"] = hashlib.md5(np.round(kp, 0).tobytes()).hexdigest()[:12]
            rows.append(row)
        print(f"video {label}: done")
    return pd.DataFrame(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    args = ap.parse_args()
    root = Path(args.root)
    vid = audit_video(root)
    vid.to_csv(OUT / "video_audit.csv", index=False)
    kin = audit_kinect(root)
    kin.to_csv(OUT / "kinect_audit.csv", index=False)
    print("saved", OUT)


if __name__ == "__main__":
    main()
