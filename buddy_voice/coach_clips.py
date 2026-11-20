"""Voice clips for the live exercise coach, in Bin's current voice.

Same voice and brighter delivery as the buddy-voice service (Quỳnh Anh, pitch
+1.5 semitones, tempo x1.05). Output: 48 kHz mono 16-bit WAV, as expected by
frontend/src/lib/exerciseCoach/useLiveCoach.ts. Keep the texts identical to
CUE_TEXT in frontend/src/lib/exerciseCoach/rules.ts.

    python coach_clips.py <output_dir> <cue>=<text> ...
"""
import subprocess
import sys
from pathlib import Path

import numpy as np
from vieneu import Vieneu

VOICE = "Quỳnh Anh"
SEMITONES = 1.5
TEMPO = 1.05


def main():
    out = Path(sys.argv[1])
    cues = [arg.split("=", 1) for arg in sys.argv[2:]]
    factor = 2 ** (SEMITONES / 12)
    bright = f"asetrate={48000 * factor:.3f},aresample=48000,atempo={TEMPO / factor:.6f}"
    tts = Vieneu(mode="v3turbo")
    try:
        for cue, text in cues:
            wav = np.concatenate(list(tts.infer_stream(text, voice=VOICE)))
            pcm = (np.clip(wav, -1, 1) * 32767).astype("<i2").tobytes()
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", str(tts.sample_rate), "-ac", "1",
                 "-i", "pipe:0", "-af", bright, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", str(out / f"{cue}.wav")],
                input=pcm, check=True,
            )
            print(f"{cue}.wav  <- {text}", flush=True)
    finally:
        tts.close()


if __name__ == "__main__":
    main()
