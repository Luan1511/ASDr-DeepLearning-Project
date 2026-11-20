"""Private, memory-only Vietnamese speech worker for Bạn Bin."""
import io
import os
import threading
from contextlib import asynccontextmanager

import av
import av.filter
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
VOICE = os.environ.get("BUDDY_TTS_VOICE", "Quỳnh Anh")
# Brighter delivery: raise the pitch and speed up a little (sample "D" chosen on 2026-11-20).
PITCH_SEMITONES = float(os.environ.get("BUDDY_TTS_PITCH_SEMITONES", "1.5"))
TEMPO = float(os.environ.get("BUDDY_TTS_TEMPO", "1.05"))
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
    text: str = Field(min_length=1)
    # Plain voice (no pitch/tempo change) for a child sensitive to loud sounds.
    calm: bool = False


class Brighten:
    """Streaming pitch shift + tempo change with FFmpeg filters, at the same sample rate."""

    FRAME = 960  # 20 ms at 48 kHz: small frames keep the filter's start-up delay short.

    def __init__(self, rate, semitones, tempo):
        factor = 2 ** (semitones / 12)
        graph = av.filter.Graph()
        graph.link_nodes(
            graph.add_abuffer(format="flt", sample_rate=rate, layout="mono"),
            graph.add("asetrate", f"{rate * factor:.3f}"),
            graph.add("aresample", str(rate)),
            graph.add("atempo", f"{tempo / factor:.6f}"),
            graph.add("abuffersink"),
        ).configure()
        self.graph, self.rate, self.pts = graph, rate, 0

    def _drain(self):
        out = []
        while True:
            try:
                out.append(self.graph.pull().to_ndarray().reshape(-1))
            except (BlockingIOError, EOFError, av.error.BlockingIOError, av.error.EOFError):
                break
        return np.concatenate(out) if out else np.empty(0, dtype=np.float32)

    def push(self, samples):
        samples = np.asarray(samples, dtype=np.float32).reshape(-1)
        out = []
        for start in range(0, samples.size, self.FRAME):
            part = samples[start:start + self.FRAME]
            frame = av.AudioFrame.from_ndarray(part.reshape(1, -1), format="flt", layout="mono")
            frame.sample_rate = self.rate
            frame.pts = self.pts
            self.pts += part.size
            self.graph.push(frame)
            out.append(self._drain())
        return np.concatenate(out) if out else np.empty(0, dtype=np.float32)

    def flush(self):
        self.graph.push(None)
        return self._drain()


def to_pcm16(samples):
    return (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()


def pcm_stream(tts, text, calm=False):
    # The engine is shared by one worker. Release the slot if playback is cancelled.
    try:
        plain = calm or (PITCH_SEMITONES == 0 and TEMPO == 1)
        bright = None if plain else Brighten(tts.sample_rate, PITCH_SEMITONES, TEMPO)
        for chunk in tts.infer_stream(text, voice=VOICE):
            samples = bright.push(chunk) if bright else chunk
            if len(samples):
                yield to_pcm16(samples)
        tail = bright.flush() if bright else ()
        if len(tail):
            yield to_pcm16(tail)
    finally:
        TTS_SLOT.release()


@app.post("/speak")
def speak(payload: SpeechInput, request: Request):
    if not TTS_SLOT.acquire(blocking=False):
        raise HTTPException(429, "Speech synthesis is busy")
    audio = pcm_stream(request.app.state.tts, payload.text, payload.calm)
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
