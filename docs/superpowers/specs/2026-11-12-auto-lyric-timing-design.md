# Automatic lyric timing for Video Text — design

Status: proposed 2026-11-12. Raj approved "move it to AWS".

## Why

Timing lyrics in Video Text is still manual: paste the lines, then tap Space as
each one starts (Tap to time) and drag to fix. Raj finds it slow. The repo
already has an offline aligner (`scripts/align-lyrics.ts` +
`scripts/lib/asr_words.py`, August 2026) that separates the vocal (demucs),
recognises it (faster-whisper) and places **Raj's own lines** on the machine's
clock. It never reached Video Text. It cannot run on the dev box (it needs about
2 GB of Python packages and models, and the shared disk has about 4 GB free).

## Goal

A **Time lyrics automatically** button in Video Text: one press times every
lyric line of the project's video; Raj checks and drags any line that is off.

## Non-goals

- No change to which words appear. Words stay exactly as Raj typed them; the
  machine supplies only times (the existing `verifyRoundTrip` contract).
- No YouTube captions. Lyric caption uploads stay off (Raj, 2026-10-15).
- No new editing UI. The result lands in the same lyric blocks Tap to time
  fills, so the timeline, dragging and Cancel work as today.

## Anti-goals

- A result that silently replaces Raj's own timing. It must be undoable in one
  press, like Tap to time's Cancel.
- Machine text in a caption, ever.
- A page that spins forever: every failure says what happened and leaves the
  lines untouched.

## How it works

1. **Button.** On a project with a video and lyrics, Raj presses
   **Time lyrics automatically**. The site route starts a job and the editor
   shows progress (about 5 minutes for a 4-minute song; estimate shown up front).
2. **Worker (new container Lambda `tamilagaval-lyric-timing`).** Downloads the
   project's source video from S3, extracts the audio (ffmpeg), separates the
   vocal (demucs htdemucs, two stems), recognises it (faster-whisper `small`,
   Tamil, word timestamps, VAD off — both settings measured in August and kept),
   and writes the **words file** (`{durationSec, separated, words[]}`) to S3
   next to the project. It decides nothing about captions: the same "dumb
   sensor" split as today.
3. **Align (site, TypeScript).** When the words file exists, the route runs the
   existing, unit-tested libraries: `wordsToCues` → `alignLyrics` with **one
   card per lyric line** (Video Text shows one line per caption) →
   `verifyRoundTrip` → `captionShapeProblem`. Any failure returns a plain
   message and no timings.
4. **Apply (editor).** The editor sets each lyric block's start and end from the
   result, keeps a snapshot for **Undo automatic timing**, and marks lines that
   were interpolated (not heard) so Raj knows which to check first.
5. **Re-time for free.** The words belong to the audio, not the lyrics. Editing
   the lines and pressing the button again re-aligns from the saved words file
   in a second, with no new worker run. A new video means a new words file.

## Infrastructure

- **Image:** `worker/lyric_timing_worker/` (Dockerfile on
  `public.ecr.aws/lambda/python:3.12`, CPU-only torch, demucs, faster-whisper,
  static ffmpeg). Models are baked into the image at build time so a run never
  downloads them. Expected size 3–4 GB (Lambda allows 10 GB).
- **Build:** AWS CodeBuild project `tamilagaval-lyric-timing-build` builds and
  pushes to ECR `tamilagaval-lyric-timing`. The dev box cannot build it (disk).
  A `scripts/deploy-lyric-timing.sh` starts the build and updates the function.
- **Lambda:** 10,240 MB (6 vCPU), 900 s timeout, 10 GB /tmp, x86_64, async
  invoke from the site. Role scoped to read the video-text source prefix and
  write the words file and job status, nothing else.
- **State:** job status on the Video Text project's own record (`queued`,
  `running`, `done`, `error` with a message), same style as its render state.
- **Region:** ca-central-1, next to the other workers.

## Cost

About $0.06 per song (10 GB × ~6 min of Lambda), $0.10 per image build, about
$0.30 a month of ECR storage. Under $1 a month at Raj's pace.

## Risks and how they are handled

- **Run time.** Measured at ~15 minutes on the 2-core dev box. Lambda's 6 vCPU
  should bring a 4-minute song to about 5–6 minutes; a 7-minute song could
  approach the 15-minute Lambda limit. Phase 1 measures this before any UI is
  built. If it is too slow, split separation and recognition into two runs.
- **Cold start.** A 3–4 GB image starts in 10–30 s. Acceptable for a job that
  takes minutes.
- **Accuracy.** Recognition of sung Tamil is rough, but only its timing is used.
  The aligner reports anchored vs interpolated lines and coverage; the editor
  shows both. Phase 1 checks it against a hand-timed song.

## Phases

1. **Spike (no UI).** Build the image with CodeBuild, create the Lambda, run it
   on பூவும் காற்றும் சேர்ந்த வாசம் (4:06). Report run time, memory, coverage and
   anchored lines, and compare against Raj's Tap-to-time result. Stop and
   report; continue only if it is fast and close enough.
2. **Button.** Route + job state + editor button, progress, Undo, interpolated
   marks; tests; site deploy plus the worker.
3. **Docs.** Admin docs section for Video Text.

## Left to the builder

Exact progress copy, polling interval, the words-file key layout, and the
CodeBuild compute size (start with `BUILD_GENERAL1_MEDIUM`, raise if the build
runs out of disk or memory).
