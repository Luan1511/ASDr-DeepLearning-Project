"""Word error rate of Bin's speech recognition on known sentences.

Audio comes from VieNeu TTS (several voices), goes through the same path as a
real turn (browser: 48 kHz -> 24 kHz WAV by averaging sample pairs; server:
PyAV resample to 16 kHz) and is decoded with Gipformer under several settings.
Conditions: clean, child-like (pitch and formants +4 semitones), noisy (SNR 15 dB).
TTS speech is adult and clean, so absolute numbers are optimistic; use them to
compare settings and to tell pipeline problems from model limits.

    python asr_eval.py [audio_cache_dir]
"""
import io
import subprocess
import sys
import wave
from pathlib import Path

import av
import numpy as np
import sherpa_onnx
from huggingface_hub import hf_hub_download

SENTENCES = [
    "con thích chơi tàu hỏa lắm", "hôm nay con được đi công viên", "mẹ ơi con muốn uống sữa",
    "con vẽ một con mèo màu vàng", "bin ơi chơi trốn tìm đi", "con không muốn đi ngủ đâu",
    "con xếp được cái cầu cho xe đỏ", "con chó nhà con tên là bông", "con thích ăn kem dâu",
    "hôm qua con bị ngã đau chân", "bin có biết hát không", "con muốn nghe kể chuyện khủng long",
    "con đang chơi xếp hình", "ông nội cho con một quả bóng", "con sợ tiếng sấm lắm",
    "con buồn vì bạn không chơi với con", "đố bin con vật gì kêu meo meo", "con được cô giáo khen",
    "con muốn đi biển với bố", "cái xe này chạy nhanh quá",
    "có", "không", "màu xanh", "con mèo", "tàu hỏa",
]
VOICES = ["Quỳnh Anh", "Trúc Ly", "Ngọc Trân", "Thục Đoan", "Thái Sơn"]
MODEL = "g-group-ai-lab/gipformer1.5-68M-rnnt"
RATE = 16000


def tts_cache(cache: Path):
    """48 kHz float clips per (voice, sentence), generated once."""
    cache.mkdir(parents=True, exist_ok=True)
    missing = [(v, i) for v in VOICES for i in range(len(SENTENCES)) if not (cache / f"{VOICES.index(v)}_{i:02d}.npy").exists()]
    if missing:
        from vieneu import Vieneu
        tts = Vieneu(mode="v3turbo")
        try:
            for v, i in missing:
                wav = np.concatenate(list(tts.infer_stream(SENTENCES[i], voice=v))).astype(np.float32)
                np.save(cache / f"{VOICES.index(v)}_{i:02d}.npy", wav)
                print(f"tts {v} {i}", flush=True)
        finally:
            tts.close()
    return {(v, i): np.load(cache / f"{VOICES.index(v)}_{i:02d}.npy") for v in VOICES for i in range(len(SENTENCES))}


def ffmpeg_filter(x, rate, filt):
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "f32le", "-ar", str(rate), "-ac", "1", "-i", "pipe:0",
                          "-af", filt, "-f", "f32le", "-ar", str(rate), "-ac", "1", "pipe:1"],
                         input=x.astype(np.float32).tobytes(), capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def condition(x, name, rng):
    if name == "clean":
        return x
    if name == "child_like":
        f = 2 ** (4 / 12)
        return ffmpeg_filter(x, 48000, f"asetrate={48000 * f:.1f},aresample=48000,atempo={1 / f:.5f}")
    if name == "noisy":
        p = np.mean(x ** 2)
        return x + rng.normal(0, np.sqrt(p / 10 ** (15 / 10)), x.size).astype(np.float32)
    raise ValueError(name)


def browser_wav(x48):
    """Same as voiceWav() in frontend/src/lib/buddy/voice.ts at a 48 kHz AudioContext."""
    n = x48.size // 2
    y = np.clip((x48[:2 * n:2] + x48[1:2 * n:2]) / 2, -1, 1)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(np.round(y * 32767).astype("<i2").tobytes())
    return buf.getvalue()


def server_decode(raw):
    """Same as decode_turn() in app.py."""
    resampler = av.AudioResampler(format="flt", layout="mono", rate=RATE)
    parts = []
    with av.open(io.BytesIO(raw), mode="r") as c:
        for frame in c.decode(audio=0):
            parts += [f.to_ndarray().reshape(-1) for f in resampler.resample(frame)]
        parts += [f.to_ndarray().reshape(-1) for f in resampler.resample(None)]
    return np.concatenate(parts)


# Hotword sets: Bin's name only, or Bin + profile-like interests + short answers Bin just suggested.
HOTWORDS = {
    "bin": ["BIN"],
    "context": ["BIN", "TÀU HỎA", "KHỦNG LONG", "XẾP HÌNH", "CÓ", "KHÔNG", "MÀU XANH"],
}


def bpe_vocab(cache: Path):
    """sherpa-onnx needs the BPE pieces as text to encode hotwords."""
    import sentencepiece as spm
    path = cache / "bpe.vocab"
    if not path.exists():
        sp = spm.SentencePieceProcessor(model_file=hf_hub_download(MODEL, "bpe.model"))
        lines = [f"{sp.id_to_piece(i)}\t{sp.get_score(i)}\n" for i in range(sp.get_piece_size())]
        path.write_text("".join(lines), encoding="utf-8")
    return str(path)


def recognizer(precision, method, vocab=None, score=1.5):
    suffix = ".int8.onnx" if precision == "int8" else ".onnx"
    files = {k: hf_hub_download(MODEL, k + suffix) for k in ("encoder", "decoder", "joiner")}
    extra = dict(modeling_unit="bpe", bpe_vocab=vocab, hotwords_score=score) if vocab else {}
    return sherpa_onnx.OfflineRecognizer.from_transducer(
        **files, tokens=hf_hub_download(MODEL, "tokens.txt"), num_threads=4, sample_rate=RATE, feature_dim=80,
        decoding_method=method, max_active_paths=4, **extra)


def words(text):
    return "".join(c if c.isalnum() or c.isspace() else " " for c in text.lower()).split()


def edits(ref, hyp):
    d = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        prev, d[0] = d[0], i
        for j, h in enumerate(hyp, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (r != h))
    return d[-1]


def main():
    cache = Path(sys.argv[1] if len(sys.argv) > 1 else "asr_eval_audio")
    clips = tts_cache(cache)
    rng = np.random.default_rng(0)
    conditions = ["clean", "child_like", "noisy"]
    audio = {(c, k): server_decode(browser_wav(condition(x, c, rng))) for c in conditions for k, x in clips.items()}
    configs = [("int8", "greedy_search", None, 0), ("int8", "modified_beam_search", None, 0),
               ("fp32", "greedy_search", None, 0), ("fp32", "modified_beam_search", None, 0)]
    configs += [("int8", "modified_beam_search", hot, score) for hot in HOTWORDS for score in (1.5, 2.5)]
    vocab = bpe_vocab(cache)
    print(f"{'config':44s} " + " ".join(f"{c:>18s}" for c in conditions) + "   (WER %, câu đúng hết %)")
    hot_errors = []
    for precision, method, hot, score in configs:
        rec = recognizer(precision, method, vocab if hot else None, score)
        label = f"{precision} {method}" + (f" +hot:{hot}@{score}" if hot else "")
        cells = []
        for c in conditions:
            errors = total = exact = 0
            for (v, i), _ in clips.items():
                s = rec.create_stream("/".join(HOTWORDS[hot])) if hot else rec.create_stream()
                s.accept_waveform(RATE, audio[(c, (v, i))])
                rec.decode_stream(s)
                hyp, ref = words(s.result.text), words(SENTENCES[i])
                e = edits(ref, hyp)
                errors, total, exact = errors + e, total + len(ref), exact + (e == 0)
                if hot == "context" and score == 2.5 and c == "clean" and e:
                    hot_errors.append((v, SENTENCES[i], " ".join(hyp)))
            cells.append(f"{100 * errors / total:7.1f} / {100 * exact / len(clips):5.1f}")
        print(f"{label:44s} " + " ".join(f"{x:>18s}" for x in cells), flush=True)
    print("\nLỗi còn lại khi có hotwords ngữ cảnh @2.5 (giọng sạch):")
    for v, ref, hyp in hot_errors[:30]:
        print(f"  [{v}] '{ref}' -> '{hyp}'")


if __name__ == "__main__":
    main()
