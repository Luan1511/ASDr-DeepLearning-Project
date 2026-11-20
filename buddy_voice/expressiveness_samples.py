"""A/B samples for a livelier Bin voice with VieNeu-TTS v3 Turbo (CPU/ONNX, as app.py).

Variants: the default style token vs the undocumented emotion_0..4 tokens
(ids 8..12), a higher sampling temperature, and a brighter post-process
(pitch up, slightly faster). Sampling is random, so two takes per variant.

    python expressiveness_samples.py [voice] [output_dir]

Needs ffmpeg on PATH.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from vieneu import Vieneu

TEXT = (
    "Ơ, cậu xếp được cầu cho xe đỏ rồi à? Giỏi quá đi! "
    "Khi mẹ về, cậu rủ mẹ làm khách đầu tiên của tàu nha. Xe đỏ ngồi toa sau rồi đấy!"
)
TAKES = 2
# Pitch +1.5 semitones, net tempo +5%.
BRIGHT = f"asetrate=48000*{2 ** (1.5 / 12):.4f},aresample=48000,atempo={1.05 / 2 ** (1.5 / 12):.4f}"


def render(tts, voice, style_id, temperature):
    tts.engine.default_style_id = style_id
    chunks = list(tts.infer_stream(TEXT, voice=voice, temperature=temperature))
    return (np.clip(np.concatenate(chunks), -1, 1) * 32767).astype("<i2").tobytes()


def to_mp3(pcm, rate, file, extra_filter=None):
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", str(rate), "-ac", "1", "-i", "pipe:0"]
    if extra_filter:
        cmd += ["-af", extra_filter]
    subprocess.run(cmd + ["-codec:a", "libmp3lame", "-q:a", "2", str(file)], input=pcm, check=True)


def main() -> None:
    voice = sys.argv[1] if len(sys.argv) > 1 else "Quỳnh Anh"
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "expressiveness_samples")
    out.mkdir(parents=True, exist_ok=True)
    tts = Vieneu(mode="v3turbo")
    default_style = tts.engine.default_style_id
    variants = [("A_mac_dinh", default_style, 0.8, None)]
    variants += [(f"B_emotion_{n}", 8 + n, 0.8, None) for n in range(5)]
    variants += [("C_temperature_1.0", default_style, 1.0, None), ("D_tuoi_hon_pitch_tempo", default_style, 0.8, BRIGHT)]
    index = []
    try:
        for name, style_id, temperature, extra in variants:
            for take in range(1, TAKES + 1):
                pcm = render(tts, voice, style_id, temperature)
                file = out / f"{name}_lan{take}.mp3"
                to_mp3(pcm, tts.sample_rate, file, extra)
                index.append({"file": file.name, "style_token_id": style_id, "temperature": temperature,
                              "post_filter": extra})
                print(f"{file.name}", flush=True)
    finally:
        tts.engine.default_style_id = default_style
        tts.close()
    (out / "variants.json").write_text(json.dumps({"voice": voice, "text": TEXT, "variants": index},
                                                  ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
