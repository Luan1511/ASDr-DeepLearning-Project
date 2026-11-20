"""Render one MP3 per VieNeu-TTS v3 Turbo preset voice so the team can pick Bin's voice.

Uses the same engine and call as app.py (Vieneu(mode="v3turbo").infer_stream).
Run from this folder in an environment with requirements.txt installed:

    python generate_voice_samples.py [output_dir]

Needs ffmpeg on PATH. The chosen name goes into BUDDY_TTS_VOICE.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from vieneu import Vieneu

TEXT = (
    "Chào cậu, tớ là Bin đây! Hôm nay cậu đang chơi gì thế? "
    "Khi mẹ về, cậu rủ mẹ làm khách đầu tiên của tàu nha. Xe đỏ ngồi toa sau rồi đấy!"
)


def safe_name(name: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in name).strip("_")


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "voice_samples")
    out.mkdir(parents=True, exist_ok=True)
    tts = Vieneu(mode="v3turbo")
    voices = list(tts._preset_voices.items())
    rate = tts.sample_rate
    index = []
    try:
        for i, (name, meta) in enumerate(voices, 1):
            chunks = list(tts.infer_stream(TEXT, voice=name))
            pcm = (np.clip(np.concatenate(chunks), -1, 1) * 32767).astype("<i2").tobytes()
            file = out / f"{i:02d}_{safe_name(name)}.mp3"
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", str(rate), "-ac", "1",
                 "-i", "pipe:0", "-codec:a", "libmp3lame", "-q:a", "2", str(file)],
                input=pcm, check=True,
            )
            index.append({"file": file.name, "voice": name, "description": meta.get("description", ""),
                          "featured": meta.get("featured"), "seconds": round(len(pcm) / 2 / rate, 2)})
            print(f"[{i}/{len(voices)}] {name} -> {file.name}", flush=True)
    finally:
        tts.close()
    (out / "voices.json").write_text(json.dumps({"text": TEXT, "voices": index}, ensure_ascii=False, indent=2),
                                     encoding="utf-8")


if __name__ == "__main__":
    main()
