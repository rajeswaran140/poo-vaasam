# tamilagaval-lyric-timing

The listening half of **Time lyrics automatically** in Video Text. Given a
video or audio key, it separates the vocal (demucs `htdemucs`), records when
each word is sung (faster-whisper `small`, Tamil, VAD off) and the vocal's
loudness every 0.1 s, and writes them as JSON to S3. It decides nothing about
lines or captions: `src/lib/video-text/lyric-timing.ts` does, with tests.

Design: `docs/superpowers/specs/2026-11-12-auto-lyric-timing-design.md`.

## Event

```json
{ "bucket": "tamil-web-media", "sourceKey": "audio/mastering/…", "wordsKey": "audio/mastering/lyric-timing/…words.json", "errorKey": "…error.json" }
```

On failure it writes `errorKey` so the editor stops waiting.

## AWS resources (ca-central-1, created 2026-11-12)

| Resource | Name |
|---|---|
| Lambda | `tamilagaval-lyric-timing` — image, 10,240 MB (6 vCPU), 900 s, 10 GB /tmp, async retries 0 |
| ECR | `tamilagaval-lyric-timing` (keeps the last 3 images) |
| CodeBuild | `tamilagaval-lyric-timing-build` (privileged, `BUILD_GENERAL1_MEDIUM`) |
| Build source bucket | `tamilagaval-lyric-timing-build-975050319109` (private, 30-day expiry) |
| Worker role | `tamilagaval-lyric-timing-role`: read `tamil-web-media/audio/mastering/*`, write `audio/mastering/lyric-timing/*`, logs |
| Build role | `tamilagaval-lyric-timing-build-role`: push to the ECR repo, read the source bucket, logs |
| Caller | IAM user `poo-vaasam-app-user` needs inline policy `invoke-lyric-timing` (`lambda:InvokeFunction` on the function) |

## Deploy

`bash scripts/deploy-lyric-timing.sh` (build in CodeBuild, then update the function).

## Measured (4:06 song, 2026-11-12)

About 6–6½ minutes per run (separation 2–2½ min, recognition ~4 min), 2.4 GB
peak memory, about $0.06. A 7-minute song should take about 10 minutes, inside
the 15-minute Lambda limit.

## Pins worth knowing

- `huggingface-hub==0.26.5` + `requests`: hub 1.x dropped `requests`, which faster-whisper 1.1.0 imports.
- The handler passes 16 kHz samples to faster-whisper instead of a path: its own decoder calls `av.open(metadata_errors=…)`, which PyAV 19 removed.
