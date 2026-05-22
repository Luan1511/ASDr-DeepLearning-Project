import json
import shutil
import subprocess
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from pydantic import BaseModel

from services.stgcn_service import STGCNPredictor

# =========================
# CONFIG
# =========================

OPENPOSE_BIN = Path("/workspace/openpose/build/examples/openpose/openpose.bin")
OPENPOSE_MODEL_DIR = Path("/workspace/openpose/models")

SUBJECT_ROOT = Path("storage/asd_subjects")

STGCN_CHECKPOINT = Path("ASD_Model/finetuned_best_model.pth")

ALLOWED_VIDEO_EXTENSIONS = (".mp4", ".avi", ".mov", ".mkv")

SUBJECT_ROOT.mkdir(parents=True, exist_ok=True)


# =========================
# APP
# =========================

app = FastAPI(
    title="ASD OpenPose + ST-GCN",
    version="1.0.0",
)


stgcn_predictor: Optional[STGCNPredictor] = None

# =========================
# STARTUP
# =========================

@app.on_event("startup")
def startup():
    global stgcn_predictor
    global llama_registry

    stgcn_predictor = STGCNPredictor(
        checkpoint_path=STGCN_CHECKPOINT,
        device="cuda",
        seq_len=128,
        input_layout="openpose",
        normalization=None,
    )


# =========================
# UTILS
# =========================

def validate_video_file(video: UploadFile):
    filename = video.filename or ""

    if not filename.lower().endswith(ALLOWED_VIDEO_EXTENSIONS):
        raise HTTPException(
            status_code=400,
            detail="Unsupported video format. Use .mp4, .avi, .mov, or .mkv",
        )


def save_json(path: Path, data: dict):
    path.parent.mkdir(parents=True, exist_ok=True)

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def load_json(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def create_subject_dir(subject_id: Optional[str] = None) -> tuple[str, Path]:
    if subject_id is None or not subject_id.strip():
        subject_id = str(uuid.uuid4())

    subject_id = subject_id.strip()
    subject_dir = SUBJECT_ROOT / subject_id

    if subject_dir.exists():
        raise HTTPException(
            status_code=409,
            detail=f"Subject already exists: {subject_id}",
        )

    subject_dir.mkdir(parents=True, exist_ok=False)

    return subject_id, subject_dir


def get_subject_dir(subject_id: str) -> Path:
    subject_dir = SUBJECT_ROOT / subject_id

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
        "-1x256",
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
        timeout=600,
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


def build_subject_metadata(
    subject_id: str,
    filename: str,
    num_frames: int,
    status: str,
    has_prediction: bool,
) -> dict:
    return {
        "subject_id": subject_id,
        "filename": filename,
        "created_at": datetime.now().isoformat(),
        "keypoint_format": "OpenPose BODY_25",
        "num_frames": num_frames,
        "status": status,
        "has_prediction": has_prediction,
    }


def run_prediction_for_subject(
    subject_id: str,
    threshold: float,
    temperature: float,
) -> dict:
    if stgcn_predictor is None:
        raise HTTPException(
            status_code=500,
            detail="ST-GCN model is not loaded",
        )

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

    prediction = stgcn_predictor.predict_from_api_frames(
        frames=frames,
        sample_id=subject_id,
        threshold=threshold,
        temperature=temperature,
    )

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


# =========================
# HEALTH
# =========================

@app.get("/")
def root():
    return {
        "message": "ASD API is running",
        "routes": [
            "POST /subjects/extract",
            "POST /subjects/{subject_id}/predict",
            "POST /pipeline/asd",
            "GET /subjects",
            "GET /subjects/{subject_id}",
            "GET /subjects/{subject_id}/keypoints",
            "GET /subjects/{subject_id}/prediction",
        ],
    }


# =========================
# SUBJECT ROUTES
# =========================

@app.post("/subjects/extract")
async def extract_subject(
    video: UploadFile = File(...),
    subject_id: Optional[str] = Query(default=None),
):
    validate_video_file(video)

    subject_id, subject_dir = create_subject_dir(subject_id)

    input_path = subject_dir / "input.mp4"
    openpose_output_dir = subject_dir / "openpose_json"
    keypoints_path = subject_dir / "keypoints_body25.json"
    metadata_path = subject_dir / "metadata.json"

    try:
        save_uploaded_video(video, input_path)

        frames = run_openpose_on_video(
            input_path=input_path,
            output_dir=openpose_output_dir,
        )

        keypoint_payload = {
            "subject_id": subject_id,
            "keypoint_format": "OpenPose BODY_25",
            "num_frames": len(frames),
            "frames": frames,
        }

        metadata = build_subject_metadata(
            subject_id=subject_id,
            filename=video.filename or "input.mp4",
            num_frames=len(frames),
            status="extracted",
            has_prediction=False,
        )

        save_json(keypoints_path, keypoint_payload)
        save_json(metadata_path, metadata)

        return {
            "subject_id": subject_id,
            "filename": video.filename,
            "num_frames": len(frames),
            "keypoint_format": "OpenPose BODY_25",
            "saved": {
                "subject_dir": str(subject_dir),
                "input_video": str(input_path),
                "openpose_json_dir": str(openpose_output_dir),
                "keypoints_path": str(keypoints_path),
                "metadata_path": str(metadata_path),
            },
        }

    except Exception:
        if subject_dir.exists():
            shutil.rmtree(subject_dir, ignore_errors=True)

        raise


@app.post("/subjects/{subject_id}/predict")
def predict_subject(
    subject_id: str,
    threshold: float = Query(default=0.5, ge=0.0, le=1.0),
    temperature: float = Query(default=1.0, gt=0.0),
):
    return run_prediction_for_subject(
        subject_id=subject_id,
        threshold=threshold,
        temperature=temperature,
    )


@app.post("/pipeline/asd")
async def pipeline_asd(
    video: UploadFile = File(...),
    subject_id: Optional[str] = Query(default=None),
    threshold: float = Query(default=0.5, ge=0.0, le=1.0),
    temperature: float = Query(default=1.0, gt=0.0),
    return_keypoints: bool = Query(default=False),
):
    validate_video_file(video)

    subject_id, subject_dir = create_subject_dir(subject_id)

    input_path = subject_dir / "input.mp4"
    openpose_output_dir = subject_dir / "openpose_json"
    keypoints_path = subject_dir / "keypoints_body25.json"
    prediction_path = subject_dir / "prediction.json"
    metadata_path = subject_dir / "metadata.json"

    try:
        save_uploaded_video(video, input_path)

        frames = run_openpose_on_video(
            input_path=input_path,
            output_dir=openpose_output_dir,
        )

        keypoint_payload = {
            "subject_id": subject_id,
            "keypoint_format": "OpenPose BODY_25",
            "num_frames": len(frames),
            "frames": frames,
        }

        save_json(keypoints_path, keypoint_payload)

        if stgcn_predictor is None:
            raise HTTPException(
                status_code=500,
                detail="ST-GCN model is not loaded",
            )

        prediction = stgcn_predictor.predict_from_api_frames(
            frames=frames,
            sample_id=subject_id,
            threshold=threshold,
            temperature=temperature,
        )

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
        )

        save_json(prediction_path, prediction_payload)
        save_json(metadata_path, metadata)

        response = {
            "subject_id": subject_id,
            "filename": video.filename,
            "num_frames": len(frames),
            "keypoint_format": "OpenPose BODY_25",
            "prediction": prediction,
            "saved": {
                "subject_dir": str(subject_dir),
                "input_video": str(input_path),
                "openpose_json_dir": str(openpose_output_dir),
                "keypoints_path": str(keypoints_path),
                "prediction_path": str(prediction_path),
                "metadata_path": str(metadata_path),
            },
        }

        if return_keypoints:
            response["frames"] = frames

        return response

    except Exception:
        if subject_dir.exists():
            shutil.rmtree(subject_dir, ignore_errors=True)

        raise


@app.get("/subjects")
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


@app.get("/subjects/{subject_id}")
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


@app.get("/subjects/{subject_id}/keypoints")
def get_subject_keypoints(subject_id: str):
    subject_dir = get_subject_dir(subject_id)
    keypoints_path = subject_dir / "keypoints_body25.json"

    if not keypoints_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Keypoints not found for subject: {subject_id}",
        )

    return load_json(keypoints_path)


@app.get("/subjects/{subject_id}/prediction")
def get_subject_prediction(subject_id: str):
    subject_dir = get_subject_dir(subject_id)
    prediction_path = subject_dir / "prediction.json"

    if not prediction_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Prediction not found for subject: {subject_id}",
        )

    return load_json(prediction_path)


@app.delete("/subjects/{subject_id}")
def delete_subject(subject_id: str):
    subject_dir = get_subject_dir(subject_id)
    shutil.rmtree(subject_dir, ignore_errors=True)

    return {
        "subject_id": subject_id,
        "deleted": True,
    }

