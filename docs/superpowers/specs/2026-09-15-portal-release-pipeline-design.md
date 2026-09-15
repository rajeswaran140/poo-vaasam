# Portal release pipeline — design

**Date:** 2026-09-15
**Status:** approved in chat, ready for an implementation plan

## Why

A Tamilagaval song release is currently a manual job on `crowvault-ide-server`:
render an MP4 with ffmpeg by hand, assemble a description in a text editor,
upload with a bespoke shell script, set the thumbnail, add playlists, then
verify everything by curling the Data API. The portal already masters the
audio; everything after that leaves it.

That gap has cost real work. On 2026-09-15 a release took four renders before
one was accepted, and two YouTube videos (`Pif11nJ3Gzg`, `m9pfr-qWcgQ`) had to
be uploaded and deleted because a video's file cannot be replaced in place.

This brings render, metadata, preflight and upload into `/admin` so a release
is finished in the browser — up to the two steps YouTube's API cannot perform.

## The pipeline, as the operator states it

Four steps, replacing Premiere Pro end to end. Two already work; the spec covers
the other two.

| Step | State today | This spec |
|---|---|---|
| **1. Master the WAV from Suno** | **Built and live.** WAV in -> worker two-pass `loudnorm` -> -14 LUFS / -1 dBTP -> saved master. WAV only: mastering an MP3 re-levels a file that has already lost detail. | unchanged |
| **2. Render the video** | **Built, broken.** Square-box crop at 46% of frame; button vanishes after one render; no quality target. | fixed (component 1, 7) |
| **3. Encode the audio** | **Built.** Happens inside the render: mastered WAV -> AAC 384k / 48 kHz, ONE encode, no intermediate. | unchanged; quality target added to the picture only |
| **4. Upload to YouTube** | **Does not exist.** Manual shell script on the host. | built (components 3-7) |

Cover-image upload already exists too — `src/app/api/admin/mastering/upload/route.ts`
takes `kind: 'cover'` (JPEG/PNG/WebP, separate allow-list and size cap).

### Why step 3 is the whole point

The operator moved off Premiere Pro because *"the sound quality was
unsatisfactory"*. Premiere's encoder was never the fault. Essential Sound's
"Auto-Match to -14" and export gain **re-process audio that is already
mastered** — the master is undone, then re-encoded, and the listener hears both.

The portal path never touches the audio after mastering: the mastered WAV is fed
straight to `-c:a aac -b:a 384k -ar 48000`, a single encode, and YouTube's own
transcode is the only other generation. Verified 2026-09-15 on the real release —
the finished MP4 measured **-14.0 LUFS / LRA 3.5**, identical to its master.

This is why `planRender` refuses to render from the 192k web MP3 and why the
audio bitrate is not a tunable: both would quietly reintroduce the generation
loss the whole pipeline exists to remove.

## What this is NOT

**The YouTube Data API cannot create a Premiere, and cannot pin a comment.**
No design changes that. Those two steps stay in YouTube Studio, permanently.
The portal's job is to remove every manual step that *can* be automated and to
state plainly which ones cannot — never to imply a release is finished when it
is not.

Out of scope: posting the pinned comment (the API can post but not pin, and
the existing systemd timers already cover it); scheduling; Shorts.

## What already exists

Most of the render path is built and must be reused, not replaced.

| Piece | Where | Note |
|---|---|---|
| Render route | `src/app/api/admin/music-lab/master/[jobId]/render/route.ts` | Event-invokes the worker, returns 202 |
| Worker | `worker/master-worker.ts` | 900 s, 3008 MB, ffmpeg layer; `renderVideo()` branch |
| Render recipe | `src/lib/master-video.ts` | Pure; bundled into the worker by esbuild — ONE source of truth |
| Job state | `MasterJobRepository`, `src/types/masterJob.ts` | `MASTERJOB#` items, `videoKey` written on render |
| Release checks | `src/lib/release-checklist.ts` | Pure + tested |
| SSM-at-runtime | `src/lib/twitch/tokens.ts` | The pattern for reading a secret inside a running function |

## Measured constraints

Taken on the real 5:30 master (`~/albums/new-song/`), 2026-09-15, not estimated:

| | compose | encode | artifact | video bitrate |
|---|---|---|---|---|
| Production args today | 0.514 s | 2 m 59.9 s | 20.9 MB | **116 kbps** |
| **Proposed** (fill-frame, lanczos, unsharp, CRF 16, `-g 100`) | 0.693 s | **3 m 54 s** | 57.8 MB | **1.01 Mbps** |
| Manual recipe (rejected for Lambda) | — | 18 m 16 s | 294 MB | 7.09 Mbps |

The proposal costs **+52 s of encode (+29%)** and 2.6x the file size, and buys an
order of magnitude of video bitrate. Today's args specify no `-crf` at all, so
they run libx264's default 23 — that is the softness the operator rejected by
eye on 2026-09-15, and under this design it would ship to YouTube unseen.

Three things follow:

1. **The manual recipe cannot be used.** 18 minutes against a 900 s ceiling.
   It put the filter graph inside the encode, which `master-video.ts` already
   warns against — the compose/encode split is what makes the render fit.
2. **Quality changes belong in the compose step.** `lanczos` + `unsharp` cost
   **0.18 s** because they run once on one frame. Free.
3. **Upload fits the render's invocation.** ~58 MB is seconds of egress against
   a 900 s budget. No second Lambda.

**Margin, stated honestly.** At the proposed settings a 5:30 master takes ~3 m 54 s.
`MUSIC_LAB_AUDIO_FUNCTIONS` records ~6 min for a 7:52 joined master at TODAY's
settings; +29% puts that near **7 m 45 s**, leaving roughly 2 minutes of the 900 s
ceiling once upload is added. That is enough, but it is not generous, and it is
the number to re-measure if album-length renders are ever added. If it ever
proves tight the answer is a second Event-invoke for the upload reading
`videoKey` from S3 — which also buys retry-without-re-encode. The state machine
below is designed so that split can be made later without redesigning anything.

## Architecture

```
Browser (MasteringStudio)
  │  POST /api/admin/music-lab/master/[jobId]/render     (exists, fixed)
  │  POST /api/admin/music-lab/master/[jobId]/publish    (new)
  ▼
Next.js route on Amplify  ── validates, writes state, Event-invokes, returns 202
  │                          NEVER does the work: ~30 s cap, after() is dropped
  ▼
tamilagaval-master-worker (900 s)
  ├─ renderVideo()   ffprobe cover → compose frame → encode → S3 videoKey
  └─ publishVideo()  read force-ssl token from SSM → resumable videos.insert
                     → thumbnails.set → playlistItems.insert → read back
```

### Why the upload runs in the worker, not the web app

The deployed SSR app currently holds only read scopes
(`YOUTUBE_ANALYTICS_REFRESH_TOKEN`, readonly). Uploading needs the `force-ssl`
token, which can also **delete videos and post comments** on the channel.

Putting that token in the web app would mean a compromise of the public site is
a compromise of the channel. The worker is a private function with no public
invoke path, already reads secrets from SSM, and already has the MP4 on local
disk — so it uploads without the file crossing a network twice.

## Components

### 1. `src/lib/master-video.ts` — render recipe (modified)

`buildVideoFilter(height, coverAspect)` gains the cover's aspect ratio.

- **16:9 within tolerance** → fill the frame: `scale=…:force_original_aspect_ratio=increase:flags=lanczos…,crop=…,unsharp=…`. No backdrop.
- **Square or portrait** → today's blurred backdrop, which is correct for that shape and is why the code was written this way.

The aspect is **probed**, never assumed: the worker runs `ffprobe` on the cover
and passes real width/height in. Today's `art = height * 0.82` square box is the
bug — a 16:9 cover renders at 46% of frame.

`buildVideoArgs` gains an explicit quality target: **CRF 16 with `-g 100`**
(a keyframe every 10 s at 10 fps). It has none today, so it runs libx264's
default CRF 23 at `veryfast`. **It keeps 10 fps, keeps `-preset
veryfast`, and must still contain no `-filter_complex`** — that absence is what
keeps the render inside the timeout, and a test pins it.

### 2. `src/lib/youtube-description.ts` — description builder (extended)

One function assembles every description from parts: the operator's own Tamil
lyric/imagery text, plus credit block, site link, composition link, subscribe,
the three playlists, hashtags.

This is the permanent fix for the description-template leak recorded in
`project_description_template_leak` — new uploads keep reintroducing a retired
name because descriptions are hand-assembled. After this there is exactly one
place that text lives, and `CREDIT_BLOCK`'s existing drift guard already pins it.

### 3. `src/lib/youtube-upload.ts` — upload planner (new, pure)

Decides whether a publish is legal and what it would send; runs no I/O, so it is
testable without credentials. Mirrors `planRender`.

Refusals: no `videoKey`, no title, no description, `youtubeVideoId` already set,
job not saved.

### 4. `worker/master-worker.ts` — `publishVideo()` (new branch)

Branches on a `publish` event shape before the mastering guards, exactly as
`render` does, so a publish can never re-master.

1. Read `YOUTUBE_OAUTH_CLIENT_SECRET` + `YOUTUBE_DATA_REFRESH_TOKEN` from SSM
   (`/amplify/d3rkmepk4popv0/master/`), exchange for an access token.
2. **Guard:** if the job already has `youtubeVideoId`, stop. Never insert twice.
3. Resumable `videos.insert`, private. If `uploadSessionUri` exists on the job,
   **resume that session** rather than opening a new one.
4. Write `youtubeVideoId` to the job the moment the insert returns — before
   thumbnail or playlists, so a later failure cannot orphan the ID.
5. `thumbnails.set` from the cover; `playlistItems.insert` per selected playlist.
6. Read the video back via `videos.list` and store what YouTube actually holds.

### 5. Job state (extended `MasterJob`)

```
uploadStatus      : 'idle' | 'queued' | 'uploading' | 'uploaded' | 'failed'
uploadSessionUri  : string   // resumable session, for retry-without-duplicate
youtubeVideoId    : string   // set once, never overwritten
uploadError       : string
```

`uploadStatus` exists so a retry is safe. Without it, an upload that succeeds
while its status write fails would be re-inserted on retry — producing exactly
the duplicate public videos that had to be deleted by hand on 2026-09-15.

### 6. Preflight (fixed, then surfaced)

Three defects must be fixed or the "warn, don't block" panel launders them:

1. **`premiere-window` and `release-density` never run in the portal.** They
   need `uploadedAt`, `scheduledStartTime` and `siblingReleases`; the route at
   `src/app/api/admin/youtube/release-check/route.ts` supplies none of them, so
   both silently skip. `scripts/tamilagaval-release-preflight.ts` supplies all
   three and is the reference implementation.
2. **`release-density` compares two different clocks.** Siblings come from the
   uploads playlist via `videoPublishedAt` — *upload* time — and are compared
   against the new video's *air* time. Two premieres airing 24 h apart but
   uploaded a week apart do not register. It must compare air time to air time:
   `scheduledStartTime` for unaired, actual start for aired.
3. **A check with missing inputs must render as "not checked", never as a
   pass.** A green tick on a check that did not run is worse than no panel.

### 7. `MasteringStudio.tsx` — publish panel (new UI)

Four steps on one screen: cover + render (with the composed frame shown as a
still, so a bad picture is caught before upload); metadata; preflight; upload.

After upload it displays what was **read back from the API**, not the upload
response. It then states what it cannot do — set the Premiere, pin the comment —
with a direct Studio link.

The existing **Render video** button is gated `!m.videoKey`, so it disappears
once a video exists and a bad render can never be redone. It becomes
**Re-render**, overwriting the same key.

## Error handling

| Failure | Behaviour |
|---|---|
| Quota exhausted (`videos.insert` = 1600 units of 10 000/day, shared with analytics) | Its own message — "daily upload quota exhausted", never a generic 502, so a retry does not burn the remainder |
| Upload fails mid-transfer | `uploadStatus: 'failed'` + `uploadSessionUri` kept; retry resumes |
| Insert succeeds, status write fails | Next attempt stops at the `youtubeVideoId` guard |
| Thumbnail or playlist fails after insert | Video stays; those steps are individually retryable — they do not fail the upload |
| Render fails | Unchanged: `videoError` on the job |

A failed upload can leave a **private** video on the channel. Accepted by the
operator 2026-09-15: "I can delete later any private video."

## Testing

- `master-video.ts`: pure. Aspect branching (16:9 fills, square keeps backdrop),
  and the standing test that `buildVideoArgs` contains no `-filter_complex`.
- `youtube-upload.ts`: pure planner, every refusal.
- `youtube-description.ts`: extends the existing `CREDIT_BLOCK` drift guard.
- `release-checklist.ts`: air-time-to-air-time density; "not checked" rendering.
- Route tests: auth (`requireAdmin` + `requireBearer`), 202 shape, the
  already-uploaded guard.
- Worker: unit-test the pure planners; the SSM + HTTP path is covered by a
  manual first upload, as with every other worker in this repo.

**jest, not vitest.** Never pipe a run to `tail` — it swallows the exit code.
Redirect to a file and echo `$?`.

## Sequencing

The render fix ships **before** the upload. Under this design the portal uploads
whatever the renderer produced, so the square-box bug would reach YouTube
automatically instead of being caught by eye.

1. Render fix (aspect probe + fill, quality target, Re-render button)
2. Description builder
3. Preflight fixes
4. Upload planner + job state
5. Worker publish branch
6. Publish route
7. Publish panel UI
