"""API tests for server_openpose.py with a fake OpenPose binary and an
untrained ST-GCN checkpoint (no GPU, no real model needed)."""

import importlib
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

from helpers import make_fake_openpose, make_random_checkpoint, write_textured_video

API_KEY = "test-key-123"


def load_server(tmp: Path, **overrides):
    env = {
        "OPENPOSE_BIN": str(make_fake_openpose(tmp)),
        "OPENPOSE_MODEL_DIR": str(tmp),
        "STGCN_CHECKPOINT": str(tmp / "model.pth"),
        "CALIBRATION_PATH": str(tmp / "calibration.json"),
        "SUBJECT_ROOT": str(tmp / "subjects"),
        "ML_API_KEY": API_KEY,
        "VIDEO_RETENTION": "blurred",
        "STGCN_DEVICE": "cpu",
    }
    env.update(overrides)
    os.environ.update(env)
    sys.modules.pop("server_openpose", None)
    return importlib.import_module("server_openpose")


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient

        cls.tmp = Path(tempfile.mkdtemp())
        make_random_checkpoint(cls.tmp / "model.pth")
        cls.server = load_server(cls.tmp)
        cls.client_cm = TestClient(cls.server.app)
        cls.client = cls.client_cm.__enter__()
        cls.video = write_textured_video(cls.tmp / "walk.mp4", frames=40)
        cls.auth = {"X-API-Key": API_KEY}

    @classmethod
    def tearDownClass(cls):
        cls.client_cm.__exit__(None, None, None)
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def upload(self, path="/pipeline/asd", params=None, headers=None):
        with open(self.video, "rb") as f:
            return self.client.post(
                path,
                params=params or {},
                headers=self.auth if headers is None else headers,
                files={"video": ("walk.mp4", f, "video/mp4")},
            )

    def test_health_is_public_and_reports_privacy_mode(self):
        r = self.client.get("/health")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["video_retention"], "blurred")
        self.assertTrue(body["auth_required"])
        self.assertTrue(body["model_loaded"])
        self.assertFalse(body["calibrated"])

    def test_routes_require_api_key(self):
        self.assertEqual(self.client.get("/subjects").status_code, 401)
        self.assertEqual(self.client.get("/subjects", headers={"X-API-Key": "wrong"}).status_code, 401)
        self.assertEqual(self.upload(headers={}).status_code, 401)
        self.assertEqual(self.client.get("/subjects", headers=self.auth).status_code, 200)

    def test_rejects_unsafe_subject_ids(self):
        for bad in ["../evil", "a/b", "with space", "x" * 65, "dot.dot"]:
            r = self.upload(path="/subjects/extract", params={"subject_id": bad})
            self.assertEqual(r.status_code, 422, bad)
        self.assertEqual(self.client.get("/subjects/dot.dot", headers=self.auth).status_code, 422)
        self.assertFalse((self.tmp / "evil").exists())

    def test_pipeline_end_to_end(self):
        r = self.upload(params={"subject_id": "subject-e2e", "return_keypoints": "true"})
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body["num_frames"], 40)
        self.assertEqual(body["video"]["width"], 320)
        self.assertAlmostEqual(body["video"]["fps"], 25.0, places=1)
        self.assertEqual(body["video_retention"], "blurred")
        self.assertEqual(len(body["frames"]), 40)

        pred = body["prediction"]
        self.assertTrue(0.0 <= pred["p_asd"] <= 1.0)
        self.assertEqual(pred["threshold"], 0.5)
        self.assertFalse(pred["calibrated"])
        self.assertIsNone(pred["high_risk_threshold"])
        self.assertEqual(pred["model"]["num_joints"], 18)
        self.assertEqual(len(pred["model"]["sha256"]), 64)

        subject_dir = self.tmp / "subjects" / "subject-e2e"
        self.assertFalse((subject_dir / "input.mp4").exists(), "raw video must not be kept")
        self.assertTrue((subject_dir / "input_blurred.mp4").exists())
        metadata = json.loads((subject_dir / "metadata.json").read_text(encoding="utf-8"))
        self.assertEqual(metadata["video_retention"], "blurred")
        self.assertEqual(metadata["anonymization"]["frames"], 40)
        self.assertEqual(metadata["anonymization"]["fully_blurred_frames"], 0)

        kp = self.client.get("/subjects/subject-e2e/keypoints", headers=self.auth).json()
        self.assertEqual(kp["video"]["height"], 240)
        self.assertEqual(self.upload(params={"subject_id": "subject-e2e"}).status_code, 409)

    def test_predict_overrides_and_missing_subject(self):
        self.assertEqual(self.upload(path="/subjects/extract", params={"subject_id": "subject-x"}).status_code, 200)
        r = self.client.post("/subjects/subject-x/predict", params={"threshold": 0.3}, headers=self.auth)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["prediction"]["threshold"], 0.3)
        self.assertEqual(self.client.post("/subjects/nope/predict", headers=self.auth).status_code, 404)
        self.assertEqual(self.client.delete("/subjects/subject-x", headers=self.auth).status_code, 200)
        self.assertEqual(self.client.get("/subjects/subject-x", headers=self.auth).status_code, 404)

    def test_openpose_failure_cleans_up(self):
        os.environ["FAKE_OPENPOSE_FAIL"] = "1"
        try:
            r = self.upload(params={"subject_id": "subject-fail"})
        finally:
            os.environ.pop("FAKE_OPENPOSE_FAIL")
        self.assertEqual(r.status_code, 500)
        self.assertIn("CUDA", r.json()["detail"])
        self.assertFalse((self.tmp / "subjects" / "subject-fail").exists())


class CalibrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        make_random_checkpoint(self.tmp / "model.pth")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def start(self, calibration: dict):
        from fastapi.testclient import TestClient

        import hashlib

        sha = hashlib.sha256((self.tmp / "model.pth").read_bytes()).hexdigest()
        payload = {k: (sha if v == "<sha>" else v) for k, v in calibration.items()}
        (self.tmp / "calibration.json").write_text(json.dumps(payload), encoding="utf-8")
        server = load_server(self.tmp, VIDEO_RETENTION="none")
        return TestClient(server.app)

    def test_matching_calibration_is_applied(self):
        with self.start({"checkpoint_sha256": "<sha>", "temperature": 2.0, "threshold": 0.4, "high_risk_threshold": 0.8}) as c:
            self.assertTrue(c.get("/health").json()["calibrated"])
            video = write_textured_video(self.tmp / "v.mp4", frames=20)
            with open(video, "rb") as f:
                r = c.post("/pipeline/asd", headers={"X-API-Key": API_KEY}, files={"video": ("v.mp4", f, "video/mp4")})
            pred = r.json()["prediction"]
            self.assertEqual((pred["threshold"], pred["temperature"], pred["high_risk_threshold"]), (0.4, 2.0, 0.8))
            self.assertTrue(pred["calibrated"])
            self.assertEqual(r.json()["video_retention"], "none")
            subject_dir = next((self.tmp / "subjects").iterdir())
            self.assertEqual([p.name for p in subject_dir.glob("*.mp4")], [])

    def test_calibration_for_another_checkpoint_is_ignored(self):
        with self.start({"checkpoint_sha256": "0" * 64, "temperature": 2.0, "threshold": 0.4}) as c:
            self.assertFalse(c.get("/health").json()["calibrated"])

    def test_invalid_calibration_is_ignored(self):
        with self.start({"checkpoint_sha256": "<sha>", "temperature": -1, "threshold": 0.4}) as c:
            self.assertFalse(c.get("/health").json()["calibrated"])

    def test_calibration_without_checkpoint_hash_is_ignored(self):
        with self.start({"temperature": 2.0, "threshold": 0.4, "high_risk_threshold": 0.8}) as c:
            self.assertFalse(c.get("/health").json()["calibrated"])


if __name__ == "__main__":
    unittest.main()
