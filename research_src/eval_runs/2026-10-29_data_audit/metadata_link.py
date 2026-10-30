"""Ghép metadata readme (tuổi, giới, chiều cao) ↔ thư mục Kinect ↔ Dataset_video, kiểm tra nhiễu theo tuổi/giới.

- Metadata lấy từ bảng trong readme.docx của bộ Dryad (doi:10.5061/dryad.s7h44j150).
  Cột "Length" của Typical là feet (2,5–5,0), của ASD là mét → đổi Typical sang mét.
- Kiểm tra "Case k" = thư mục k bằng tương quan chiều cao metadata với chiều cao đo từ Kinect 3D.
- Dataset_video được ghép với thư mục gốc qua md5 (orig_color_videos.csv).

    python metadata_link.py --dataset "E:/JupyterWorkspace/NCKH/Dataset/Dataset"
Ghi metadata_linked.csv cạnh script.
"""
from __future__ import annotations

import argparse
import re
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

OUT = Path(__file__).resolve().parent
FT = 0.3048


def readme_tables(docx: Path):
    x = zipfile.ZipFile(docx).read("word/document.xml").decode("utf8")
    out = []
    for t in re.findall(r"<w:tbl>.*?</w:tbl>", x, flags=re.S):
        rows = []
        for r in re.findall(r"<w:tr[ >].*?</w:tr>", t, flags=re.S):
            rows.append([re.sub(r"<[^>]+>", "", c).strip() for c in re.findall(r"<w:tc>.*?</w:tc>", r, flags=re.S)])
        out.append(rows)
    return out


def meta(docx: Path):
    tabs = readme_tables(docx)
    frames = []
    for tab, label in ((tabs[2], "Typical"), (tabs[3], "ASD")):
        df = pd.DataFrame(tab[1:], columns=tab[0])
        df["subject"] = df["ID"].str.extract(r"(\d+)").astype(int)
        df["label"] = label
        df["age"] = df["Age(years)"].astype(float)
        df["sex"] = df["Gender"]
        L = df["Length(m)"].astype(float)
        df["height_m"] = L * FT if label == "Typical" else L
        frames.append(df[["label", "subject", "sex", "age", "height_m"]])
    return pd.concat(frames, ignore_index=True)


def kinect_height(xlsx: Path):
    d = pd.read_excel(xlsx)
    cols = [str(c) for c in d.columns]
    def y(name):
        return pd.to_numeric(d.iloc[:, cols.index(name) + 1], errors="coerce").to_numpy()
    head = y("Head")
    foot = np.minimum(y("FootLeft"), y("FootRight"))
    return float(np.nanmedian(head - foot))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", required=True)
    root = Path(ap.parse_args().dataset)
    m = meta(root / "readme.docx")
    hs = []
    for _, r in m.iterrows():
        sub = root / ("Autism/children with ASD" if r.label == "ASD" else "Typical") / str(r.subject) / "video/8.xlsx"
        hs.append(kinect_height(sub) if sub.exists() else np.nan)
    m["kinect_height_m"] = hs

    # Dataset_video video_k ↔ thư mục gốc (md5)
    oc = pd.read_csv(OUT / "orig_color_videos.csv", dtype={"subj": str})
    va = pd.read_csv(OUT / "video_audit.csv")
    # cùng md5 có thể ứng với 2 thư mục (5 cặp Typical trùng) → giữ cả hai
    va = va.merge(oc[["md5", "label", "subj"]], on=["label", "md5"], how="inner")
    va["subject"] = va.subj.astype(int)
    vids = (va.groupby(["label", "subject"]).idx.apply(lambda s: ",".join(map(str, sorted(set(s)))))
            .rename("video_idx").reset_index())
    m = m.merge(vids, on=["label", "subject"], how="left")
    m.to_csv(OUT / "metadata_linked.csv", index=False)

    pd.set_option("display.width", 200)
    for lab in ("ASD", "Typical"):
        s = m[m.label == lab].dropna(subset=["kinect_height_m"])
        print(f"{lab}: corr(height metadata, Kinect head-foot) = {s.height_m.corr(s.kinect_height_m):.3f}  (n={len(s)})")
    print(m.groupby("label")[["age", "height_m", "kinect_height_m"]].describe().T.round(2).to_string())
    print(pd.crosstab(m.label, m.sex))
    print(pd.crosstab(m.label, pd.cut(m.age, [0, 4, 6, 8, 10, 16])))
    y = (m.label == "ASD").astype(int)
    for c in ("age", "height_m"):
        print(f"AUC {c}: {roc_auc_score(y, m[c]):.3f} (cao = ASD)")
    print(f"AUC sex(M): {roc_auc_score(y, (m.sex == 'M').astype(int)):.3f}")
    print("video map ASD:", m[m.label == "ASD"].video_idx.notna().sum(), " Typical:", m[m.label == "Typical"].video_idx.notna().sum())


if __name__ == "__main__":
    main()
