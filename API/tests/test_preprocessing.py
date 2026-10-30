import unittest
import numpy as np

from services.preprocessing import impute_missing_keypoints, get_imputation_stats


class PreprocessingTests(unittest.TestCase):
    def test_impute_single_missing_frame(self):
        # 5 frames, 1 joint, 2 coords
        seq = np.zeros((5, 1, 2), dtype=np.float32)
        # Frame 0: (10, 20)
        # Frame 1: (20, 40)
        # Frame 2: (0, 0) -- missing!
        # Frame 3: (40, 80)
        # Frame 4: (50, 100)
        seq[0, 0] = [10.0, 20.0]
        seq[1, 0] = [20.0, 40.0]
        seq[2, 0] = [0.0, 0.0]
        seq[3, 0] = [40.0, 80.0]
        seq[4, 0] = [50.0, 100.0]

        imputed = impute_missing_keypoints(seq, max_gap=5, method="linear")

        # Frame 2 should be exactly halfway between Frame 1 (20, 40) and Frame 3 (40, 80)
        self.assertAlmostEqual(imputed[2, 0, 0], 30.0, places=4)
        self.assertAlmostEqual(imputed[2, 0, 1], 60.0, places=4)

        stats = get_imputation_stats(seq, imputed)
        self.assertEqual(stats["raw_missing_joint_frames"], 1)
        self.assertEqual(stats["recovered_joint_frames"], 1)
        self.assertEqual(stats["remaining_missing_joint_frames"], 0)

    def test_impute_multi_frame_gap_within_max_gap(self):
        # 10 frames, 1 joint: gap from frame 3 to 6 (4 frames missing <= 5)
        seq = np.zeros((10, 1, 2), dtype=np.float32)
        for t in range(10):
            seq[t, 0] = [float(t * 10), float(t * 10)]

        # Drop frames 3, 4, 5, 6
        for t in (3, 4, 5, 6):
            seq[t, 0] = [0.0, 0.0]

        imputed = impute_missing_keypoints(seq, max_gap=5, method="linear")

        # Check linear interpolation values
        # prev is t=2 (val 20), next is t=7 (val 70)
        # t=3: 20 + 1/5*(50) = 30
        # t=4: 20 + 2/5*(50) = 40
        # t=5: 20 + 3/5*(50) = 50
        # t=6: 20 + 4/5*(50) = 60
        for t in (3, 4, 5, 6):
            expected = float(t * 10)
            self.assertAlmostEqual(imputed[t, 0, 0], expected, places=3)
            self.assertAlmostEqual(imputed[t, 0, 1], expected, places=3)

    def test_do_not_impute_gap_exceeding_max_gap(self):
        # 12 frames, 1 joint: gap of 6 frames (frames 3 to 8) > max_gap (5)
        seq = np.zeros((12, 1, 2), dtype=np.float32)
        for t in range(12):
            seq[t, 0] = [float(t * 10), float(t * 10)]

        for t in range(3, 9):  # 3, 4, 5, 6, 7, 8 -> 6 frames
            seq[t, 0] = [0.0, 0.0]

        imputed = impute_missing_keypoints(seq, max_gap=5, method="linear")

        # None of the frames in gap should be imputed
        for t in range(3, 9):
            self.assertEqual(imputed[t, 0, 0], 0.0)
            self.assertEqual(imputed[t, 0, 1], 0.0)

    def test_do_not_extrapolate_at_start_or_end(self):
        # Missing at frame 0 and 1 (start) and frame 8, 9 (end)
        seq = np.zeros((10, 1, 2), dtype=np.float32)
        for t in range(2, 8):
            seq[t, 0] = [float(t * 10), float(t * 10)]

        imputed = impute_missing_keypoints(seq, max_gap=5, method="linear")

        self.assertEqual(imputed[0, 0, 0], 0.0)
        self.assertEqual(imputed[1, 0, 0], 0.0)
        self.assertEqual(imputed[8, 0, 0], 0.0)
        self.assertEqual(imputed[9, 0, 0], 0.0)

    def test_confidence_threshold_filtering(self):
        # Low confidence points should be treated as missing and imputed
        seq = np.zeros((5, 1, 2), dtype=np.float32)
        seq[0, 0] = [10.0, 10.0]
        seq[1, 0] = [20.0, 20.0]
        seq[2, 0] = [999.0, 999.0]  # Jitter/garbage point with low confidence!
        seq[3, 0] = [40.0, 40.0]
        seq[4, 0] = [50.0, 50.0]

        conf = np.array([[1.0], [0.9], [0.01], [0.85], [0.95]], dtype=np.float32)

        imputed = impute_missing_keypoints(seq, max_gap=5, method="linear", confidences=conf, min_confidence=0.1)

        # Frame 2 should be imputed smoothly between 20.0 and 40.0 -> 30.0!
        self.assertAlmostEqual(imputed[2, 0, 0], 30.0, places=3)
        self.assertAlmostEqual(imputed[2, 0, 1], 30.0, places=3)

    def test_cubic_interpolation(self):
        # Sine-like smooth curve with 1 frame drop
        T = 15
        t_arr = np.linspace(0, np.pi, T)
        seq = np.zeros((T, 1, 2), dtype=np.float32)
        for i in range(T):
            seq[i, 0] = [float(np.sin(t_arr[i])), float(np.cos(t_arr[i]))]

        # Drop frame 7
        seq[7, 0] = [0.0, 0.0]

        imputed_cubic = impute_missing_keypoints(seq, max_gap=5, method="cubic")
        expected_x = float(np.sin(t_arr[7]))
        expected_y = float(np.cos(t_arr[7]))

        self.assertAlmostEqual(imputed_cubic[7, 0, 0], expected_x, delta=0.05)
        self.assertAlmostEqual(imputed_cubic[7, 0, 1], expected_y, delta=0.05)

    def test_reject_single_frame_outlier_spike(self):
        from services.preprocessing import reject_outlier_spikes

        # 10 frames, 2 joints: Joint 0 has neck (0, 0) and Joint 1 has hip (0, 100) -> torso=100
        # Joint 2 (knee) moves along x=50, y=150, but at frame 5 jumps wildly to x=500, y=500!
        seq = np.zeros((10, 3, 2), dtype=np.float32)
        for t in range(10):
            seq[t, 0] = [100.0, 50.0]  # neck
            seq[t, 1] = [100.0, 150.0]  # hip (torso=100)
            seq[t, 2] = [100.0 + t * 2.0, 200.0]  # knee

        # Inject single-frame wild jump at t=5
        seq[5, 2] = [800.0, 800.0]

        cleaned, spike_mask = reject_outlier_spikes(seq, max_displacement_ratio=0.35)

        # Frame 5 joint 2 should be flagged as spike and zeroed
        self.assertTrue(spike_mask[5, 2])
        self.assertEqual(cleaned[5, 2, 0], 0.0)
        self.assertEqual(cleaned[5, 2, 1], 0.0)

        # Other frames must remain untouched
        self.assertFalse(spike_mask[4, 2])
        self.assertFalse(spike_mask[6, 2])

    def test_end_to_end_preprocess_skeleton_sequence(self):
        from services.preprocessing import preprocess_skeleton_sequence

        # 10 frames: Joint 0 (neck), Joint 1 (hip), Joint 2 (knee)
        seq = np.zeros((10, 3, 2), dtype=np.float32)
        for t in range(10):
            seq[t, 0] = [100.0, 50.0]
            seq[t, 1] = [100.0, 150.0]
            seq[t, 2] = [100.0, float(200 + t * 5)]  # moves smoothly 200, 205, 210...

        # Inject wild spike at frame 4 (e.g. knee jumped 300px away)
        seq[4, 2] = [400.0, 500.0]
        # Inject missing dropout at frame 7 (zero)
        seq[7, 2] = [0.0, 0.0]

        # Process end to end
        result = preprocess_skeleton_sequence(seq, max_gap=5, max_displacement_ratio=0.35)

        # Both frame 4 (spike) and frame 7 (missing) should be smoothly recovered
        # Expected at t=4: ~220
        self.assertAlmostEqual(result[4, 2, 0], 100.0, delta=2.0)
        self.assertAlmostEqual(result[4, 2, 1], 220.0, delta=5.0)

        # Expected at t=7: ~235
        self.assertAlmostEqual(result[7, 2, 0], 100.0, delta=2.0)
        self.assertAlmostEqual(result[7, 2, 1], 235.0, delta=5.0)


if __name__ == "__main__":
    unittest.main()
