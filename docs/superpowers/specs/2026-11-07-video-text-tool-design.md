# Video Text tool — design

**Date:** 2026-11-07
**Status:** approved in conversation (Raj: "looks right, go ahead"); builder check done; retention answered by Raj ("30 days is fine, go ahead")
**Scope:** a new, separate admin tool that adds a title, lyrics and credits to a finished song video.

## Purpose

Today Raj downloads the song video that `/admin/mastering` renders, opens it in Premiere Pro, and adds three kinds of text by hand:

1. **a title** at the start;
2. **lyrics** along the bottom, each line dragged on the timeline until it lines up with the singing;
3. **credits** at the end.

This tool does that job in the browser. He uploads the MP4, places the text on a timeline, presses one button, and downloads a finished MP4.

### What Raj chose

| Question | Choice |
| --- | --- |
| Where it lives | **Its own page.** Not inside Visual Story Studio and not inside the Mastering page ("do not build inside the studio"). |
| What text | Title at the start, lyrics at the bottom, credits at the end. |
| How lyrics are timed | **By hand, Premiere-style:** each line is a block he drags on a timeline. |
| Input | **Upload the downloaded MP4** from his computer. It is not picked from saved masters. |
| Output | **Download** the finished MP4. No YouTube upload from this tool. |

### Background: an earlier "no" that still holds

On 2026-11-06 Raj asked for **no** text overlays in the studio or in the mastering renders ("that would complicate things"). That decision stands. This tool is separate, so those outputs stay clean videos. Nothing in this design touches Visual Story Studio, `/admin/mastering`, the master-worker's existing render paths, or their outputs.

## Goals

- Upload an MP4 (the Mastering page's output: 1080p or 1440p 16:9, or a 1080×1920 vertical; up to about 750 MB for a 10-minute 1440p song).
- Type a title, type credits (several lines), and paste the full lyrics. Each non-empty lyric line becomes one block.
- A timeline under a video preview, with three tracks: Title, Lyrics, Credits.
  - Drag a block to move it.
  - Drag either edge to change its start or end.
  - Scrub the playhead.
  - The preview plays the uploaded video with the text drawn over it, exactly as it will be burned in.
- Starting positions, so dragging is fine-tuning:
  - the title covers 0–5 s;
  - credits cover the last 10 s;
  - lyric blocks are spread evenly between the end of the title and the start of the credits.
- Work saves as it goes, so closing the tab or reloading doesn't lose timing.
- **Make video** burns the text into the video and offers the MP4 for download.
  - Picture size and frame rate stay the same as the upload.
  - **The audio is copied untouched** (stream copy, never re-encoded). The song is the product; the mastering is done.
- Tamil text renders correctly: conjuncts, vowel signs and the like (for example க்ஷ, ஸ்ரீ, கொ).

## Non-goals

- No YouTube upload, no publishing, no link to a saved master record.
- No automatic lyric timing (no speech-to-text alignment). Raj times lines by hand.
- No transitions, effects, colour, or audio editing.
- ~~No video cutting or trimming.~~ **Changed 2026-11-08 (Raj: "video cut and start and end", "similar as premier pro"):** In and Out marks, Premiere-style. See "In and Out" below.
- No karaoke word-by-word highlighting. Whole lines only.
- No change to Visual Story Studio, the Mastering page, or any existing render.

## Anti-goals (a failure even if it works)

- **Tamil drawn wrong.** Broken conjuncts or detached vowel signs in the burned-in video. This is the most likely way to fail; see Constraints.
- **The audio changed.** Any re-encode, resample, loudness change, or shift of the audio against the picture.
- **What's burned in differs from what the preview showed.** Different position, size, line breaks or timing.
- **Losing Raj's timing work** on reload or after a failed render.
- **Adding clutter to existing pages.** One link in the admin navigation is fine.

## Constraints (facts, measured or from the repo)

1. **Encode speed rules out one long Lambda run.**
   - Burning text into real moving video means re-encoding every frame. On the deployed master-worker (ffmpeg 7.0.2 layer, 3008 MB ≈ 2 vCPU), one 15 s Grok clip took **73 s at 1440p** and **50 s at 1080p** to encode (measured 2026-11-07 for #421).
   - A 5:44 song at 1440p would therefore take about 28 minutes in one invocation, against Lambda's 900 s hard limit.
   - The render must be split. The usual pattern: cut into time chunks on keyframes, encode chunks in parallel invocations, then join by stream copy and mux the original audio. `tamilagaval-background-prep` (#421: same bundle, 10 concurrent reserved, synchronous fan-out) is a working precedent in this codebase.
2. **Tamil shaping.**
   - ffmpeg's `drawtext` does not do complex-script shaping in the layer build. libass shaping of Tamil on that layer has **never been verified**.
   - The browser shapes Tamil correctly with the site's bundled Noto Sans Tamil (`@fontsource/noto-sans-tamil`, already loaded in `src/app/layout.tsx`).
   - **Decision (my call, in conversation):** the browser draws every text block to a transparent PNG at the video's exact pixel size, and the server only overlays those images at their times (ffmpeg `overlay` with `enable='between(t,a,b)'`, or one overlay track per chunk). The server never shapes text, so preview and burn-in match by construction.
3. **Upload size.**
   - Existing workspace limits: `MAX_UPLOAD_BYTES` 500 MB (WAV) and `MAX_BACKGROUND_BYTES` 200 MB. A 10-minute 1440p render can be about 750 MB.
   - This tool needs its own limit of **1 GB**, with uploads going straight to S3 through a presigned POST, the same way the Mastering upload works.
4. **Scratch disk.** The master-worker has 4096 MB of /tmp and the prep function 2048 MB. Source plus output for one 750 MB video is about 1.5 GB, so it fits. Chunk workers only need their own chunk.
5. **Storage.**
   - Keys go under the mastering workspace, e.g. `audio/mastering/video-text/<projectId>/…` in bucket `tamil-web-media` (us-east-1), so the existing key guards and IAM apply.
   - Outputs are private and downloaded through a presigned URL (see `src/app/api/admin/mastering/download/route.ts`).
6. **Auth.** Every mutating route uses `requireAdmin` plus `requireBearer`, like every other admin route.
7. **Repo conventions:** jest (not vitest); CI runs `tsc --noEmit`, `npm run lint` (whole repo) and jest; worker deploys are manual and need Raj's yes. Raj merges PRs himself.
8. **Raj works remotely in a browser**, sometimes on a phone. Timeline editing can be desktop-first, but the page must not break at phone width.

## Decided in conversation

- A separate page: proposed route `/admin/video-text`, linked from the admin navigation.
- Flow: upload → enter title, credits and lyrics → drag on the timeline → Make video → download.
- The browser renders text; the server overlays images. The audio is stream-copied.
- Default timings: title 0–5 s, credits in the last 10 s, lyrics spread evenly between.
- Work autosaves.
- **Retention (Raj, 2026-11-07: "30 days is fine"):**
  - The project record (title, lyrics, credits, timings, style) is kept with no expiry.
  - The uploaded source, the finished output, and every intermediate file (chunks, PNGs) are **deleted 30 days after they're written**, by an S3 lifecycle rule on `audio/mastering/video-text/`. Intermediates should also be removed as soon as a render finishes.
  - A project whose source has expired asks for the MP4 again and keeps all its timing.
  - The page tells Raj the date the files will be deleted.

## Builder-check answers (my calls, not Raj's)

- **Design target: a 10-minute 1440p video must work**, not only the 5:44 test case.
  - The existing `tamilagaval-background-prep` has a 300 s timeout and shares its 10 slots with background-clip renders.
  - So prefer a **dedicated chunk function** with its own reserved concurrency, created by a setup script like `scripts/setup-background-prep.sh`. Running that script, and any lifecycle-rule change, needs Raj's yes at deploy time.
  - Size chunks so each finishes in well under the function's timeout, using the layer's measured speed.
- **Backup and replication:** don't change the bucket's backup or replication setup in this project. The 30-day expiry keeps the cost small. Whether replicas expire with the source is noted as a follow-up, not built.

## Left to the builder

- **How the render is split**: chunk length, reusing the background-prep function or adding a new one, concurrency, and progress reporting. It must finish well inside 900 s per invocation and must write an error the page shows when it fails. Run a measured benchmark on the layer's ffmpeg 7.0.2, not the dev box's 6.1.1 (they differ), before choosing.
- **Text style**: font size, weight, colour, outline or shadow, a safe area, and the position of the lyric line. Pick readable defaults: white text with a dark outline or shadow, the lyric line in the lower third inside a 5% safe margin, and the title and credits centred. Offer at most a few simple controls (size, position) if they're cheap. Long lyric lines wrap to two lines at most.
- **Where autosave lives**: a DynamoDB record in `TamilWebContent` (preferred, so work survives a device change) or localStorage. The project record holds the source key, text and timings.
- **Timeline interaction details**: snapping, zoom, keyboard nudging. Nice-to-have, not required.
- **The vertical (1080×1920) layout**: same tracks, positions scaled to the frame.

## Done when

1. Raj uploads a real 5:44, 1440p song video, adds a title, about 40 lyric lines and credits, and downloads a finished MP4. The Tamil is correct on screen, the text matches the preview, and the audio is bit-identical to the source's audio stream (verify by comparing a hash of the extracted audio stream).
2. Reloading the page mid-edit loses nothing.
3. A failed render shows its reason on the page, beside the Make video button.
4. Tests pass in CI. A read-only Playwright spec loads the page.


## In and Out (added 2026-11-08)

Raj asked for a cut so one upload can give a short part as well as the full song ("some times we have to render short duration, full song, vertical, short"), working "similar as premier pro".

- **Marks:** Mark In (key **I**) and Mark Out (key **O**) at the playhead; Shift+I / Shift+O go to them; Clear removes them. Two handles on the ruler drag them; the parts outside are shaded. In alone runs to the end, Out alone starts at 0, a mark crossing the other sends that one back to its end of the video (Premiere's rules). The part must be at least 1 s.
- **Text stays where it is**, as in Premiere: a line outside the marks is not in the video, a line crossing a mark shows for the part inside. Raj drags the title and credits into the marked part himself.
- **Picture:** marks snap to the video's frames. Only the segments inside the marks are encoded; the chunk whose segment holds a mark trims to it after the overlays (`trim` half a frame early, then `setpts=PTS-STARTPTS`), so the first frame is the frame at In. Verified on the layer's 7.0.2 at 30 and 10 fps: exact frame count, first and last frames matching the source by PSNR, a line crossing In ending on its own frame.
- **Sound is still never re-encoded.** It is cut from the extracted audio by input seeking with stream copy (`-ss In -to Out -c copy`), which starts at the packet holding In and marks the samples before it to be skipped (measured: first packet pts −192 at 48 kHz for an In 4 ms into it). The worker proves the cut is a contiguous run of the song's own packets (same size and checksum, none missing) and that the output's audio is exactly the cut's, hash and timing.
- A re-upload keeps marks that fit the new video, runs an Out past the new end to the end, and drops marks whose In is past it.
- **Not included:** turning a 16:9 video vertical. Mastering already makes the vertical and the short.

## Logo watermark (added 2026-11-09)

Raj: "implement watermark option on each video, I can upload the logo". He chose
**burned into new videos** (not YouTube's channel watermark) and **one logo, reused**.

- **One saved logo** (PNG/JPG/WebP, ≤ 5 MB): uploaded once from the Logo section,
  stored at `audio/mastering/video-text-logo/` (outside the 30-day video-text folder, so
  it is kept; private like the rest of `audio/mastering/`), its details in DynamoDB at
  `PK=VIDEOTEXTLOGO, SK=METADATA` (not a `VIDEOTEXT#` key, not on the project index).
  Replacing it changes the logo in every video made from then on.
- **Per project** (`style.logo`): show or not (default off), corner (default bottom
  right), size 1–100% of the video's height (default 10), opacity 10–100% (default 80),
  and a hand move on top of the corner (drag or arrow keys on the preview, or the
  right/down boxes; picking a corner or "Reset to corner" clears it).
- **Drawing:** like the text, the browser draws the logo into a full-frame PNG
  (`renderLogoPng`, same `drawLogo` the preview uses). It is uploaded as overlay
  `_logo`, and the worker lays it **first** (under the text) on every chunk for the
  whole segment, so it covers the whole export, or the part between In and Out.
  The worker never reads the logo file itself.
- **My calls:** a very wide logo is scaled down to fit inside the safe margin; the
  logo sits under the text where they overlap; a project with only the logo (no
  text) can still be exported.
- Mastering and Studio renders stay clean: the logo is only in Video Text exports.
