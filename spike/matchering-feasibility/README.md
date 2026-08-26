# Phase 1A Matchering Feasibility Spike

**Full findings + recommendation:** admin doc `music-lab-reference-mastering-spike-report`
(also viewable at `/admin/docs` under Music Lab once deployed).

**Reproduce the spike:** `./reproduce.sh` (~5 min end-to-end; requires
`python3-venv`, `ffmpeg`, and AWS creds with `s3:GetObject` on
`tamil-web-media/audio/mastering/*`).

## What this spike proved

1. Matchering 2.0.6 installs cleanly on Python 3.12 (upstream cert is 3.8-3.10 only).
2. It runs to completion on real TamilAgaval 24-bit / 48 kHz stereo audio, 3 for 3.
3. LUFS matching accuracy: within **0.2 LU** on all 3 tests — commercial mastering ballpark.
4. Peak memory scales with duration: **1.28 GB → 2.31 GB → 3.14 GB** for 3:22 / 6:42 / 9:36 sources.
5. Wall time is linear at **~7-8 sec / minute of audio** — comfortably under Lambda's 900s cap.

## What this spike DIDN'T do

- Container / Lambda-equivalent benchmark (Docker not installed on the box; native-Python measurements ≠ Lambda measurements exactly, but close enough for feasibility judgment).
- Blind A/B listening (subjective — needs human ears; separate step before Phase 1C flag flip).
- True-peak measurement (my ffmpeg regex missed the `True peak` label; not blocking, easy retry).

## Key adjustments to the Phase 1B plan

- **Lambda memory: 4096 MB (not 3008 MB)** — measured peak was 3.14 GB on a 9:36 track, so 3008 MB would OOM. 4096 MB gives ~30% headroom; 6144 MB is the safe cap for longer or higher-bit-depth tracks.
- **Matchering downsamples output to 44.1 kHz** even when both source and reference are 48 kHz. That's a real break vs the current TamilAgaval 48 kHz pipeline. Needs either a `matchering.Config(internal_sample_rate=48000)` override (needs testing) or a post-process resample stage.

## Recommendation

**GO → Phase 1B, with the sizing + sample-rate adjustments above.** The spike answered the two open questions positively (install works on modern Python; output is technically sound); the corrections are refinements, not blockers.
