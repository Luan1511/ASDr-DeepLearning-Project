"""STGCNPredictor: person tracking, gap handling, quality gate, windowing.

Uses the untrained checkpoint from helpers.make_random_checkpoint, so only
shapes / bookkeeping are asserted, never the probability itself."""

import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np

from helpers import make_random_checkpoint

from services.stgcn_service import STGCNPredictor
from openpose_excel_stgcn_pipeline import _resample_time_nearest, _resample_time_linear


def person(cx: float, cy: float, unit: float, phase: float = 0.0, conf: float = 0.9, lower_conf=None) -> dict:
    """Synthetic BODY_25 skeleton centred at (cx, cy); legs swing with `phase`."""
    s = np.sin(phase)
    joints = {
        0: (cx, cy - 3.5 * unit), 1: (cx, cy - 2.5 * unit),
        2: (cx - unit, cy - 2.4 * unit), 3: (cx - 1.1 * unit, cy - 1.5 * unit), 4: (cx - 1.2 * unit, cy - 0.5 * unit),
        5: (cx + unit, cy - 2.4 * unit), 6: (cx + 1.1 * unit, cy - 1.5 * unit), 7: (cx + 1.2 * unit, cy - 0.5 * unit),
        8: (cx, cy),
        9: (cx - 0.5 * unit, cy), 10: (cx - 0.5 * unit, cy + 1.5 * unit), 11: (cx - 0.5 * unit, cy + 3 * unit - 0.3 * unit * s),
        12: (cx + 0.5 * unit, cy), 13: (cx + 0.5 * unit, cy + 1.5 * unit), 14: (cx + 0.5 * unit, cy + 3 * unit + 0.3 * unit * s),
        15: (cx - 0.15 * unit, cy - 3.6 * unit), 16: (cx + 0.15 * unit, cy - 3.6 * unit),
        17: (cx - 0.35 * unit, cy - 3.5 * unit), 18: (cx + 0.35 * unit, cy - 3.5 * unit),
        19: (cx + 0.8 * unit, cy + 3.2 * unit), 20: (cx + 0.9 * unit, cy + 3.2 * unit), 21: (cx + 0.5 * unit, cy + 3.1 * unit),
        22: (cx - 0.8 * unit, cy + 3.2 * unit), 23: (cx - 0.9 * unit, cy + 3.2 * unit), 24: (cx - 0.5 * unit, cy + 3.1 * unit),
    }
    body25 = []
    for j in range(25):
        x, y = joints[j]
        c = conf if (lower_conf is None or j < 9 or j in (15, 16, 17, 18)) else lower_conf
        if c <= 0:
            x, y = 0.0, 0.0
        body25.append({"id": j, "x": float(x), "y": float(y), "confidence": float(c)})
    return {"person_id": -1, "body25": body25}


def frame(index: int, people) -> dict:
    return {"frame_index": index, "people": list(people)}


class STGCNServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.ckpt = make_random_checkpoint(cls.tmp / "model.pth")
        cls.predictor = STGCNPredictor(checkpoint_path=cls.ckpt, device="cpu", min_person_frames=8)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    # ---------------------------------------------------------------- tracking

    def test_keeps_one_identity_when_two_people_swap_list_order(self):
        """Child (small, walking) and adult (large, static) in every frame, in
        alternating order; per-frame "best confidence" would pick the adult."""
        frames = []
        for i in range(40):
            child = person(100 + 3 * i, 200, 20, phase=i * np.pi / 6, conf=0.6)
            adult = person(500, 220, 45, conf=0.95)
            frames.append(frame(i, [child, adult] if i % 2 == 0 else [adult, child]))

        seq, conf, quality = self.predictor.frames_to_sequence(frames)
        self.assertEqual(seq.shape, (40, 25, 2))
        self.assertEqual(quality["n_tracks"], 2)
        self.assertEqual(quality["frames_tracked"], 40)
        self.assertEqual(quality["multi_person_frames"], 40)
        # The chosen track must be ONE of the two people for the whole clip:
        # mid-hip x moves smoothly (child) or stays put (adult), never jumps.
        hip_x = seq[:, 8, 0]
        self.assertLess(np.abs(np.diff(hip_x)).max(), 10.0)

    def test_frames_without_person_stay_as_zero_rows(self):
        frames = [frame(i, [] if i in (5, 6, 20) else [person(100 + i, 200, 20, phase=i)]) for i in range(30)]
        seq, conf, quality = self.predictor.frames_to_sequence(frames)
        self.assertEqual(seq.shape[0], 30, "timing must be preserved, not collapsed")
        for t in (5, 6, 20):
            self.assertTrue(np.all(seq[t] == 0.0))
            self.assertTrue(np.all(conf[t] == 0.0))
        self.assertEqual(quality["frames_total"], 30)
        self.assertEqual(quality["frames_with_person"], 27)
        self.assertAlmostEqual(quality["person_coverage"], 0.9, places=3)

    def test_missing_frame_indices_are_zero_rows(self):
        frames = [frame(i, [person(100, 200, 20)]) for i in range(0, 20, 2)]  # only even indices
        seq, _, quality = self.predictor.frames_to_sequence(frames)
        self.assertEqual(seq.shape[0], 19)
        self.assertEqual(quality["frames_tracked"], 10)

    def test_track_survives_short_occlusion(self):
        frames = []
        for i in range(40):
            people = [] if 15 <= i < 20 else [person(100 + 2 * i, 200, 20, phase=i)]
            frames.append(frame(i, people))
        _, _, quality = self.predictor.frames_to_sequence(frames)
        self.assertEqual(quality["n_tracks"], 1)
        self.assertEqual(quality["frames_tracked"], 35)

    # ------------------------------------------------------------- prediction

    def test_predict_reports_quality_and_fills_short_gaps(self):
        frames = [frame(i, [] if i % 10 == 9 else [person(100 + i, 200, 20, phase=i)]) for i in range(40)]
        result = self.predictor.predict_from_api_frames(frames, sample_id="t", threshold=0.5, temperature=1.0)
        self.assertTrue(0.0 <= result["p_asd"] <= 1.0)
        self.assertEqual(result["T_in"], 40)
        self.assertEqual(result["n_windows"], 1)
        self.assertEqual(result["quality"]["frames_total"], 40)
        self.assertEqual(result["quality"]["frames_tracked"], 36)
        self.assertTrue(result["reliable"])
        self.assertEqual(result["resample"], "nearest")
        self.assertIn(result["label_name"], ("ASD", "Typical"))

    def test_rejects_clip_with_too_few_tracked_frames(self):
        frames = [frame(i, [person(100, 200, 20)] if i < 5 else []) for i in range(40)]
        with self.assertRaises(ValueError):
            self.predictor.predict_from_api_frames(frames)

    def test_unreliable_when_lower_body_missing(self):
        frames = [frame(i, [person(100 + i, 200, 20, phase=i, lower_conf=0.0)]) for i in range(40)]
        result = self.predictor.predict_from_api_frames(frames)
        self.assertFalse(result["reliable"])
        self.assertLess(result["quality"]["lower_body_coverage"], 0.2)

    def test_sliding_windows_average_logits(self):
        predictor = STGCNPredictor(
            checkpoint_path=self.ckpt, device="cpu", min_person_frames=8, window_frames=32, window_stride=16
        )
        frames = [frame(i, [person(100 + i, 200, 20, phase=i)]) for i in range(80)]
        result = predictor.predict_from_api_frames(frames, threshold=0.5, temperature=2.0)
        self.assertEqual(result["n_windows"], 4)
        self.assertEqual([w["start"] for w in result["windows"]], [0, 16, 32, 48])
        self.assertEqual(result["windows"][-1]["end"], 80)
        self.assertTrue(0.0 <= result["p_asd"] <= 1.0)
        # p_asd is softmax(mean logits / T), not the mean of window probabilities
        z = np.array([result["logit_typical"], result["logit_asd"]]) / 2.0
        p = np.exp(z) / np.exp(z).sum()
        self.assertAlmostEqual(result["p_asd"], float(p[1]), places=5)
        self.assertEqual(result["temperature"], 2.0)

    def test_settings_reported(self):
        s = self.predictor.settings()
        self.assertEqual(s["resample"], "nearest")
        self.assertTrue(s["preprocess"])
        self.assertEqual(s["window_frames"], 0)


class ResampleTests(unittest.TestCase):
    def test_nearest_keeps_source_frames_and_endpoints(self):
        seq = np.arange(10, dtype=np.float32).reshape(10, 1, 1).repeat(2, axis=2)
        out = _resample_time_nearest(seq, 25)
        self.assertEqual(out.shape, (25, 1, 2))
        self.assertEqual(out[0, 0, 0], 0.0)
        self.assertEqual(out[-1, 0, 0], 9.0)
        self.assertTrue(set(np.unique(out)).issubset(set(range(10))), "nearest must not blend frames")

    def test_nearest_downsample_and_identity(self):
        seq = np.random.default_rng(0).random((128, 18, 2)).astype(np.float32)
        self.assertIs(_resample_time_nearest(seq, 128), seq)
        self.assertEqual(_resample_time_nearest(seq, 40).shape, (40, 18, 2))

    def test_linear_blends(self):
        seq = np.array([[[0.0]], [[10.0]]], dtype=np.float32)
        out = _resample_time_linear(seq, 3)
        self.assertAlmostEqual(float(out[1, 0, 0]), 5.0)


if __name__ == "__main__":
    unittest.main()
