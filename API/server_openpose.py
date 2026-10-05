import hashlib
import json
import logging
import os
import re
import secrets
import shutil
import subprocess
import threading
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, UploadFile

from services.anonymize import anonymize_video, probe_video
from services.stgcn_service import STGCNPredictor

logger = logging.getLogger("asd_api")

# =========================
# CONFIG (environment overrides; relative paths resolve against this folder)
# =========================

API_DIR = Path(__file__).resolve().parent


def _env_path(name: str, default: str) -> Path:
    path = Path(os.getenv(name, default))
    return path if path.is_absolute() else API_DIR / path


OPENPOSE_BIN = _env_path("OPENPOSE_BIN", "/workspace/openpose/build_gtx1650_nocudnn/examples/openpose/openpose.bin")
OPENPOSE_MODEL_DIR = _env_path("OPENPOSE_MODEL_DIR", "/workspace/openpose/models")
OPENPOSE_NET_RESOLUTION = os.getenv("OPENPOSE_NET_RESOLUTION", "-1x256")
OPENPOSE_TIMEOUT_SECONDS = int(os.getenv("OPENPOSE_TIMEOUT_SECONDS", "3600"))

SUBJECT_ROOT = _env_path("SUBJECT_ROOT", "storage/asd_subjects")

STGCN_CHECKPOINT = _env_path("STGCN_CHECKPOINT", "ASD_Model/finetuned_best_model.pth")
CALIBRATION_PATH = _env_path("CALIBRATION_PATH", str(STGCN_CHECKPOINT.parent / "calibration.json"))
STGCN_DEVICE = os.getenv("STGCN_DEVICE", "cuda")

# Shared secret expected in the X-API-Key header (the backend's OPENPOSE_API_KEY).
ML_API_KEY = os.getenv("ML_API_KEY") or None
# OpenPose saturates a GTX 1650; run one job at a time unless told otherwise.
ML_MAX_CONCURRENT_JOBS = max(1, int(os.getenv("ML_MAX_CONCURRENT_JOBS", "1")))
# What stays on disk after extraction: blurred (faces obscured) | none | raw.
VIDEO_RETENTION = os.getenv("VIDEO_RETENTION", "blurred").strip().lower()
if VIDEO_RETENTION not in ("blurred", "none", "raw"):
    raise RuntimeError(f"VIDEO_RETENTION must be blurred, none or raw (got {VIDEO_RETENTION!r})")

DEFAULT_THRESHOLD = 0.5
DEFAULT_TEMPERATURE = 1.0

ALLOWED_VIDEO_EXTENSIONS = (".mp4", ".avi", ".mov", ".mkv", ".webm")
SUBJECT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
KEYPOINT_FORMAT = "OpenPose BODY_25"
API_VERSION = "2.0.0"

SUBJECT_ROOT.mkdir(parents=True, exist_ok=True)


# =========================
# APP
# =========================

@asynccontextmanager
async def lifespan(_app: FastAPI):
    startup()
    yield


app = FastAPI(
    title="ASD OpenPose + ST-GCN",
    version=API_VERSION,
    lifespan=lifespan,
)


stgcn_predictor: Optional[STGCNPredictor] = None
model_info: dict = {}
calibration: Optional[dict] = None
gpu_slots = threading.BoundedSemaphore(ML_MAX_CONCURRENT_JOBS)

# =========================
# STARTUP
# =========================


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_calibration(checkpoint_sha256: str) -> Optional[dict]:
    """Temperature + thresholds fitted on the validation split
    (research_src/calibrate_evaluate.py). Ignored if fitted for another checkpoint."""
    if not CALIBRATION_PATH.exists():
        logger.warning("No calibration file at %s; using threshold=%s, T=%s", CALIBRATION_PATH, DEFAULT_THRESHOLD, DEFAULT_TEMPERATURE)
        return None
    try:
        data = load_json(CALIBRATION_PATH)
        temperature = float(data["temperature"])
        threshold = float(data["threshold"])
        high = float(data.get("high_risk_threshold", threshold))
        if not (temperature > 0 and 0.0 <= threshold <= 1.0 and threshold <= high <= 1.0):
            raise ValueError("calibration values out of range")
    except Exception as exc:  # noqa: BLE001 - a broken file must not stop the server
        logger.error("Ignoring invalid calibration file %s: %s", CALIBRATION_PATH, exc)
        return None

    expected = data.get("checkpoint_sha256")
    if not expected:
        # Thresholds only mean something for the checkpoint they were fitted on.
        logger.error("Ignoring calibration %s: it has no checkpoint_sha256 (re-run calibrate with --checkpoint)", CALIBRATION_PATH)
        return None
    if expected != checkpoint_sha256:
        logger.error(
            "Ignoring calibration %s: fitted for checkpoint %s..., loaded %s...",
            CALIBRATION_PATH,
            str(expected)[:12],
            checkpoint_sha256[:12],
        )
        return None
    return {"temperature": temperature, "threshold": threshold, "high_risk_threshold": high, "source": data}


def startup():
    global stgcn_predictor, model_info, calibration

    stgcn_predictor = STGCNPredictor(
        checkpoint_path=STGCN_CHECKPOINT,
        device=STGCN_DEVICE,
        seq_len=128,
        input_layout="openpose",
        normalization=None,
    )
    checkpoint_sha256 = _sha256(STGCN_CHECKPOINT)
    model_info = {
        "checkpoint": STGCN_CHECKPOINT.name,
        "sha256": checkpoint_sha256,
        "num_joints": int(stgcn_predictor.ckpt.get("num_joints", 18)),
    }
    calibration = load_calibration(checkpoint_sha256)
    logger.info("Model %s loaded on %s; calibrated=%s", STGCN_CHECKPOINT.name, stgcn_predictor.device, calibration is not None)


# =========================
# UTILS
# =========================


def require_api_key(x_api_key: Optional[str] = Header(default=None)):
    if ML_API_KEY is None:
        return
    if not x_api_key or not secrets.compare_digest(x_api_key, ML_API_KEY):
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key")


def validate_video_file(video: UploadFile):
    filename = video.filename or ""

    if not filename.lower().endswith(ALLOWED_VIDEO_EXTENSIONS):
        raise HTTPException(
            status_code=400,
            detail="Unsupported video format. Use .mp4, .avi, .mov, .mkv or .webm",
        )


def save_json(path: Path, data: dict):
    path.parent.mkdir(parents=True, exist_ok=True)

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def load_json(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def subject_path(subject_id: str) -> Path:
    """Directory for a subject id; rejects ids that could escape SUBJECT_ROOT."""
    if not SUBJECT_ID_RE.fullmatch(subject_id or ""):
        raise HTTPException(
            status_code=422,
            detail="subject_id must be 1-64 characters of letters, digits, '-' or '_'",
        )
    path = (SUBJECT_ROOT / subject_id).resolve()
    if path.parent != SUBJECT_ROOT.resolve():
        raise HTTPException(status_code=422, detail="Invalid subject_id")
    return path


def create_subject_dir(subject_id: Optional[str] = None) -> tuple[str, Path]:
    if subject_id is None or not subject_id.strip():
        subject_id = str(uuid.uuid4())

    subject_id = subject_id.strip()
    subject_dir = subject_path(subject_id)

    if subject_dir.exists():
        raise HTTPException(
            status_code=409,
            detail=f"Subject already exists: {subject_id}",
        )

    subject_dir.mkdir(parents=True, exist_ok=False)

    return subject_id, subject_dir


def get_subject_dir(subject_id: str) -> Path:
    subject_dir = subject_path(subject_id)

    if not subject_dir.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Subject not found: {subject_id}",
        )

    return subject_dir


def read_openpose_json(output_dir: Path) -> list[dict]:
    frames = []
    json_files = sorted(output_dir.glob("*_keypoints.json"))

    for frame_idx, json_path in enumerate(json_files):
        data = load_json(json_path)

        people = data.get("people", [])
        frame_people = []

        for person_idx, person in enumerate(people):
            keypoints = person.get("pose_keypoints_2d", [])
            points = []

            for i in range(0, len(keypoints), 3):
                if i + 2 >= len(keypoints):
                    continue

                points.append(
                    {
                        "id": i // 3,
                        "x": float(keypoints[i]),
                        "y": float(keypoints[i + 1]),
                        "confidence": float(keypoints[i + 2]),
                    }
                )

            frame_people.append(
                {
                    "person_id": person_idx,
                    "body25": points,
                }
            )

        frames.append(
            {
                "frame_index": frame_idx,
                "people": frame_people,
            }
        )

    return frames


def run_openpose_on_video(input_path: Path, output_dir: Path) -> list[dict]:
    if not OPENPOSE_BIN.exists():
        raise HTTPException(
            status_code=500,
            detail=f"OpenPose binary not found: {OPENPOSE_BIN}",
        )

    if not OPENPOSE_MODEL_DIR.exists():
        raise HTTPException(
            status_code=500,
            detail=f"OpenPose model folder not found: {OPENPOSE_MODEL_DIR}",
        )

    output_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        str(OPENPOSE_BIN),
        "--video",
        str(input_path),
        "--write_json",
        str(output_dir),
        "--display",
        "0",
        "--render_pose",
        "0",
        "--net_resolution",
        OPENPOSE_NET_RESOLUTION,
        "--model_pose",
        "BODY_25",
        "--model_folder",
        str(OPENPOSE_MODEL_DIR),
    ]

    result = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=OPENPOSE_TIMEOUT_SECONDS,
    )

    if result.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=result.stderr[-4000:],
        )

    frames = read_openpose_json(output_dir)

    if not frames:
        raise HTTPException(
            status_code=500,
            detail="OpenPose finished but no keypoint JSON was produced",
        )

    return frames


def save_uploaded_video(video: UploadFile, dst: Path):
    dst.parent.mkdir(parents=True, exist_ok=True)

    with open(dst, "wb") as f:
        shutil.copyfileobj(video.file, f)


def apply_video_retention(input_path: Path, frames: list[dict]) -> dict:
    """Enforce VIDEO_RETENTION once keypoints exist. Privacy wins on failure:
    if blurring fails the raw video is deleted rather than kept."""
    if VIDEO_RETENTION == "raw":
        return {"video_retention": "raw", "stored_video": input_path}

    if VIDEO_RETENTION == "blurred":
        blurred_path = input_path.with_name("input_blurred.mp4")
        try:
            stats = anonymize_video(input_path, blurred_path, frames)
            input_path.unlink(missing_ok=True)
            return {"video_retention": "blurred", "stored_video": blurred_path, "anonymization": stats}
        except Exception as exc:  # noqa: BLE001
            logger.error("Face anonymisation failed for %s: %s; deleting the raw video", input_path, exc)
            blurred_path.unlink(missing_ok=True)
            input_path.unlink(missing_ok=True)
            return {"video_retention": "none", "stored_video": None, "anonymization_error": str(exc)[:500]}

    input_path.unlink(missing_ok=True)
    return {"video_retention": "none", "stored_video": None}


def build_subject_metadata(
    subject_id: str,
    filename: str,
    num_frames: int,
    status: str,
    has_prediction: bool,
    video_info: Optional[dict] = None,
    retention: Optional[dict] = None,
) -> dict:
    metadata = {
        "subject_id": subject_id,
        "filename": filename,
        "created_at": datetime.now().isoformat(),
        "keypoint_format": KEYPOINT_FORMAT,
        "num_frames": num_frames,
        "status": status,
        "has_prediction": has_prediction,
        "video": video_info,
    }
    if retention is not None:
        metadata["video_retention"] = retention["video_retention"]
        if "anonymization" in retention:
            metadata["anonymization"] = retention["anonymization"]
        if "anonymization_error" in retention:
            metadata["anonymization_error"] = retention["anonymization_error"]
    return metadata


def resolve_decision_params(threshold: Optional[float], temperature: Optional[float]) -> dict:
    """Caller overrides > calibration.json > defaults."""
    cal = calibration
    use_threshold = threshold if threshold is not None else (cal["threshold"] if cal else DEFAULT_THRESHOLD)
    use_temperature = temperature if temperature is not None else (cal["temperature"] if cal else DEFAULT_TEMPERATURE)
    calibrated = cal is not None and threshold is None and temperature is None
    high = cal["high_risk_threshold"] if calibrated else None
    return {"threshold": use_threshold, "temperature": use_temperature, "high_risk_threshold": high, "calibrated": calibrated}


def predict_frames(subject_id: str, frames: list[dict], threshold: Optional[float], temperature: Optional[float]) -> dict:
    if stgcn_predictor is None:
        raise HTTPException(
            status_code=500,
            detail="ST-GCN model is not loaded",
        )

    params = resolve_decision_params(threshold, temperature)
    try:
        prediction = stgcn_predictor.predict_from_api_frames(
            frames=frames,
            sample_id=subject_id,
            threshold=params["threshold"],
            temperature=params["temperature"],
        )
    except ValueError as exc:
        # e.g. no frame with a complete BODY_25 skeleton
        raise HTTPException(
            status_code=422,
            detail=f"Không phát hiện được người trong video đủ để phân tích: {exc}",
        ) from exc

    prediction["high_risk_threshold"] = params["high_risk_threshold"]
    prediction["calibrated"] = params["calibrated"]
    prediction["model"] = model_info
    return prediction


def run_prediction_for_subject(
    subject_id: str,
    threshold: Optional[float],
    temperature: Optional[float],
) -> dict:
    subject_dir = get_subject_dir(subject_id)
    keypoints_path = subject_dir / "keypoints_body25.json"

    if not keypoints_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Keypoints not found for subject: {subject_id}",
        )

    keypoint_payload = load_json(keypoints_path)
    frames = keypoint_payload.get("frames", [])

    if not frames:
        raise HTTPException(
            status_code=400,
            detail=f"No frames found in keypoints for subject: {subject_id}",
        )

    with gpu_slots:
        prediction = predict_frames(subject_id, frames, threshold, temperature)

    prediction_payload = {
        "subject_id": subject_id,
        "created_at": datetime.now().isoformat(),
        "prediction": prediction,
    }

    prediction_path = subject_dir / "prediction.json"
    metadata_path = subject_dir / "metadata.json"

    save_json(prediction_path, prediction_payload)

    if metadata_path.exists():
        metadata = load_json(metadata_path)
        metadata["status"] = "predicted"
        metadata["has_prediction"] = True
        metadata["prediction_updated_at"] = datetime.now().isoformat()
        save_json(metadata_path, metadata)

    return prediction_payload


def extract_keypoints(video: UploadFile, subject_dir: Path, subject_id: str) -> tuple[list[dict], dict, dict]:
    """Save the upload, run OpenPose, persist keypoints, apply the retention policy."""
    input_path = subject_dir / "input.mp4"
    openpose_output_dir = subject_dir / "openpose_json"
    keypoints_path = subject_dir / "keypoints_body25.json"

    save_uploaded_video(video, input_path)
    video_info = probe_video(input_path)

    with gpu_slots:
        frames = run_openpose_on_video(
            input_path=input_path,
            output_dir=openpose_output_dir,
        )

    keypoint_payload = {
        "subject_id": subject_id,
        "keypoint_format": KEYPOINT_FORMAT,
        "num_frames": len(frames),
        "video": video_info,
        "frames": frames,
    }
    save_json(keypoints_path, keypoint_payload)

    retention = apply_video_retention(input_path, frames)
    return frames, video_info, retention


def saved_paths(subject_dir: Path, retention: dict, *, with_prediction: bool) -> dict:
    stored = retention.get("stored_video")
    saved = {
        "subject_dir": str(subject_dir),
        "input_video": str(stored) if stored else None,
        "openpose_json_dir": str(subject_dir / "openpose_json"),
        "keypoints_path": str(subject_dir / "keypoints_body25.json"),
        "metadata_path": str(subject_dir / "metadata.json"),
    }
    if with_prediction:
        saved["prediction_path"] = str(subject_dir / "prediction.json")
    return saved


# =========================
# HEALTH
# =========================


@app.get("/")
def root():
    return {
        "message": "ASD API is running",
        "routes": [
            "GET /health",
            "POST /subjects/extract",
            "POST /subjects/{subject_id}/predict",
            "POST /pipeline/asd",
            "GET /subjects",
            "GET /subjects/{subject_id}",
            "GET /subjects/{subject_id}/keypoints",
            "GET /subjects/{subject_id}/prediction",
            "DELETE /subjects/{subject_id}",
        ],
    }


@app.get("/health")
def health():
    """Public status used by the backend's consent text and admin page (no secrets)."""
    try:
        import torch

        cuda_available = bool(torch.cuda.is_available())
    except Exception:  # noqa: BLE001
        cuda_available = False
    return {
        "status": "ok",
        "version": API_VERSION,
        "model_loaded": stgcn_predictor is not None,
        "model_device": stgcn_predictor.device if stgcn_predictor is not None else None,
        "calibrated": calibration is not None,
        "video_retention": VIDEO_RETENTION,
        "auth_required": ML_API_KEY is not None,
        "openpose_available": OPENPOSE_BIN.exists() and OPENPOSE_MODEL_DIR.exists(),
        "cuda_available": cuda_available,
        "max_concurrent_jobs": ML_MAX_CONCURRENT_JOBS,
    }


# =========================
# SUBJECT ROUTES
# =========================


@app.post("/subjects/extract", dependencies=[Depends(require_api_key)])
def extract_subject(
    video: UploadFile = File(...),
    subject_id: Optional[str] = Query(default=None),
):
    validate_video_file(video)

    subject_id, subject_dir = create_subject_dir(subject_id)
    metadata_path = subject_dir / "metadata.json"

    try:
        frames, video_info, retention = extract_keypoints(video, subject_dir, subject_id)

        metadata = build_subject_metadata(
            subject_id=subject_id,
            filename=video.filename or "input.mp4",
            num_frames=len(frames),
            status="extracted",
            has_prediction=False,
            video_info=video_info,
            retention=retention,
        )
        save_json(metadata_path, metadata)

        return {
            "subject_id": subject_id,
            "filename": video.filename,
            "num_frames": len(frames),
            "keypoint_format": KEYPOINT_FORMAT,
            "video": video_info,
            "video_retention": retention["video_retention"],
            "saved": saved_paths(subject_dir, retention, with_prediction=False),
        }

    except Exception:
        if subject_dir.exists():
            shutil.rmtree(subject_dir, ignore_errors=True)

        raise


@app.post("/subjects/{subject_id}/predict", dependencies=[Depends(require_api_key)])
def predict_subject(
    subject_id: str,
    threshold: Optional[float] = Query(default=None, ge=0.0, le=1.0),
    temperature: Optional[float] = Query(default=None, gt=0.0),
):
    return run_prediction_for_subject(
        subject_id=subject_id,
        threshold=threshold,
        temperature=temperature,
    )


@app.post("/pipeline/asd", dependencies=[Depends(require_api_key)])
def pipeline_asd(
    video: UploadFile = File(...),
    subject_id: Optional[str] = Query(default=None),
    threshold: Optional[float] = Query(default=None, ge=0.0, le=1.0),
    temperature: Optional[float] = Query(default=None, gt=0.0),
    return_keypoints: bool = Query(default=False),
):
    validate_video_file(video)

    subject_id, subject_dir = create_subject_dir(subject_id)
    prediction_path = subject_dir / "prediction.json"
    metadata_path = subject_dir / "metadata.json"

    try:
        frames, video_info, retention = extract_keypoints(video, subject_dir, subject_id)

        with gpu_slots:
            prediction = predict_frames(subject_id, frames, threshold, temperature)

        prediction_payload = {
            "subject_id": subject_id,
            "created_at": datetime.now().isoformat(),
            "prediction": prediction,
        }

        metadata = build_subject_metadata(
            subject_id=subject_id,
            filename=video.filename or "input.mp4",
            num_frames=len(frames),
            status="predicted",
            has_prediction=True,
            video_info=video_info,
            retention=retention,
        )

        save_json(prediction_path, prediction_payload)
        save_json(metadata_path, metadata)

        response = {
            "subject_id": subject_id,
            "filename": video.filename,
            "num_frames": len(frames),
            "keypoint_format": KEYPOINT_FORMAT,
            "video": video_info,
            "video_retention": retention["video_retention"],
            "prediction": prediction,
            "saved": saved_paths(subject_dir, retention, with_prediction=True),
        }

        if return_keypoints:
            response["frames"] = frames

        return response

    except Exception:
        if subject_dir.exists():
            shutil.rmtree(subject_dir, ignore_errors=True)

        raise


@app.get("/subjects", dependencies=[Depends(require_api_key)])
def list_subjects():
    subjects = []

    if not SUBJECT_ROOT.exists():
        return {
            "total": 0,
            "subjects": [],
        }

    for subject_dir in sorted(SUBJECT_ROOT.iterdir()):
        if not subject_dir.is_dir():
            continue

        metadata_path = subject_dir / "metadata.json"

        if not metadata_path.exists():
            continue

        metadata = load_json(metadata_path)
        subjects.append(metadata)

    return {
        "total": len(subjects),
        "subjects": subjects,
    }


@app.get("/subjects/{subject_id}", dependencies=[Depends(require_api_key)])
def get_subject(subject_id: str):
    subject_dir = get_subject_dir(subject_id)
    metadata_path = subject_dir / "metadata.json"
    prediction_path = subject_dir / "prediction.json"

    if not metadata_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Metadata not found for subject: {subject_id}",
        )

    response = {
        "metadata": load_json(metadata_path),
    }

    if prediction_path.exists():
        response["prediction"] = load_json(prediction_path)

    return response


@app.get("/subjects/{subject_id}/keypoints", dependencies=[Depends(require_api_key)])
def get_subject_keypoints(subject_id: str):
    subject_dir = get_subject_dir(subject_id)
    keypoints_path = subject_dir / "keypoints_body25.json"

    if not keypoints_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Keypoints not found for subject: {subject_id}",
        )

    payload = load_json(keypoints_path)
    if "video" not in payload:
        # Subjects extracted before video probing existed.
        metadata_path = subject_dir / "metadata.json"
        payload["video"] = load_json(metadata_path).get("video") if metadata_path.exists() else None
    return payload


@app.get("/subjects/{subject_id}/prediction", dependencies=[Depends(require_api_key)])
def get_subject_prediction(subject_id: str):
    subject_dir = get_subject_dir(subject_id)
    prediction_path = subject_dir / "prediction.json"

    if not prediction_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Prediction not found for subject: {subject_id}",
        )

    return load_json(prediction_path)


@app.delete("/subjects/{subject_id}", dependencies=[Depends(require_api_key)])
def delete_subject(subject_id: str):
    subject_dir = get_subject_dir(subject_id)
    shutil.rmtree(subject_dir, ignore_errors=True)

    return {
        "subject_id": subject_id,
        "deleted": True,
    }
