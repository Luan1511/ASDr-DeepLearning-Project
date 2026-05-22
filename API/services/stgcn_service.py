from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import torch

from openpose_excel_stgcn_pipeline import (
    _load_stgcn_from_checkpoint,
    _predict_sequence,
)


class STGCNPredictor:
    def __init__(
        self,
        checkpoint_path: Path,
        device: str = "cuda",
        seq_len: int = 128,
        input_layout: str = "openpose",
        normalization: Optional[str] = None,
    ):
        self.checkpoint_path = Path(checkpoint_path)
        self.device = device
        self.seq_len = seq_len
        self.input_layout = input_layout
        self.normalization = normalization

        if self.device.startswith("cuda") and not torch.cuda.is_available():
            self.device = "cpu"

        if not self.checkpoint_path.exists():
            raise FileNotFoundError(f"ST-GCN checkpoint not found: {self.checkpoint_path}")

        self.model, self.ckpt = _load_stgcn_from_checkpoint(self.checkpoint_path)
        self.model = self.model.to(self.device)
        self.model.eval()

    def predict_from_api_frames(
        self,
        frames: List[dict],
        sample_id: str = "api_sample",
        threshold: float = 0.5,
        temperature: float = 1.0,
    ) -> Dict[str, object]:
        seq_xy = self._api_frames_to_seq_xy(frames)

        if seq_xy.shape[0] == 0:
            raise ValueError("Không có frame/keypoint hợp lệ để predict")

        result = _predict_sequence(
            model=self.model,
            ckpt=self.ckpt,
            seq_xy=seq_xy,
            sample_id=sample_id,
            seq_len=self.seq_len,
            input_layout=self.input_layout,
            normalization=self.normalization,
            trim_zero_ends=True,
            threshold=threshold,
            temperature=temperature,
            device=self.device,
            debug=False,
            remove_to_18=False,
            remove_to_17=False,
            remove_kp=None,
            excel_removed_kp=None,
            expect_joints=None,
        )

        result["label_name"] = self._label_name(result)

        return result

    def _api_frames_to_seq_xy(self, frames: List[dict]) -> np.ndarray:
        sequence = []

        sorted_frames = sorted(
            frames,
            key=lambda item: int(item.get("frame_index", 0)),
        )

        for frame in sorted_frames:
            people = frame.get("people", [])

            if not people:
                continue

            person = self._select_best_person(people)
            body25 = person.get("body25", [])

            if not body25:
                continue

            points = sorted(
                body25,
                key=lambda item: int(item.get("id", 0)),
            )

            if len(points) < 25:
                continue

            xy = []

            for point in points[:25]:
                xy.append(
                    [
                        float(point.get("x", 0.0)),
                        float(point.get("y", 0.0)),
                    ]
                )

            sequence.append(xy)

        if not sequence:
            return np.zeros((0, 25, 2), dtype=np.float32)

        arr = np.asarray(sequence, dtype=np.float32)
        arr[~np.isfinite(arr)] = 0.0

        return arr

    def _select_best_person(self, people: List[dict]) -> dict:
        def person_score(person: dict) -> float:
            body25 = person.get("body25", [])

            if not body25:
                return -1.0

            confs = []

            for point in body25:
                confs.append(float(point.get("confidence", 0.0)))

            if not confs:
                return -1.0

            return float(np.mean(confs))

        return max(people, key=person_score)

    def _label_name(self, result: Dict[str, object]) -> str:
        label = int(result.get("label_threshold", result.get("pred_argmax", 0)))

        if label == 1:
            return "ASD"

        return "Typical"