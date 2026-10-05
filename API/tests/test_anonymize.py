import tempfile
import unittest
from pathlib import Path

import numpy as np

from helpers import read_frames, sharpness, write_textured_video
from services.anonymize import anonymize_video, head_box, obscure_region, probe_video


def person(head_xy, neck_xy=None, mid_hip_xy=None, conf=0.9):
    joints = []
    if head_xy is not None:
        x, y = head_xy
        joints += [
            {"id": 0, "x": x, "y": y, "confidence": conf},
            {"id": 15, "x": x - 4, "y": y - 4, "confidence": conf},
            {"id": 16, "x": x + 4, "y": y - 4, "confidence": conf},
            {"id": 17, "x": x - 9, "y": y - 2, "confidence": conf},
            {"id": 18, "x": x + 9, "y": y - 2, "confidence": conf},
        ]
    if neck_xy is not None:
        joints.append({"id": 1, "x": neck_xy[0], "y": neck_xy[1], "confidence": conf})
    if mid_hip_xy is not None:
        joints.append({"id": 8, "x": mid_hip_xy[0], "y": mid_hip_xy[1], "confidence": conf})
    return {"person_id": 0, "body25": joints}


class HeadBoxTests(unittest.TestCase):
    def test_box_covers_all_head_joints_with_margin(self):
        box = head_box(person((160, 60), neck_xy=(160, 90))["body25"], 320, 240)
        x0, y0, x1, y1 = box
        for x, y in [(160, 60), (151, 58), (169, 58), (156, 56), (164, 56)]:
            self.assertTrue(x0 < x < x1 and y0 < y < y1)
        # radius ≥ 1.1 × nose–neck distance (30 px)
        self.assertGreaterEqual(x1 - x0, 60)

    def test_estimates_head_from_neck_when_face_is_not_detected(self):
        box = head_box(person(None, neck_xy=(100, 120), mid_hip_xy=(100, 200))["body25"], 320, 240)
        self.assertIsNotNone(box)
        x0, y0, x1, y1 = box
        self.assertTrue(x0 < 100 < x1 and y0 < 120 - 0.45 * 80 < y1)

    def test_no_box_without_head_or_torso(self):
        self.assertIsNone(head_box([{"id": 4, "x": 10, "y": 10, "confidence": 0.9}], 320, 240))

    def test_low_confidence_and_zero_joints_are_ignored(self):
        body = [{"id": 0, "x": 0.0, "y": 0.0, "confidence": 0.9}, {"id": 15, "x": 50, "y": 50, "confidence": 0.01}]
        self.assertIsNone(head_box(body, 320, 240))


class ObscureTests(unittest.TestCase):
    def test_region_loses_detail(self):
        rng = np.random.default_rng(1)
        frame = rng.integers(0, 256, size=(240, 320, 3), dtype=np.uint8)
        before = sharpness(frame[40:120, 100:200])
        obscure_region(frame, (100, 40, 200, 120))
        after = sharpness(frame[40:120, 100:200])
        self.assertLess(after, before * 0.02)


class AnonymizeVideoTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def test_heads_are_obscured_and_undetected_frames_fully_blurred(self):
        src = write_textured_video(self.tmp / "in.mp4", frames=30)
        frames = []
        for i in range(30):
            # frames 0-9 detected, 10-14 missing (carried), 15-29 missing (full blur)
            people = [person((160, 60), neck_xy=(160, 90))] if i < 10 else []
            frames.append({"frame_index": i, "people": people})

        stats = anonymize_video(src, self.tmp / "out.mp4", frames, carry_frames=5)
        self.assertEqual(stats["frames"], 30)
        self.assertEqual(stats["carried_frames"], 5)
        self.assertEqual(stats["fully_blurred_frames"], 15)

        original = read_frames(src)
        blurred = read_frames(self.tmp / "out.mp4")
        self.assertEqual(len(blurred), 30)
        face = (slice(40, 80), slice(140, 180))
        for i in (0, 12):  # detected and carried frames: face obscured
            self.assertLess(sharpness(blurred[i][face]), 0.05 * sharpness(original[i][face]))
        # Outside the head box the detected frame keeps its detail (codec noise aside).
        corner = (slice(180, 240), slice(0, 60))
        self.assertGreater(sharpness(blurred[0][corner]), 0.3 * sharpness(original[0][corner]))
        # Frames without any detection are blurred everywhere.
        self.assertLess(sharpness(blurred[20][corner]), 0.05 * sharpness(original[20][corner]))

    def test_unreadable_input_raises(self):
        with self.assertRaises(RuntimeError):
            anonymize_video(self.tmp / "missing.mp4", self.tmp / "out.mp4", [])

    def test_probe_video(self):
        src = write_textured_video(self.tmp / "probe.mp4", frames=50, width=320, height=240, fps=25.0)
        info = probe_video(src)
        self.assertEqual((info["width"], info["height"]), (320, 240))
        self.assertAlmostEqual(info["fps"], 25.0, places=1)
        self.assertEqual(info["frame_count"], 50)
        self.assertAlmostEqual(info["duration_sec"], 2.0, places=1)
        self.assertEqual(probe_video(self.tmp / "missing.mp4")["fps"], None)


if __name__ == "__main__":
    unittest.main()
