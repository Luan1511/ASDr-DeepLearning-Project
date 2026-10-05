# -*- coding: utf-8 -*-
"""Unit tests for research_src/calibrate_evaluate.py (stdlib unittest + numpy).

Run from the repository root:
    python -m unittest discover -s research_src/tests
"""

from __future__ import annotations

import csv
import itertools
import json
import sys
import tempfile
import unittest
import warnings
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import calibrate_evaluate as ce  # noqa: E402


def _sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def _write_predictions(path: Path, rows) -> None:
    fields = ["path", "subject_id", "label", "split", "logit_typical", "logit_asd", "p_asd_t1", "T_in", "J", "error"]
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fields})


def _synthetic_prediction_rows(n_subjects=150, samples_per_subject=3, t_true=3.0, seed=0):
    """Each subject has a calibrated log-odds s ~ N(0, 2^2) and a label ~ Bernoulli(sigmoid(s)).
    The model's logit margin is t_true * s (+ small per-sample noise): overconfident by t_true.
    Subjects are assigned to train/val/test round-robin."""
    rng = np.random.default_rng(seed)
    rows = []
    for k in range(n_subjects):
        s = rng.normal(0.0, 2.0)
        label = int(rng.random() < _sigmoid(s))
        sid = f"S{k:03d}"
        split = ce.SPLIT_NAMES[k % 3]
        for j in range(samples_per_subject):
            d = t_true * s + rng.normal(0.0, 0.2)
            rows.append(
                {
                    "path": f"/data/{sid}_{j}.xlsx",
                    "subject_id": sid,
                    "label": label,
                    "split": split,
                    "logit_typical": 0.0,
                    "logit_asd": d,
                    "p_asd_t1": float(_sigmoid(d)),
                    "T_in": 100,
                    "J": 18,
                    "error": "",
                }
            )
    return rows


class TestAUC(unittest.TestCase):
    def test_known_small_case(self):
        self.assertAlmostEqual(ce.roc_auc([0, 0, 1, 1], [0.1, 0.4, 0.35, 0.8]), 0.75)

    def test_ties_count_half(self):
        # pairs: (0.5>0.2) (0.5=0.5 -> 0.5) (0.9>0.2) (0.9>0.5) -> 3.5 / 4
        self.assertAlmostEqual(ce.roc_auc([0, 0, 1, 1], [0.2, 0.5, 0.5, 0.9]), 0.875)
        self.assertAlmostEqual(ce.roc_auc([0, 1, 0, 1], [0.3, 0.3, 0.3, 0.3]), 0.5)

    def test_perfect_and_inverted(self):
        self.assertAlmostEqual(ce.roc_auc([0, 0, 1, 1], [0.1, 0.2, 0.8, 0.9]), 1.0)
        self.assertAlmostEqual(ce.roc_auc([0, 0, 1, 1], [0.8, 0.9, 0.1, 0.2]), 0.0)

    def test_matches_bruteforce_with_many_ties(self):
        rng = np.random.default_rng(1)
        y = rng.integers(0, 2, 60)
        s = rng.integers(0, 4, 60).astype(float)  # heavy ties
        pos, neg = s[y == 1], s[y == 0]
        brute = np.mean([1.0 if a > b else 0.5 if a == b else 0.0 for a, b in itertools.product(pos, neg)])
        self.assertAlmostEqual(ce.roc_auc(y, s), brute, places=12)

    def test_single_class_returns_none_with_warning(self):
        with self.assertWarns(ce.EvaluationWarning):
            self.assertIsNone(ce.roc_auc([1, 1, 1], [0.2, 0.4, 0.9]))

    def test_average_ranks(self):
        np.testing.assert_allclose(ce.average_ranks([10, 20, 20, 30]), [1.0, 2.5, 2.5, 4.0])


class TestECE(unittest.TestCase):
    def test_perfectly_calibrated_bins(self):
        p = [0.25] * 4 + [0.75] * 4
        y = [1, 0, 0, 0] + [1, 1, 1, 0]
        self.assertAlmostEqual(ce.expected_calibration_error(y, p), 0.0)

    def test_overconfident(self):
        self.assertAlmostEqual(ce.expected_calibration_error([0, 1] * 5, [0.95] * 10), 0.45)

    def test_range_and_edges(self):
        rng = np.random.default_rng(2)
        p = np.concatenate([rng.random(200), [0.0, 1.0]])  # 1.0 must land in the last bin
        y = (rng.random(202) < p).astype(int)
        ece = ce.expected_calibration_error(y, p)
        self.assertGreaterEqual(ece, 0.0)
        self.assertLessEqual(ece, 1.0)
        self.assertAlmostEqual(ce.expected_calibration_error([1], [1.0]), 0.0)


class TestTemperature(unittest.TestCase):
    def _data(self, t_true, n=20000, seed=0):
        rng = np.random.default_rng(seed)
        d = rng.normal(0.0, 1.5, n)  # calibrated margin
        y = (rng.random(n) < _sigmoid(d)).astype(int)
        logits = np.stack([np.zeros(n), d * t_true], axis=1)  # model logits = d * T
        return logits, y

    def test_recovers_known_temperature(self):
        for t_true in (2.5, 0.5):
            logits, y = self._data(t_true)
            t_fit = ce.fit_temperature(logits, y)
            self.assertLess(abs(t_fit - t_true) / t_true, 0.05, msg=f"T_true={t_true}, fitted {t_fit}")

    def test_fitted_temperature_minimises_nll(self):
        logits, y = self._data(1.7, n=3000, seed=3)
        t_fit = ce.fit_temperature(logits, y)
        best = ce.nll_binary(logits, y, t_fit)
        for factor in (0.9, 0.97, 1.03, 1.1):
            self.assertLessEqual(best, ce.nll_binary(logits, y, t_fit * factor) + 1e-12)

    def test_uninformative_logits_give_one(self):
        logits = np.zeros((10, 2))
        self.assertEqual(ce.fit_temperature(logits, [0, 1] * 5), 1.0)

    def test_calibrated_probability_matches_softmax(self):
        z = np.array([[0.3, -1.2], [2.0, 2.5], [-4.0, 3.0]])
        t = 1.7
        e = np.exp(z / t)
        np.testing.assert_allclose(ce.calibrated_p_asd(z, t), e[:, 1] / e.sum(axis=1))


class TestThresholds(unittest.TestCase):
    def test_youden_on_separable_data(self):
        y = [0, 0, 0, 1, 1, 1]
        p = [0.10, 0.20, 0.30, 0.60, 0.70, 0.90]
        t = ce.select_threshold_youden(y, p)
        self.assertAlmostEqual(t, 0.60)
        m = ce.binary_metrics(y, p, t)
        self.assertEqual((m["sensitivity"], m["specificity"]), (1.0, 1.0))

    def test_youden_tie_prefers_sensitivity(self):
        # t=0.2 -> sens 1.0 / spec 0.5 ; t=0.4 -> sens 0.5 / spec 1.0 : same J
        self.assertAlmostEqual(ce.select_threshold_youden([0, 1, 0, 1], [0.1, 0.2, 0.3, 0.4]), 0.2)

    def test_sensitivity_strategy_picks_largest_threshold(self):
        y = [0] * 5 + [1] * 10
        p = [0.05, 0.1, 0.2, 0.3, 0.4] + [0.15, 0.35, 0.5, 0.55, 0.6, 0.65, 0.7, 0.8, 0.85, 0.9]
        t = ce.select_threshold_for_sensitivity(y, p, 0.9)
        self.assertAlmostEqual(t, 0.35)  # 9/10 positives flagged; 0.5 would give 8/10
        self.assertGreaterEqual(ce.binary_metrics(y, p, t)["sensitivity"], 0.9)

    def test_high_risk_threshold(self):
        y = [0] * 10 + [1] * 5
        p = [0.05 * i for i in range(10)] + [0.3, 0.5, 0.6, 0.8, 0.9]  # negatives up to 0.45
        high, ok = ce.select_high_risk_threshold(y, p, 0.3, 0.95)
        self.assertTrue(ok)
        self.assertAlmostEqual(high, 0.5)  # smallest threshold with 0 false positives
        # top-scoring subject is a negative -> unattainable
        high, ok = ce.select_high_risk_threshold([0, 1, 0], [0.2, 0.5, 0.9], 0.2, 0.95)
        self.assertFalse(ok)
        self.assertAlmostEqual(high, 0.2)

    def test_risk_tiers(self):
        self.assertEqual(ce.risk_tier(0.1, 0.4, 0.7), "LOW")
        self.assertEqual(ce.risk_tier(0.4, 0.4, 0.7), "MEDIUM")
        self.assertEqual(ce.risk_tier(0.7, 0.4, 0.7), "HIGH")
        counts = ce.risk_tier_counts([0, 0, 1, 1], [0.1, 0.5, 0.5, 0.9], 0.4, 0.7)
        self.assertEqual(counts["Typical"], {"LOW": 1, "MEDIUM": 1, "HIGH": 0})
        self.assertEqual(counts["ASD"], {"LOW": 0, "MEDIUM": 1, "HIGH": 1})

    def test_degenerate_metrics_are_none(self):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", ce.EvaluationWarning)
            m = ce.binary_metrics([0, 0], [0.1, 0.2], 0.5)
        self.assertIsNone(m["auc"])
        self.assertIsNone(m["sensitivity"])  # no positives
        self.assertIsNone(m["ppv"])  # nothing flagged
        self.assertEqual(m["specificity"], 1.0)


class TestBootstrap(unittest.TestCase):
    def test_reproducible_with_seed(self):
        rng = np.random.default_rng(4)
        y = np.array([0] * 15 + [1] * 15)
        p = np.clip(0.3 * y + rng.random(30) * 0.7, 0, 1)
        a = ce.bootstrap_cis(y, p, 0.5, n_boot=300, seed=7)
        b = ce.bootstrap_cis(y, p, 0.5, n_boot=300, seed=7)
        c = ce.bootstrap_cis(y, p, 0.5, n_boot=300, seed=8)
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)
        self.assertLessEqual(a["auc"]["low"], ce.roc_auc(y, p))
        self.assertGreaterEqual(a["auc"]["high"], ce.roc_auc(y, p))


class TestLeakage(unittest.TestCase):
    def test_check_no_leakage(self):
        ce.check_no_leakage(["a", "b"], ["c"])
        with self.assertRaises(ce.LeakageError):
            ce.check_no_leakage(["a", "b"], ["b", "c"])

    def test_evaluate_refuses_val_subjects(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            cal = {"temperature": 1.0, "threshold": 0.5, "high_risk_threshold": 0.8, "val_subjects": ["s1"]}
            (tmp / "calibration.json").write_text(json.dumps(cal), encoding="utf-8")
            _write_predictions(
                tmp / "preds.csv",
                [
                    {"subject_id": "s1", "label": 1, "split": "test", "logit_typical": 0, "logit_asd": 1},
                    {"subject_id": "s2", "label": 0, "split": "test", "logit_typical": 1, "logit_asd": 0},
                ],
            )
            with self.assertRaises(ce.LeakageError):
                ce.run_evaluate(tmp / "preds.csv", tmp / "calibration.json", None, verbose=False)


class TestSplit(unittest.TestCase):
    def _samples(self, n_asd=25, n_td=20, seed=5):
        rng = np.random.default_rng(seed)
        out = []
        for label, n in ((1, n_asd), (0, n_td)):
            for k in range(n):
                sid = f"{'A' if label else 'T'}{k:02d}"
                for j in range(int(rng.integers(1, 4))):
                    out.append({"path": f"/data/{sid}_{j}.xlsx", "subject_id": sid, "label": label})
        return out

    def _check(self, doc):
        sets = {name: set(doc["subjects"][name]) for name in ce.SPLIT_NAMES}
        for a, b in itertools.combinations(ce.SPLIT_NAMES, 2):
            self.assertFalse(sets[a] & sets[b], f"subject overlap between {a} and {b}")
        for s in doc["samples"]:
            self.assertIn(s["subject_id"], sets[s["split"]])
        return sets

    def test_no_subject_overlap_and_stratified(self):
        samples = self._samples()
        with warnings.catch_warnings():
            warnings.simplefilter("error", ce.EvaluationWarning)  # no split may lack a class
            doc = ce.make_splits(samples, (0.6, 0.2, 0.2), seed=42)
        sets = self._check(doc)
        labels = ce.subject_labels(samples)
        for label, n in ((1, 25), (0, 20)):
            got = [sum(1 for s in sets[name] if labels[s] == label) for name in ce.SPLIT_NAMES]
            self.assertEqual(got, ce.allocate_counts(n, (0.6, 0.2, 0.2)))
        self.assertEqual(len(doc["samples"]), len(samples))
        again = ce.make_splits(list(reversed(samples)), (0.6, 0.2, 0.2), seed=42)
        self.assertEqual(again["subjects"], doc["subjects"])  # input order does not matter
        other = ce.make_splits(samples, (0.6, 0.2, 0.2), seed=43)
        self.assertNotEqual(other["subjects"], doc["subjects"])

    def test_allocate_counts(self):
        self.assertEqual(ce.allocate_counts(20, (0.6, 0.2, 0.2)), [12, 4, 4])
        self.assertEqual(ce.allocate_counts(3, (0.6, 0.2, 0.2)), [1, 1, 1])
        self.assertEqual(ce.allocate_counts(4, (0.6, 0.2, 0.2)), [2, 1, 1])
        self.assertEqual(ce.allocate_counts(5, (0.8, 0.2, 0.0)), [4, 1, 0])

    def test_mixed_label_subject_raises(self):
        with self.assertRaises(ValueError):
            ce.make_splits(
                [{"path": "a", "subject_id": "s", "label": 0}, {"path": "b", "subject_id": "s", "label": 1}]
            )

    def test_scan_root_groups_recordings_by_subject(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for cls, prefix in (("Autism", "A"), ("Typical", "T")):
                (root / cls).mkdir()
                for k in range(6):
                    for j in range(2):
                        (root / cls / f"{prefix}{k:02d}_walk{j}.xlsx").write_bytes(b"")
            (root / "Autism" / "~$A00_walk0.xlsx").write_bytes(b"")  # Excel lock file: ignored
            (root / "notes").mkdir()  # no class keyword: ignored
            doc = ce.run_split(None, root=root, subject_regex=r"^([^_]+)_", ratios=(0.5, 0.25, 0.25),
                               seed=1, verbose=False)
            sets = self._check(doc)
            self.assertEqual(len(doc["samples"]), 24)
            self.assertEqual(sum(len(v) for v in sets.values()), 12)
            self.assertIn("Autism/A00", set().union(*sets.values()))
            for s in doc["samples"]:
                self.assertEqual(s["label"], 1 if "/Autism/" in s["path"] else 0)

    def test_scan_root_default_regex_on_known_layouts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = [
                "Autism/video_12.xlsx",  # flat Dataset_video export
                "Typical/video_12.xlsx",  # same name, other class -> other subject
                "Autism/12/video/3_2d.xlsx",  # nested Kinect-style layout
                "Autism/12/video/4_2d.xlsx",
                "Typical/136/keypoints_body25.json",  # API storage layout ...
                "Typical/136/openpose_json/input_000000000000_keypoints.json",  # ... same recording: skipped
                "Typical/walk_dir/input_000000000000_keypoints.json",  # raw OpenPose frame folder
            ]
            for rel in files:
                (root / rel).parent.mkdir(parents=True, exist_ok=True)
                (root / rel).write_bytes(b"")
            samples, _ = ce.scan_root(root)
            got = sorted((s["rel"], s["subject_id"]) for s in samples)
            self.assertEqual(
                got,
                [
                    ("Autism/12/video/3_2d", "Autism/12"),
                    ("Autism/12/video/4_2d", "Autism/12"),
                    ("Autism/video_12", "Autism/video_12"),
                    ("Typical/136/keypoints_body25", "Typical/136"),
                    ("Typical/video_12", "Typical/video_12"),
                    ("Typical/walk_dir", "Typical/walk_dir"),
                ],
            )

    def test_read_manifest_labels_and_relative_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp / "m.csv").write_text("path,subject_id,label\nx/a.xlsx,s1,ASD\nb.xlsx,s2,typical\n", encoding="utf-8")
            rows = ce.read_manifest(tmp / "m.csv")
            self.assertEqual([r["label"] for r in rows], [1, 0])
            self.assertEqual(Path(rows[0]["path"]), (tmp / "x" / "a.xlsx").resolve())


class TestEndToEnd(unittest.TestCase):
    def test_calibrate_then_evaluate(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            rows = _synthetic_prediction_rows(t_true=3.0)
            n_val = len({r["subject_id"] for r in rows if r["split"] == "val"})
            n_test = len({r["subject_id"] for r in rows if r["split"] == "test"})
            broken = dict(rows[0], path="/data/broken.xlsx", split="val", logit_typical="", logit_asd="",
                          error="ValueError: x")
            rows.append(broken)
            _write_predictions(tmp / "preds.csv", rows)
            ckpt = tmp / "model.pth"
            ckpt.write_bytes(b"fake checkpoint bytes")
            cal = ce.run_calibrate(tmp / "preds.csv", tmp / "calibration.json", checkpoint=ckpt, verbose=False)
            self.assertEqual(cal["data"]["n_skipped_error"], 1)
            self.assertNotIn(broken["subject_id"], cal["val_subjects"])
            self.assertEqual(cal["checkpoint_sha256"], ce.sha256_file(ckpt))
            self.assertGreater(cal["temperature"], 1.0)  # logits were overconfident
            self.assertGreaterEqual(cal["high_risk_threshold"], cal["threshold"])
            self.assertEqual(cal["method"]["threshold"], "youden_j_val")
            self.assertEqual(cal["val_metrics"]["n_subjects"], n_val)
            self.assertTrue(all(sid in {r["subject_id"] for r in rows if r["split"] == "val"}
                                for sid in cal["val_subjects"]))
            res = ce.run_evaluate(tmp / "preds.csv", tmp / "calibration.json", tmp / "test_results.json",
                                  n_bootstrap=200, verbose=False)
            self.assertEqual(res["n_subjects"], n_test)
            self.assertTrue(set(ce.METRIC_KEYS) <= set(res["ci_95"]))
            tiers = res["risk_tiers"]
            self.assertEqual(sum(tiers["ASD"].values()) + sum(tiers["Typical"].values()), n_test)
            saved = json.loads((tmp / "test_results.json").read_text(encoding="utf-8"))
            self.assertEqual(saved["metrics"], res["metrics"])
            sens = ce.run_calibrate(tmp / "preds.csv", None, threshold_strategy="sensitivity",
                                    target_sensitivity=0.9, verbose=False)
            self.assertGreaterEqual(sens["val_metrics"]["sensitivity"], 0.9)
            self.assertEqual(sens["method"]["threshold"], "sensitivity>=0.9_val")


if __name__ == "__main__":
    unittest.main()
