"""Compare Gipformer (current) with Whisper and PhoWhisper on the asr_eval set.

Same sentences, voices, conditions and browser/server audio path as asr_eval.py.
Prints WER, share of fully correct sentences and mean CPU time per clip.

    python asr_compare.py <audio_cache_dir> <model>=<ct2_dir_or_name> ...
    e.g. whisper-small=Systran/faster-whisper-small phowhisper-small=ct2/phowhisper-small
"""
import sys
import time
from pathlib import Path

import numpy as np

from asr_eval import RATE, SENTENCES, browser_wav, condition, edits, recognizer, server_decode, tts_cache, words

CONDITIONS = ["clean", "child_like", "noisy"]


def gipformer():
    rec = recognizer("int8", "greedy_search")

    def run(x):
        s = rec.create_stream()
        s.accept_waveform(RATE, x)
        rec.decode_stream(s)
        return s.result.text
    return run


def whisper(path):
    from faster_whisper import WhisperModel
    model = WhisperModel(path, device="cpu", compute_type="int8", cpu_threads=4)

    def run(x):
        segments, _ = model.transcribe(x, language="vi", beam_size=5, vad_filter=False,
                                       condition_on_previous_text=False, without_timestamps=True)
        return " ".join(seg.text for seg in segments)
    return run


def main():
    cache = Path(sys.argv[1])
    models = [("gipformer-int8 (hiện tại)", gipformer)]
    for arg in sys.argv[2:]:
        name, path = arg.split("=", 1)
        models.append((name, lambda p=path: whisper(p)))
    clips = tts_cache(cache)
    rng = np.random.default_rng(0)
    audio = {(c, k): server_decode(browser_wav(condition(x, c, rng))) for c in CONDITIONS for k, x in clips.items()}
    print(f"{'model':28s} " + " ".join(f"{c:>16s}" for c in CONDITIONS) + "   s/câu   (WER %, câu đúng hết %)")
    for name, make in models:
        run = make()
        cells, seconds, count, samples = [], 0.0, 0, []
        for c in CONDITIONS:
            errors = total = exact = 0
            for (v, i) in clips:
                t = time.perf_counter()
                text = run(audio[(c, (v, i))])
                seconds += time.perf_counter() - t
                count += 1
                hyp, ref = words(text), words(SENTENCES[i])
                e = edits(ref, hyp)
                errors, total, exact = errors + e, total + len(ref), exact + (e == 0)
                if c == "child_like" and e and len(samples) < 6:
                    samples.append(f"'{SENTENCES[i]}' -> '{' '.join(hyp)}'")
            cells.append(f"{100 * errors / total:6.1f} / {100 * exact / len(clips):5.1f}")
        print(f"{name:28s} " + " ".join(f"{x:>16s}" for x in cells) + f"   {seconds / count:5.2f}", flush=True)
        for line in samples:
            print(f"    {line}")


if __name__ == "__main__":
    main()
