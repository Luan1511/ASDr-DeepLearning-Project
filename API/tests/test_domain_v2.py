"""Domain v2 checkpoints (config["domain_v2"]): server preprocessing = training preprocessing.

The parity test needs the training repo (NCKH_25-26) on this machine and is
skipped elsewhere; the rest only needs this folder. Checkpoints are untrained,
so only shapes / bookkeeping / equality of model INPUTS are asserted."""

import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import numpy as np

import helpers  # noqa: F401  (puts API/ on sys.path)

from services import gait_domain as gd
from services.stgcn_service import STGCNPredictor

TRAIN_REPO = Path("E:/Scientific research 2025-2026/Linux_src_2/NCKH_25-26")
J = gd.J17


def make_domain_v2_checkpoint(path: Path, dyn=("acceleration",), **cfg_overrides) -> Path:
    import torch

    from ST_GCN import ST_GCN, Graph

    dv2 = gd.DomainV2Config(dynamic_features=dyn).to_dict()
    dv2.update(cfg_overrides)
    torch.manual_seed(0)
    model = ST_GCN(in_channels=2 + 2 * len(dyn), num_class=2, A=Graph(layout="kinect17").A,
                   edge_importance_weighting=True, dropout=0.2)
    config = {"normalization": "domain_v2", "include_dynamics": bool(dyn), "dynamic_fusion": "concat",
              "dynamic_features": list(dyn), "fps": 30.0, "domain_v2": dv2}
    torch.save({"model_state_dict": model.state_dict(), "config": config, "num_joints": 17}, path)
    return path


def walk17(fps: float, seconds: float, scale: float = 40.0, offset=(300.0, 200.0)) -> np.ndarray:
    """Child walking towards the camera, OpenPose convention (left joints on the image RIGHT), pixels."""
    t = np.arange(0.0, seconds + 1e-9, 1.0 / fps)
    w = 2 * np.pi * t
    base = {
        "Head": (0, -3.5), "SpineShoulder": (0, -2.4), "ShoulderLeft": (1, -2.4), "ShoulderRight": (-1, -2.4),
        "ElbowLeft": (1.1, -1.5), "ElbowRight": (-1.1, -1.5), "WristLeft": (1.2, -0.5), "WristRight": (-1.2, -0.5),
        "SpineBase": (0, 0), "HipLeft": (0.5, 0), "HipRight": (-0.5, 0), "KneeLeft": (0.5, 1.5),
        "KneeRight": (-0.5, 1.5), "AnkleLeft": (0.5, 3), "AnkleRight": (-0.5, 3), "FootLeft": (0.6, 3.2),
        "FootRight": (-0.6, 3.2),
    }
    rel = np.zeros((len(t), 17, 2))
    for n, xy in base.items():
        rel[:, J[n]] = xy
    for side, sign in (("Left", 1), ("Right", -1)):
        for n, a in (("Knee", 0.15), ("Ankle", 0.35), ("Foot", 0.4)):
            rel[:, J[n + side], 1] += sign * a * np.sin(w)
        rel[:, J["Wrist" + side], 1] -= sign * 0.2 * np.sin(w)
    rel[..., 1] += 0.05 * np.sin(2 * w)[:, None]
    return np.asarray(offset) + scale * rel


def to_frames(s17: np.ndarray, conf: float = 0.9) -> list:
    """17-joint sequence -> API frames with BODY_25 people (eyes/ears/heels/small toes filled in)."""
    src = {"Nose": "Head", "RShoulder": "ShoulderRight", "RElbow": "ElbowRight", "RWrist": "WristRight",
           "LShoulder": "ShoulderLeft", "LElbow": "ElbowLeft", "LWrist": "WristLeft", "RHip": "HipRight",
           "RKnee": "KneeRight", "RAnkle": "AnkleRight", "LHip": "HipLeft", "LKnee": "KneeLeft",
           "LAnkle": "AnkleLeft", "LBigToe": "FootLeft", "RBigToe": "FootRight", "LHeel": "AnkleLeft",
           "RHeel": "AnkleRight"}
    frames = []
    for i, f in enumerate(s17):
        xy = np.zeros((25, 2))
        for op_name, k_name in src.items():
            xy[gd.OP[op_name]] = f[J[k_name]]
        xy[gd.OP["Neck"]] = 0.5 * (f[J["ShoulderLeft"]] + f[J["ShoulderRight"]])
        xy[gd.OP["MidHip"]] = 0.5 * (f[J["HipLeft"]] + f[J["HipRight"]])
        for j in (15, 16, 17, 18):            # eyes / ears near the nose
            xy[j] = f[J["Head"]] + (j - 16.5, -2)
        xy[20], xy[23] = f[J["FootLeft"]], f[J["FootRight"]]  # small toes
        body25 = [{"id": j, "x": float(xy[j, 0]), "y": float(xy[j, 1]), "confidence": conf} for j in range(25)]
        frames.append({"frame_index": i, "people": [{"person_id": -1, "body25": body25}]})
    return frames


class DomainV2ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.ckpt = make_domain_v2_checkpoint(cls.tmp / "dv2.pth")
        cls.predictor = STGCNPredictor(checkpoint_path=cls.ckpt, device="cpu", min_person_frames=8)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_settings_report_domain_v2(self):
        s = self.predictor.settings()
        self.assertEqual(s["preprocessing"], gd.VERSION)
        self.assertEqual((s["window_frames"], s["window_stride"], s["target_fps"]), (32, 16, 30.0))

    def test_predict_uses_real_fps_and_reports_windows_in_source_frames(self):
        frames = to_frames(walk17(60, seconds=3.0))  # 181 frames at 60 fps -> 91 frames at 30 fps
        r = self.predictor.predict_from_api_frames(frames, threshold=0.5, temperature=1.0, fps=60)
        self.assertEqual(r["n_windows"], 5)  # starts 0, 16, 32, 48, 59 at 30 fps
        self.assertEqual(r["windows"][0]["start"], 0)
        self.assertEqual(r["windows"][-1]["end"], 181)  # exclusive end = number of source frames
        self.assertEqual((r["windows"][1]["start"], r["windows"][1]["end"]), (32, 95))
        self.assertEqual(r["J"], 17)
        self.assertFalse(r["preprocessing"]["fps_assumed"])
        self.assertEqual(r["preprocessing"]["fps_source"], 60.0)
        self.assertTrue(0.0 <= r["p_asd"] <= 1.0)
        z = np.array([r["logit_typical"], r["logit_asd"]])
        p = np.exp(z - z.max()) / np.exp(z - z.max()).sum()
        self.assertAlmostEqual(r["p_asd"], float(p[1]), places=5)
        self.assertIn("quality", r)
        self.assertIn("reliable", r)

    def test_missing_fps_falls_back_to_30_and_says_so(self):
        r = self.predictor.predict_from_api_frames(to_frames(walk17(30, seconds=1.5)), fps=None)
        self.assertTrue(r["preprocessing"]["fps_assumed"])
        self.assertEqual(r["preprocessing"]["fps_source"], 30.0)

    def test_same_walk_at_30_and_60_fps_and_other_pixel_scale_gives_same_input(self):
        a = self.predictor.domain_v2_windows(*self._seq(walk17(30, seconds=2.0)), fps=30)[0]
        b = self.predictor.domain_v2_windows(*self._seq(walk17(60, seconds=2.0, scale=90, offset=(700, 1300))), fps=60)[0]
        self.assertEqual(a.shape, b.shape)
        np.testing.assert_allclose(a[..., :2], b[..., :2], atol=1e-5)
        # tracked coordinates are float32; acceleration amplifies rounding by fps² → relative check
        self.assertLess(float(np.abs(a[..., 2:] - b[..., 2:]).max()), 1e-3 * max(1.0, float(np.abs(a[..., 2:]).max())))

    def test_short_gaps_are_interpolated_not_zero(self):
        s = walk17(30, seconds=1.5)
        frames = to_frames(s)
        for f in frames[10:13]:
            for kp in f["people"][0]["body25"]:
                if kp["id"] == gd.OP["LKnee"]:
                    kp["x"] = kp["y"] = kp["confidence"] = 0.0
        x_gap = self.predictor.domain_v2_windows(*self.predictor.frames_to_sequence(frames)[:2], fps=30)[0]
        x_ref = self.predictor.domain_v2_windows(*self.predictor.frames_to_sequence(to_frames(s))[:2], fps=30)[0]
        # the knee moves smoothly, so linear interpolation over 3 frames stays close to the truth
        self.assertLess(np.abs(x_gap[..., :2] - x_ref[..., :2]).max(), 0.05)

    def test_checkpoint_with_other_preprocessing_version_is_refused(self):
        bad = make_domain_v2_checkpoint(self.tmp / "old.pth", version="domain-v2.0")
        with self.assertRaises(ValueError):
            STGCNPredictor(checkpoint_path=bad, device="cpu")

    def _seq(self, s17):
        seq, conf, _ = self.predictor.frames_to_sequence(to_frames(s17))
        return seq, conf


@unittest.skipUnless((TRAIN_REPO / "ULTIMATE_FINAL_TRAINING_ROUND.py").is_file(), "training repo not on this machine")
class TrainServerParityTests(unittest.TestCase):
    """Same walk: as a Kinect 2D file through the TRAINING dataset, and as a 60 fps phone video
    through the SERVER. Both must produce the same model input."""

    @classmethod
    def setUpClass(cls):
        if str(TRAIN_REPO) not in sys.path:
            sys.path.append(str(TRAIN_REPO))  # append: API/ modules keep priority
        import ULTIMATE_FINAL_TRAINING_ROUND as train  # noqa: E402

        cls.train = train
        cls.tmp = Path(tempfile.mkdtemp())
        cls.predictor = STGCNPredictor(checkpoint_path=make_domain_v2_checkpoint(cls.tmp / "dv2.pth"),
                                       device="cpu", min_person_frames=8)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_shared_module_is_the_same_file(self):
        self.assertEqual((TRAIN_REPO / "gait_domain.py").read_bytes(),
                         Path(gd.__file__).read_bytes())

    def test_kinect_training_input_equals_phone_video_server_input(self):
        seconds = 31 / 30  # exactly one 32-frame window at 30 fps
        s30 = walk17(30, seconds)

        # Kinect 2D file: mirrored image, narrower hips, higher SpineShoulder, other pixel scale
        k17 = s30.copy()
        k17[..., 0] = -k17[..., 0]
        mid = 0.5 * (k17[:, J["HipLeft"]] + k17[:, J["HipRight"]])
        for n in ("HipLeft", "HipRight"):
            k17[:, J[n]] = mid + (k17[:, J[n]] - mid) / 1.4
        k17[:, J["SpineShoulder"], 1] -= 8
        seq25 = np.full((len(s30), 25, 2), 7.0)
        seq25[:, gd.KINECT25_TO_17] = 250 + 0.6 * k17

        cfg = gd.DomainV2Config(dynamic_features=("acceleration",))
        e = SimpleNamespace(label=1, subject_id="1", variant_kind="orig", variant_id=0, clip_stub="c",
                            group="g", path_2d=Path("ASD/1/c_2d.xlsx"))
        ds = self.train.Kinect2DNormalizedDataset(
            [e], [0], L=32, normalization="domain_v2", remove_head_neck=True, include_dynamics=True, fps=30.0,
            dynamic_features=["acceleration"], domain_v2=cfg.to_dict(), domain_v2_mode="center")
        ds._load_sequence_src = lambda _e: (seq25, False)
        item = ds[0]
        trained_on = np.concatenate([item["keypoints"].numpy(), item["dynamic_acceleration"].numpy()], axis=-1)

        seq, conf, _ = self.predictor.frames_to_sequence(to_frames(walk17(60, seconds, scale=75, offset=(540, 960))))
        served, spans, _ = self.predictor.domain_v2_windows(seq, conf, fps=60)

        self.assertEqual(served.shape, (1, 32, 17, 4))
        np.testing.assert_allclose(served[0][..., :2], trained_on[..., :2], atol=1e-5)
        acc_scale = max(1.0, float(np.abs(trained_on[..., 2:]).max()))
        self.assertLess(float(np.abs(served[0][..., 2:] - trained_on[..., 2:]).max()), 1e-3 * acc_scale)


if __name__ == "__main__":
    unittest.main()
