"""
asr_words — separate a song's vocal and emit word-level recognition as JSON.

A DUMB SENSOR ON PURPOSE. It measures and prints; it makes no decisions about
cue length, matching, or what reaches a caption. All of that lives in
src/lib/local-asr-clock.ts and src/lib/caption-alignment.ts, where it can be
unit-tested without a five-minute CPU job. Nothing here is trusted as text —
the transcript is only ever used as a CLOCK.

  python3 scripts/lib/asr_words.py <audio> [--model small] [--lang ta]
                                  [--workdir DIR] [--no-separate]

stdout: {"durationSec": float, "source": str, "separated": bool, "words": [...]}
Progress goes to stderr so stdout stays parseable.

Requires: demucs, faster-whisper (pip). Both are heavy; this is why the flow is
an offline script rather than a Lambda — see scripts/align-lyrics.ts.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def duration_sec(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", path],
        capture_output=True, text=True,
    ).stdout.strip()
    try:
        return float(out)
    except ValueError:
        return 0.0


def separate_vocal(path, workdir):
    """Demucs two-stem split. Returns the vocal stem path.

    NOT an optimisation — see SEPARATE_VOCAL_FIRST in local-asr-clock.ts. On the
    full mix the recogniser repeated one line three times across 0-29s; on the
    stem it progressed cleanly. Measured 2026-08-07.
    """
    log("separating vocal (demucs)…")
    subprocess.run(
        [sys.executable, "-m", "demucs", "--two-stems=vocals", "-n", "htdemucs",
         "--out", workdir, path],
        check=True, stdout=subprocess.DEVNULL,
    )
    stem = os.path.splitext(os.path.basename(path))[0]
    vocal = os.path.join(workdir, "htdemucs", stem, "vocals.wav")
    if not os.path.exists(vocal):
        raise SystemExit(f"demucs produced no vocal stem at {vocal}")
    return vocal


def recognise(path, model_name, lang):
    """Word-level recognition.

    ⚠️ vad_filter is FALSE deliberately. With it on (the documented default for
    speech) this returned ZERO segments from a stem demonstrably full of
    singing: sustained vowels and reverb tails do not look like speech to a
    speech VAD. See VAD_MUST_BE_DISABLED in local-asr-clock.ts.
    """
    from faster_whisper import WhisperModel

    log(f"recognising with faster-whisper '{model_name}' (lang={lang})…")
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, _info = model.transcribe(
        path, language=lang, vad_filter=False, word_timestamps=True,
    )
    words = []
    for seg in segments:
        for wd in (seg.words or []):
            words.append({"start": float(wd.start), "end": float(wd.end), "word": wd.word})
        log(f"  [{seg.start:7.2f}] {seg.text.strip()[:60]}")
    return words


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--model", default="small")
    ap.add_argument("--lang", default="ta")
    ap.add_argument("--workdir", default=None)
    ap.add_argument("--no-separate", action="store_true")
    args = ap.parse_args()

    if not os.path.exists(args.audio):
        raise SystemExit(f"no such file: {args.audio}")

    workdir = args.workdir or tempfile.mkdtemp(prefix="align-")
    source = args.audio
    separated = False
    if not args.no_separate:
        source = separate_vocal(args.audio, workdir)
        separated = True

    words = recognise(source, args.model, args.lang)
    json.dump(
        {
            "durationSec": duration_sec(args.audio),
            "source": source,
            "separated": separated,
            "words": words,
        },
        sys.stdout,
        ensure_ascii=False,
    )
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
