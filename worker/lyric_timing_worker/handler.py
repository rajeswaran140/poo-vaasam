"""
tamilagaval-lyric-timing — separate a song's vocal and record when each word is
sung, as JSON in S3.

A DUMB SENSOR ON PURPOSE, the same as scripts/lib/asr_words.py: it measures and
writes; it makes no decisions about lines, captions or matching. The site turns
the words into line timings with src/lib/local-asr-clock.ts and
src/lib/caption-alignment.ts, where the rules are unit tested. The recognised
text is never shown to anyone; it is only a clock.

Event:
  {"bucket": "tamil-web-media", "sourceKey": "<audio or video key>",
   "wordsKey": "<where to write the words JSON>"}

Writes to wordsKey:
  {"durationSec", "separated", "model", "words": [{"start","end","word"}],
   "timings": {"downloadSec","extractSec","separateSec","recogniseSec"}}
"""
import json
import os
import subprocess
import sys
import time

import boto3

# The bucket lives in us-east-1 while this function runs in ca-central-1.
s3 = boto3.client("s3", region_name=os.environ.get("BUCKET_REGION", "us-east-1"))

TMP = "/tmp/lyric-timing"


def log(msg):
    print(f"[lyric-timing] {msg}", flush=True)


def clean():
    subprocess.run(["rm", "-rf", TMP], check=False)
    os.makedirs(TMP, exist_ok=True)


def extract_audio(src, dst):
    """Any audio or video in, 44.1 kHz stereo WAV out (what demucs expects)."""
    import imageio_ffmpeg

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    res = subprocess.run(
        [ffmpeg, "-hide_banner", "-nostats", "-y", "-i", src, "-vn",
         "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", dst],
        capture_output=True, text=True,
    )
    if res.returncode != 0:
        raise RuntimeError(f"ffmpeg could not read the file: {res.stderr[-400:]}")


def separate_vocal(wav):
    """Demucs two-stem split. NOT an optimisation: on the full mix the
    recogniser repeated one line three times; on the stem it progressed
    cleanly (SEPARATE_VOCAL_FIRST in local-asr-clock.ts, measured 2026-08-07)."""
    out = os.path.join(TMP, "sep")
    res = subprocess.run(
        [sys.executable, "-m", "demucs", "--two-stems=vocals", "-n", "htdemucs", "--out", out, wav],
        capture_output=True, text=True,
    )
    vocal = os.path.join(out, "htdemucs", os.path.splitext(os.path.basename(wav))[0], "vocals.wav")
    if res.returncode != 0 or not os.path.exists(vocal):
        raise RuntimeError(f"demucs failed: {res.stderr[-600:]}")
    return vocal


def load_16k_mono(path):
    """The vocal stem as 16 kHz mono float32, what Whisper expects."""
    import soundfile
    import torch
    import torchaudio.functional as AF

    data, rate = soundfile.read(path, dtype="float32", always_2d=True)
    mono = torch.from_numpy(data.mean(axis=1))
    if rate != 16000:
        mono = AF.resample(mono, rate, 16000)
    return mono.numpy()


ACTIVITY_HOP_SEC = 0.1


def vocal_activity(path):
    """Loudness of the vocal stem every 0.1 s, in whole dBFS.

    The recogniser misses whole verses of singing (on a 4:06 song it heard
    nothing for 41 s while the vocal was plainly there), but the stem's loudness
    still shows WHERE the singing is. The site uses it to keep unheard lines out
    of the music breaks. Raw numbers only; the threshold is decided in
    src/lib/vocal-activity.ts, where it is tested.
    """
    import numpy as np
    import soundfile

    data, rate = soundfile.read(path, dtype="float32", always_2d=True)
    mono = data.mean(axis=1)
    hop = int(rate * ACTIVITY_HOP_SEC)
    frames = len(mono) // hop
    if frames == 0:
        return []
    rms = np.sqrt(np.mean(mono[: frames * hop].reshape(frames, hop) ** 2, axis=1))
    db = 20 * np.log10(np.maximum(rms, 1e-6))
    return [int(round(x)) for x in db]


def recognise(path):
    """Word-level recognition. vad_filter stays FALSE: with it on, a stem full
    of singing returned zero segments (VAD_MUST_BE_DISABLED)."""
    from faster_whisper import WhisperModel

    model = WhisperModel(
        os.environ.get("WHISPER_MODEL", "small"),
        device="cpu",
        compute_type="int8",
        download_root=os.environ.get("WHISPER_DIR"),
        cpu_threads=os.cpu_count() or 4,
    )
    # Hand it the samples, not the path: faster-whisper 1.1.0's own decoder
    # calls av.open(metadata_errors=...), which newer PyAV removed. Reading the
    # WAV ourselves keeps PyAV out of the run entirely.
    segments, _info = model.transcribe(load_16k_mono(path), language="ta", vad_filter=False, word_timestamps=True)
    words = []
    for seg in segments:
        for wd in seg.words or []:
            words.append({"start": float(wd.start), "end": float(wd.end), "word": wd.word})
    return words


def duration_of(wav):
    import soundfile

    info = soundfile.info(wav)
    return info.frames / float(info.samplerate)


def lambda_handler(event, _context):
    bucket = event["bucket"]
    source_key = event["sourceKey"]
    words_key = event["wordsKey"]
    clean()
    timings = {}

    t = time.time()
    src = os.path.join(TMP, "source" + os.path.splitext(source_key)[1])
    s3.download_file(bucket, source_key, src)
    timings["downloadSec"] = round(time.time() - t, 1)

    t = time.time()
    wav = os.path.join(TMP, "song.wav")
    extract_audio(src, wav)
    os.remove(src)
    duration = duration_of(wav)
    timings["extractSec"] = round(time.time() - t, 1)
    log(f"audio {duration:.1f}s ready ({timings})")

    t = time.time()
    vocal = separate_vocal(wav)
    timings["separateSec"] = round(time.time() - t, 1)
    log(f"vocal separated in {timings['separateSec']}s")
    activity = vocal_activity(vocal)

    t = time.time()
    words = recognise(vocal)
    timings["recogniseSec"] = round(time.time() - t, 1)
    log(f"{len(words)} words in {timings['recogniseSec']}s")

    body = {
        "durationSec": duration,
        "separated": True,
        "model": os.environ.get("WHISPER_MODEL", "small"),
        "words": words,
        "activity": {"hopSec": ACTIVITY_HOP_SEC, "db": activity},
        "timings": timings,
    }
    s3.put_object(
        Bucket=bucket,
        Key=words_key,
        Body=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        ContentType="application/json",
    )
    clean()
    summary = {"ok": True, "words": len(words), "durationSec": round(duration, 1), "timings": timings}
    log(json.dumps(summary))
    return summary
