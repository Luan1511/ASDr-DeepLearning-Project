"""Private, memory-only Vietnamese speech worker for Bạn Bin."""
import io
import os
import threading
from contextlib import asynccontextmanager

import av
import numpy as np
import sherpa_onnx
from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from starlette.concurrency import iterate_in_threadpool
from huggingface_hub import hf_hub_download
from pydantic import BaseModel, Field
from vieneu import Vieneu

MAX_BYTES = 1024 * 1024
ASR_RATE = 16000
ASR_MODEL = "g-group-ai-lab/gipformer1.5-68M-rnnt"
MAX_SECONDS = 15
VOICE = os.environ.get("BUDDY_TTS_VOICE", "Quang Sơn")
ASR_SLOT = threading.BoundedSemaphore(1)
TTS_SLOT = threading.BoundedSemaphore(1)


@asynccontextmanager
async def lifespan(app: FastAPI):
    files = {
        key: hf_hub_download(ASR_MODEL, filename)
        for key, filename in {
            "encoder": "encoder.int8.onnx",
            "decoder": "decoder.int8.onnx",
            "joiner": "joiner.int8.onnx",
            "tokens": "tokens.txt",
        }.items()
    }
    app.state.asr = sherpa_onnx.OfflineRecognizer.from_transducer(
        **files, num_threads=int(os.environ.get("BUDDY_ASR_THREADS", "2")),
        sample_rate=ASR_RATE, feature_dim=80,
    )
    app.state.tts = Vieneu(mode="v3turbo")
    # Warm up with synthetic text while the worker is still private and not ready.
    for _ in app.state.tts.infer_stream("Xin chào, Bin đây!", voice=VOICE):
        pass
    try:
        yield
    finally:
        app.state.tts.close()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health")
def health():
    return {"ok": True}


def decode_turn(raw):
    resampler = av.AudioResampler(format="flt", layout="mono", rate=ASR_RATE)
    parts = []
    samples = 0

    def collect(frames):
        nonlocal samples
        for frame in frames:
            samples += frame.samples
            if samples > ASR_RATE * MAX_SECONDS:
                raise HTTPException(413, "Audio is too long")
            parts.append(frame.to_ndarray().reshape(-1))

    with av.open(io.BytesIO(raw), mode="r") as container:
        for frame in container.decode(audio=0):
            collect(resampler.resample(frame))
        collect(resampler.resample(None))
    return np.concatenate(parts) if parts else np.empty(0, dtype=np.float32)


def recognize(asr, raw):
    if not ASR_SLOT.acquire(blocking=False):
        raise HTTPException(429, "Speech recognition is busy")
    try:
        try:
            audio = decode_turn(raw)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(422, "Unreadable audio") from None
        if audio.size < ASR_RATE // 4 or np.max(np.abs(audio)) < 0.005:
            return ""
        stream = asr.create_stream()
        stream.accept_waveform(ASR_RATE, audio)
        asr.decode_stream(stream)
        return stream.result.text.strip().lower()[:300]
    finally:
        ASR_SLOT.release()


@app.post("/transcribe")
async def transcribe(request: Request):
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > MAX_BYTES:
            raise HTTPException(413, "Audio is too large")
        raw.extend(chunk)
    if not raw:
        raise HTTPException(422, "Empty audio")
    return {"text": await run_in_threadpool(recognize, request.app.state.asr, raw)}


class SpeechInput(BaseModel):
    text: str = Field(min_length=1, max_length=160)


def pcm_stream(tts, text):
    # The engine is shared by one worker. Release the slot if playback is cancelled.
    try:
        for chunk in tts.infer_stream(text, voice=VOICE):
            yield (np.clip(chunk, -1, 1) * 32767).astype("<i2").tobytes()
    finally:
        TTS_SLOT.release()


@app.post("/speak")
def speak(payload: SpeechInput, request: Request):
    if not TTS_SLOT.acquire(blocking=False):
        raise HTTPException(429, "Speech synthesis is busy")
    audio = pcm_stream(request.app.state.tts, payload.text)
    try:
        first = next(audio)
    except Exception:
        audio.close()
        raise HTTPException(502, "Speech synthesis failed") from None

    async def response():
        try:
            yield first
            async for chunk in iterate_in_threadpool(audio):
                yield chunk
        finally:
            audio.close()

    return StreamingResponse(response(), media_type="application/octet-stream")
