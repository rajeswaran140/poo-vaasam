# Video Text Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A separate admin page, `/admin/video-text`. Raj uploads a finished song MP4, places a title, hand-timed lyric lines and credits on a timeline, and downloads the MP4 with the text burned in. The audio is copied untouched.

**Architecture:**
- **Browser:** draws every text block with canvas, so Tamil shapes correctly. The preview and the burn-in use the same drawing function.
- **Upload:** the PNGs go to S3.
- **Coordinator:** an async job on the existing master-worker. It splits the source into keyframe-aligned segments by stream copy, then fans out one synchronous invocation per segment to a new chunk function, which overlays that segment's PNGs and re-encodes the video only. Then it joins the chunks by stream copy and muxes the original audio stream with `-c:a copy`.
- **Projects:** stored in DynamoDB.
- **Cleanup:** media under `audio/mastering/video-text/` expires after 30 days.

**Tech Stack:** Next.js App Router (TypeScript), React, Tailwind; AWS Lambda (Node 20, ffmpeg 7.0.2 layer at `/opt/bin/ffmpeg`); S3 (`tamil-web-media`, us-east-1); DynamoDB (`TamilWebContent`, ca-central-1); jest + Testing Library; Playwright.

**Spec:** `docs/superpowers/specs/2026-11-07-video-text-tool-design.md`

## Global Constraints

- **Separate page.** Never touch Visual Story Studio, `/admin/mastering`, or any existing render path or output. One nav link is the only shared UI.
- **Audio:** stream-copied, never re-encoded. The output's audio packets must hash identical to the source's.
- **Picture:** the output keeps the source's width, height and frame rate.
- **Tamil:** never shaped server-side. The server only overlays PNGs the browser drew at the video's exact pixel size.
- **Default timings:** title 0–5 s; credits in the last 10 s; lyric blocks spread evenly between them.
- **Limits:** upload 1 GB (`1024 * 1024 * 1024`), `video/mp4` and `video/quicktime` only. Keys are under `audio/mastering/video-text/<projectId>/`.
- **Retention:**
  - The project record has no expiry.
  - Source, output and intermediates expire 30 days after they're written, by an S3 lifecycle rule on `audio/mastering/video-text/`.
  - Intermediates are deleted as soon as a render ends.
  - The page shows the deletion date.
- **Lambda:** every invocation finishes well inside its timeout (master-worker 900 s; the chunk function's timeout is set in Task 7) and writes an error the page shows beside Make video.
- **Design target:** a 10-minute 1440p video.
- **Auth:** every mutating route calls `requireAdmin(request)` and `requireBearer(request)` (`src/lib/auth-helper.ts`). Every GET calls `requireAdmin`.
- **Repo:** jest, not vitest. On this box, run jest with `NODE_OPTIONS=--no-experimental-strip-types`. CI runs `npx tsc --noEmit`, `npm run lint` (whole repo; 16 existing warnings must not grow) and `npm test`. tsc skips `__tests__`. Don't run `npm run build` on this box.
- **Lines Raj must OK:** no deploys, no setup-script runs, no pushes without his yes. He merges PRs himself.
- **No text in the studio** or the mastering renders, per Raj's rule of 2026-11-06. This tool is the only place text is added.

## Review Focus

1. **Overlapping lyric blocks on one track.** Dragging or resizing a block into its neighbour should stop at the neighbour's edge (clamp), never overlap. Two lyric lines must never draw on top of each other. Tested in Task 1.
2. **A very long lyric line**, or Tamil text wider than the frame. It wraps to at most 2 lines, then the font shrinks until it fits inside the 5% safe margin. Text is never cut off silently. Tested in Task 2.
3. **A block that crosses a segment boundary.** It must appear continuous in the output, with no flash or gap at the join. Times are shifted per segment and clipped at both ends. Tested in Task 3.
4. **Double-clicking Make video, or reloading mid-render.**
   - Exactly one render runs; a second POST gets 409.
   - After a reload, the page resumes showing progress, or the result.
   - Tested in Tasks 4 and 5 (conditional start) and Task 8 (resume).
5. **A source that isn't from our pipeline**, or a re-upload with a different length.
   - No audio track: the output has no audio, and that isn't an error.
   - Variable frame rate from a phone: refused with a clear message, or normalised. Never a silent desync.
   - A shorter re-upload: blocks past the new end are clamped, and the page says how many moved.
   - Tested in Tasks 1 (clamp), 6 (probe refusal) and 8 (message).

---

### Task 1: Types, keys and timeline logic (pure)

**Files:**
- Create: `src/types/videoText.ts`
- Create: `src/lib/video-text/keys.ts`
- Create: `src/lib/video-text/timeline.ts`
- Test: `__tests__/lib/video-text/keys.test.ts`, `__tests__/lib/video-text/timeline.test.ts`

**Interfaces:**
- Produces, in `src/types/videoText.ts`:
  ```ts
  export type Track = 'title' | 'lyric' | 'credits';
  export interface TextBlock { id: string; track: Track; text: string; startSec: number; endSec: number }
  export interface TextStyle { sizeScale: number /* 0.75–1.5, default 1 */; lyricPosition: 'lower' | 'middle' }
  export interface SourceInfo { key: string; width: number; height: number; fps: number; durationSec: number; hasAudio: boolean; uploadedAt: string; expiresAt: string }
  export type RenderStatus = 'idle' | 'queued' | 'segmenting' | 'encoding' | 'joining' | 'done' | 'error';
  export interface RenderState { renderId: string | null; status: RenderStatus; progress: { done: number; total: number } | null; outputKey: string | null; outputExpiresAt: string | null; error: string | null; startedAt: string | null; updatedAt: string | null }
  export interface VideoTextProject { id: string; name: string; titleText: string; creditsText: string; lyricsText: string; blocks: TextBlock[]; style: TextStyle; source: SourceInfo | null; render: RenderState; version: number; createdAt: string; updatedAt: string }
  ```
- Produces, in `keys.ts`:
  - `VIDEO_TEXT_PREFIX = 'audio/mastering/video-text/'`
  - `MAX_VIDEO_TEXT_BYTES = 1024 * 1024 * 1024`
  - `RETENTION_DAYS = 30`
  - `sourceKey(projectId, filename, contentType, now, nonce): string`
  - `overlayKey(projectId, renderId, blockId): string` (`.png`)
  - `segmentKey(projectId, renderId, index): string`
  - `chunkOutKey(projectId, renderId, index): string`
  - `outputKey(projectId, renderId): string`
  - `renderPrefix(projectId, renderId): string`
  - `isVideoTextKeyFor(projectId, key): boolean`
  - `isValidProjectId(id): boolean`
  - `expiresAtFrom(writtenAtIso): string`
- Produces, in `timeline.ts`:
  - `TITLE_DEFAULT_SEC = 5`, `CREDITS_DEFAULT_SEC = 10`, `MIN_BLOCK_SEC = 0.5`
  - `lyricLines(lyricsText: string): string[]`: trims, drops empty lines.
  - `defaultBlocks(input: { titleText; creditsText; lyricsText; durationSec }): TextBlock[]`
  - `moveBlock(blocks, id, newStartSec, durationSec): TextBlock[]`
  - `resizeBlock(blocks, id, edge: 'start' | 'end', sec, durationSec): TextBlock[]`
  - `clampToDuration(blocks, durationSec): { blocks: TextBlock[]; moved: number }`
  - `syncTextToBlocks(blocks, { titleText, creditsText, lyricsText }, durationSec): TextBlock[]`. This keeps the existing timings of lines whose text is unchanged, matching by index within the track. New lines go into the free gap after the previous block.
  - `validateBlocks(blocks, durationSec): string | null`

- [ ] **Step 1: Write failing tests**
  - `keys.test.ts`:
    - every key starts with `audio/mastering/video-text/<projectId>/`;
    - `isVideoTextKeyFor('p1', 'audio/mastering/video-text/p2/x.mp4') === false`;
    - a key containing `..` is false;
    - `isValidProjectId('../x') === false`;
    - `expiresAtFrom('2026-11-07T00:00:00.000Z') === '2026-12-07T00:00:00.000Z'`.
  - `timeline.test.ts`:
    - `lyricLines('a\n\n  b  \n') → ['a', 'b']`;
    - `defaultBlocks({ titleText: 'T', creditsText: 'C', lyricsText: 'l1\nl2\nl3\nl4', durationSec: 344 })`: the title is `{0, 5}`, the credits are `{334, 344}`, and 4 lyric blocks evenly tile `[5, 334]` with no gaps or overlaps;
    - an empty title or credits text gives no title or credits block;
    - `moveBlock` past the next lyric block stops at its start (Review Focus 1);
    - `moveBlock` can't go below 0 or past `durationSec`;
    - `resizeBlock` can't make a block shorter than `MIN_BLOCK_SEC` or overlap a neighbour;
    - `clampToDuration` with a new duration of 300 on the default 344 layout reports `moved > 0`, and every block ends ≤ 300 (Review Focus 5);
    - `syncTextToBlocks` keeps line 2's timing when only line 3's text changed;
    - `validateBlocks` returns a message for an overlap, a negative start, or a block past the end, and null for `defaultBlocks` output.
- [ ] **Step 2: Run them and confirm they fail.** Run `NODE_OPTIONS=--no-experimental-strip-types npx jest __tests__/lib/video-text`. Expected: FAIL (modules not found).
- [ ] **Step 3: Implement the three files** to the interfaces above. All of it is pure TypeScript, safe on the client. Round times to 0.01 s.
- [ ] **Step 4: Run the tests and confirm they pass.** Same command; expected PASS.
- [ ] **Step 5: Commit** with `feat(video-text): types, keys and timeline logic`.

### Task 2: Text drawing, shared by preview and burn-in

**Files:**
- Create: `src/lib/video-text/draw.ts`
- Test: `__tests__/lib/video-text/draw.test.ts`

**Interfaces:**
- Consumes: `TextBlock`, `TextStyle` (Task 1).
- Produces:
  - `SAFE_MARGIN = 0.05`
  - `FONT_FAMILY = '"Noto Sans Tamil", "Noto Sans", sans-serif'`
  - `wrapLines(ctx: Pick<CanvasRenderingContext2D, 'measureText' | 'font'>, text, maxWidth, maxLines = 2): { lines: string[]; fits: boolean }`
  - `layoutBlock(ctx, block, frame: { width; height }, style): { fontPx: number; lines: string[]; x: number; yBaseline: number[] }`
    - Base font sizes are a fraction of frame height: title 0.075, lyric 0.05, credits 0.04, all × `style.sizeScale`.
    - It shrinks by 5% steps until `fits`, down to a floor of 40% of the base.
    - Title and credits are centred vertically. The lyric baseline sits in the lower third inside the safe margin, or in the middle when `lyricPosition === 'middle'`.
    - Credits lines come from `\n`-separated text and may use more than 2 lines (up to 8).
  - `drawBlock(ctx: CanvasRenderingContext2D, block, frame, style): void`: draws white fill with a dark stroke (`lineWidth = fontPx * 0.12`) and a soft shadow, centred horizontally.
  - `renderBlockPng(block, frame, style): Promise<Blob>`: an `OffscreenCanvas`, or a `<canvas>` as fallback, at exactly `frame.width × frame.height` with a transparent background. It awaits `document.fonts.load(\`700 32px "Noto Sans Tamil"\`)` first.
  - `ensureFonts(): Promise<void>`

- [ ] **Step 1: Write failing tests** using a fake ctx whose `measureText(s).width = s.length * 10`:
  - a 30-character text with `maxWidth` 100 wraps to ≤ 2 lines, and `fits` is false when it can't;
  - `layoutBlock` for a 400-character lyric on a 1920×1080 frame returns ≤ 2 lines, a `fontPx` below the base, and every line's measured width ≤ `1920 * (1 - 2 * SAFE_MARGIN)` (Review Focus 2);
  - a lyric's last baseline is ≤ `1080 * (1 - SAFE_MARGIN)`;
  - title lines are vertically centred within ±1 px;
  - a credits block with 6 `\n` lines lays out 6 lines;
  - `sizeScale: 1.5` gives a larger `fontPx` than 1.
- [ ] **Step 2: Run them and confirm they fail.** `NODE_OPTIONS=--no-experimental-strip-types npx jest __tests__/lib/video-text/draw.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `draw.ts`.** Wrap grapheme-safely with `Intl.Segmenter('ta', { granularity: 'word' })`, falling back to splitting on spaces, so a Tamil cluster is never split.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `feat(video-text): canvas text layout shared by preview and burn-in`.

### Task 3: Render plan and ffmpeg arguments (pure), plus a layer benchmark

**Files:**
- Create: `src/lib/video-text/render-plan.ts`
- Create: `scripts/bench-video-text.ts`
- Test: `__tests__/lib/video-text/render-plan.test.ts`

**Interfaces:**
- Consumes: `TextBlock` (Task 1).
- Produces:
  - `SEGMENT_TARGET_SEC`: the value comes from Step 6's benchmark. Start at `20`.
  - `parseSegmentList(csv: string): { file: string; startSec: number; endSec: number }[]`: reads the ffmpeg segment muxer's `-segment_list_type csv` output.
  - `buildSegmentArgs(srcPath, outPattern, listPath, targetSec): string[]`: `-map 0:v:0 -c copy -f segment -segment_time <t> -reset_timestamps 1 -segment_list <list> -segment_list_type csv`. Cuts land on keyframes.
  - `overlaysForSegment(blocks: { id; startSec; endSec }[], seg: { startSec; endSec }): { id: string; fromSec: number; toSec: number }[]`: only the blocks intersecting the segment, with times relative to the segment start, clipped to `[0, seg length]`.
  - `buildChunkArgs({ segPath, overlays: { path; fromSec; toSec }[], width, height, outPath, crf, preset }): string[]`
    - Each PNG is a `-loop 1 -i`.
    - The filter chain is `[0:v][1:v]overlay=0:0:enable='between(t,a,b)'…`.
    - Video only (`-an`), libx264, `-pix_fmt yuv420p`, the same fps as the input (`-fps_mode passthrough`), `-shortest` bound to input 0 via `overlay=…:shortest=1` on the first overlay. With no overlays it re-encodes the segment the same way.
  - `buildJoinMuxArgs({ concatListPath, srcPath, outPath, hasAudio }): string[]`: `-f concat -safe 0 -i list -i src -map 0:v:0 [-map 1:a:0] -c copy -movflags +faststart`. No `-shortest`.
  - `buildAudioHashArgs(path): string[]`: `-i path -map 0:a:0 -c copy -f streamhash -hash sha256 -`.
  - `CHUNK_CRF` and `CHUNK_PRESET`: match `VIDEO_CRF` in `src/lib/master-video.ts` unless the benchmark says otherwise.

- [ ] **Step 1: Write failing tests:**
  - `parseSegmentList('seg000.mp4,0.000000,19.960000\nseg001.mp4,19.960000,40.000000\n')` gives 2 entries with the exact times;
  - `overlaysForSegment` with a block `{ 15, 25 }` against segments `{ 0, 19.96 }` and `{ 19.96, 40 }` gives `{ 15, 19.96 }` in the first and `{ 0, 5.04 }` in the second, both rounded to 0.001 s (Review Focus 3);
  - a block outside a segment isn't listed;
  - `buildChunkArgs` with 2 overlays contains 2 `-loop 1` inputs, the `enable='between(t,15,19.96)'` text, `-an`, and no `-c:a`;
  - `buildJoinMuxArgs` with `hasAudio: true` contains `-map 1:a:0` and `-c copy` and never contains `-shortest`; with `hasAudio: false` it has no `1:a`.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement `render-plan.ts`.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Benchmark script `scripts/bench-video-text.ts`.**
  - Input: `FFMPEG_PATH` (the layer's 7.0.2 binary, fetched with `aws lambda get-layer-version-by-arn` for `tamilagaval-ffmpeg:1`; `/tmp/layer-*/bin/ffmpeg` files are 0-byte stubs) and a local MP4.
  - It runs segmentation plus one chunk with 3 overlays and the join/mux.
  - It prints seconds per second of video for 1080p and 1440p, and checks the audio hash of source against output.
- [ ] **Step 6: Run the benchmark on a real 1440p render.**
  - Set `SEGMENT_TARGET_SEC` so one chunk's encode at 1440p is ≤ 40% of the chunk function's timeout.
  - Record the measured numbers in a comment above the constant.
  - Expected: the audio hashes are equal.
- [ ] **Step 7: Commit** with `feat(video-text): render plan, ffmpeg args, layer benchmark`.

### Task 4: Project repository

**Files:**
- Create: `src/infrastructure/database/VideoTextRepository.ts`
- Test: `__tests__/infrastructure/VideoTextRepository.test.ts`

**Interfaces:**
- Consumes: the types in Task 1; `DynamoDBOperations` and `handleDynamoDBError` from `src/infrastructure/database/dynamodb-client.ts`. A `ConditionalCheckFailedException` arrives with its raw `name`; check it before calling `handleDynamoDBError`, as `MasterJobRepository.markUploadQueued` does.
- Produces `class VideoTextRepository`:
  - Items are `PK = VIDEOTEXT#<id>`, `SK = METADATA`, with sparse `GSI1PK = 'VIDEOTEXT'` and `GSI1SK = updatedAt` for listing. Mirror the GSI1 index name `MasterJobRepository` uses for saved masters.
  - `create(name: string): Promise<VideoTextProject>`
  - `get(id): Promise<VideoTextProject | null>`
  - `list(limit = 50): Promise<VideoTextProject[]>`: newest first.
  - `saveEdits(id, edits: Pick<VideoTextProject, 'name' | 'titleText' | 'creditsText' | 'lyricsText' | 'blocks' | 'style'>, expectedVersion: number): Promise<{ ok: true; version: number } | { ok: false; reason: 'conflict' | 'missing' }>`: conditional on `version = :expected`.
  - `setSource(id, source: SourceInfo, blocks: TextBlock[]): Promise<void>`: also resets `render` to idle.
  - `startRender(id, renderId, now = Date.now()): Promise<{ ok: true } | { ok: false }>`
    - Conditional: `render.status` is `idle`, `done` or `error`, OR `render.updatedAt` is older than `RENDER_STALE_MS = 20 * 60 * 1000`.
    - It sets `status: 'queued'` and clears `error`, `outputKey` and `progress`.
  - `patchRender(id, renderId, fields: Partial<RenderState>): Promise<void>`: conditional on `render.renderId = :renderId`, so a stale worker can't overwrite a newer render. A lost condition returns quietly.

- [ ] **Step 1: Write failing tests** mocking `DynamoDBOperations`, following `__tests__/infrastructure/MasterJobRepository.test.ts`:
  - `saveEdits` sends `version = :expected` and returns `conflict` on `ConditionalCheckFailedException`;
  - `startRender` sends the status/stale condition and returns `{ ok: false }` on a failed condition (Review Focus 4);
  - `patchRender` is conditional on the `renderId`;
  - `list` queries GSI1 descending.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement the repository.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `feat(video-text): project repository`.

### Task 5: API routes

**Files:**
- Create under `src/app/api/admin/video-text/`:
  - `route.ts`: `GET` list, `POST` create
  - `[id]/route.ts`: `GET` load, `PATCH` saveEdits
  - `[id]/upload/route.ts`: `POST` presigned POST for the source
  - `[id]/source/route.ts`: `POST` confirm the source; probe it
  - `[id]/overlays/route.ts`: `POST` presigned POSTs for a render's PNGs
  - `[id]/render/route.ts`: `POST` start a render
  - `[id]/download/route.ts`: `GET` presigned GET for the output
- Test: `__tests__/api/admin-video-text-routes.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 4. Use `requireAdmin`, `requireBearer` and `authErrorResponse` exactly as `src/app/api/admin/mastering/upload/route.ts` does, and copy its presigned-POST pattern (`content-length-range`, pinned `Content-Type`, 1 h expiry, server-built keys).
- Produces (request → response):
  - `POST /api/admin/video-text` `{ name }` → `201 { project }`
  - `PATCH /[id]` `{ edits, version }` → `200 { version }`, or `409 { error: 'This project was changed in another tab — reload to see the latest.' }`. It validates with `validateBlocks` (`400` with its message) and caps `lyricsText` at 20 000 chars, `blocks` at 400, and block `text` at 500 chars.
  - `POST /[id]/upload` `{ filename, contentType, size }` → `{ url, fields, key }`. It refuses a size over `MAX_VIDEO_TEXT_BYTES` (400 "Videos up to 1 GB can be used.") and other content types.
  - `POST /[id]/source` `{ key }`
    - It requires `isVideoTextKeyFor`, then invokes the master-worker synchronously with `{ videoTextProbe: { key } }`.
    - It stores the `SourceInfo` with `expiresAt = expiresAtFrom(now)`.
    - It runs `clampToDuration` on the existing blocks, or `defaultBlocks` when there are none.
    - Response: `{ source, blocks, moved }`.
  - `POST /[id]/overlays` `{ renderId, blockIds: string[] }` → `{ uploads: { blockId, url, fields, key }[] }`. Content type `image/png`, at most 5 MB each, at most 400 of them.
  - `POST /[id]/render` `{ renderId }`
    - It requires a source, and that the source hasn't expired (410 "The uploaded video was deleted after 30 days — upload it again; your timing is kept.").
    - It requires `validateBlocks` to pass, then calls `startRender`; a failure returns 409 "A render is already running."
    - It invokes the master-worker with `InvocationType: 'Event'` and `{ videoTextRender: { projectId, renderId } }`.
    - Response: `202`.
  - `GET /[id]/download` → `{ url }`. The URL lasts 15 minutes, with filename `<name>-text.mp4` sanitised as in `src/app/api/admin/mastering/download/route.ts`.

- [ ] **Step 1: Write failing tests**, mocking the repository, the S3 presigner and the Lambda client like `__tests__/api/admin-music-lab-render-route.test.ts`:
  - every mutating route returns 401/403 without admin or bearer;
  - the upload refuses 1 GB + 1 byte;
  - the source refuses a key from another project;
  - render returns 409 when `startRender` is `{ ok: false }` (Review Focus 4);
  - render returns 410 for an expired source;
  - PATCH returns 409 on a conflict and 400 on overlapping blocks;
  - render sends an `Event` invoke with the exact payload.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement the routes.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `feat(video-text): admin API routes`.

### Task 6: Worker (probe, coordinator, chunk)

**Files:**
- Modify: `worker/master-worker.ts`, the handler dispatch at about lines 2727–2800. Put the new code in a new file, `worker/video-text.ts`, imported by the master-worker so it ships in the same bundle.
- Test: `__tests__/worker/video-text-worker.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3 and 4 (the repository, or direct patches under the same conditions); the worker's `ff()` (bounded by `invocationDeadline`), `parseSourceInfo`, the S3 helpers and `s3`.
- Produces three event branches in the handler:
  - **`{ videoTextProbe: { key } }`**, synchronous, returns `{ ok: true, info: { width, height, fps, durationSec, hasAudio } }` or `{ ok: false, message }`.
    - It probes over a 5-minute presigned GET URL (`ffmpeg -i <url>`) rather than downloading the file.
    - It refuses variable frame rate: when the stream's average fps and its `tbr` differ by more than 1% (the layer may have no ffprobe, so parse `ffmpeg -i` output the way `parseSourceInfo` does), the message is "This video has a variable frame rate (typical of phone recordings). Export it at a constant frame rate and upload again." (Review Focus 5).
    - It refuses a stream that isn't h264 or hevc, or a frame larger than 3840×2160.
  - **`{ videoTextRender: { projectId, renderId } }`**, async, on the master-worker. It runs these stages in order, each patching `render.status` and `progress` through `patchRender`:
    1. **`segmenting`:** download the source, run `buildSegmentArgs`, and upload the segments to `segmentKey`.
    2. **`encoding`:** fan out `{ videoTextChunk: { projectId, renderId, index, segKey, overlays, width, height } }` to `VIDEO_TEXT_CHUNK_FUNCTION` (env default `'tamilagaval-video-text-chunk'`). Calls are synchronous (`RequestResponse`), with concurrency `VIDEO_TEXT_CONCURRENCY = 20`. `TooManyRequestsException` is waited out with jitter, bounded by the deadline, as `prepareBackground`'s caller does. Progress is `{ done, total }`.
    3. **`joining`:** download the chunk outputs, run `buildJoinMuxArgs`, verify the audio hash equals the source's (`buildAudioHashArgs`; on a mismatch: error "the audio changed during the render — nothing was saved"), and upload to `outputKey`.
    4. **`done`:** set `outputKey` and `outputExpiresAt`.
    - On any failure, write `status: 'error'` with a reason. Messages include "the render ran out of time" when the remaining time is less than a 120 s reserve before the join.
    - Always delete `renderPrefix` intermediates (segments, chunk outputs, PNGs) in `finally`, and sweep `/tmp/vt-*` at start.
  - **`{ videoTextChunk: … }`**, synchronous, on the chunk function. It downloads the segment and its PNGs, runs `buildChunkArgs`, uploads to `chunkOutKey`, and returns `{ ok: true, key }` or `{ ok: false, message }`.
    - Guard: when `AWS_LAMBDA_FUNCTION_NAME === VIDEO_TEXT_CHUNK_FUNCTION`, refuse every other event with "this function only renders video-text chunks", as `BACKGROUND_PREP_FUNCTION` does at about line 2727.

- [ ] **Step 1: Write failing tests**, mocking S3, Lambda and `spawnSync` the way `__tests__/worker/master-worker.test.ts` does:
  - the probe refuses VFR with the exact message;
  - the render runs `segmenting → encoding → joining → done` in order;
  - a chunk failure ends in `error` and still deletes the intermediates;
  - an audio-hash mismatch ends in `error` with no output key written;
  - a source with no audio produces join args without `1:a`, and the run ends `done` (Review Focus 5);
  - the chunk function refuses a non-chunk event;
  - `patchRender` is always called with the `renderId` from the event.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement `worker/video-text.ts`** and wire the three branches.
- [ ] **Step 4: Run these tests and the existing `__tests__/worker/master-worker.test.ts`, and confirm they pass.**
- [ ] **Step 5: Commit** with `feat(video-text): worker probe, coordinator and chunk renderer`.

### Task 7: Infrastructure scripts (not run; Raj's yes needed)

**Files:**
- Create: `scripts/setup-video-text.sh`, modelled on `scripts/setup-background-prep.sh`, with `--dry` support.
- Modify: `package.json` `deploy:master-worker`, so it also updates `tamilagaval-video-text-chunk` when it exists, the same way it handles background-prep.
- Modify: `scripts/apply-lambda-concurrency-limits.sh`, adding the new function's reservation.

**Interfaces:**
- **Step 1 of the script:** create `tamilagaval-video-text-chunk` from `master-worker.zip` with the same role (`tamilagaval-compose-worker-role`), the same layer, 3008 MB, a timeout of 300 s, ephemeral storage 2048 MB, and env `TAKES_BUCKET` and `TAKES_BUCKET_REGION` only.
- **Step 2:** reserve 20 concurrent executions after checking that the unreserved count is ≥ 120.
- **Step 3:** add inline policy `invoke-video-text-chunk` on the role.
- **Step 4:** add an S3 lifecycle rule `video-text-30d` on `tamil-web-media`: prefix `audio/mastering/video-text/`, expire after 30 days, and abort incomplete multipart uploads after 1 day.
  - ⚠️ **It must merge, not replace.** Read the bucket's current lifecycle configuration with `get-bucket-lifecycle-configuration` (treat `NoSuchLifecycleConfiguration` as empty), replace or append only the `video-text-30d` rule, then `put` the result.
  - Print the before and after rule IDs.

- [ ] **Step 1: Write the script**, plus `scripts/__tests__`-free verification: run `bash scripts/setup-video-text.sh --dry` locally with AWS calls stubbed by `--dry`. Expected: it prints the create, reserve, policy and lifecycle commands, and the lifecycle step shows a merge.
- [ ] **Step 2: Update `deploy:master-worker` and the concurrency-limits script.**
- [ ] **Step 3: Commit** with `chore(video-text): setup script (chunk function, concurrency, IAM, 30-day lifecycle) — not run`.

### Task 8: The page (editor, timeline, preview, autosave, render, download)

**Files:**
- Create: `src/app/(admin)/admin/video-text/page.tsx`
- Create in `src/components/admin/video-text/`:
  - `VideoTextApp.tsx`: project list, then the editor
  - `VideoTextEditor.tsx`
  - `Timeline.tsx`
  - `TextPreview.tsx`
  - `useAutosave.ts`
  - `useRenderJob.ts`
- Modify: `src/config/admin-nav.ts`. Add `{ href: '/admin/video-text', title: 'Video Text', subtitle: 'Add a title, lyrics and credits to a finished video', section: 'Sound', icon: Type, keywords: ['lyrics', 'title', 'credits', 'text', 'subtitles'] }` after the Bulk upload entry.
- Modify: `src/content/admin-docs.ts`. Add a short "Video Text" entry covering the flow, the 30-day deletion and the 1 GB limit.
- Test: `__tests__/components/admin/video-text/*.test.tsx`

**Interfaces:**
- Consumes everything above. Use `adminFetch` from `src/lib/client-auth.ts` for all calls.
- **`Timeline`** props: `{ blocks: TextBlock[]; durationSec: number; playheadSec: number; onChange(blocks: TextBlock[]): void; onSeek(sec: number): void }`.
  - Three rows labelled Title, Lyrics and Credits.
  - Blocks are pointer-draggable (body = move, 8 px edges = resize) through `moveBlock` and `resizeBlock`.
  - Keyboard: a focused block's ←/→ nudge 0.1 s, Shift = 1 s, and `[`/`]` move its start or end to the playhead.
  - Horizontal zoom is a slider. The timeline scrolls horizontally inside its own box, never the page.
- **`TextPreview`** props: `{ videoUrl: string; frame: { width; height }; blocks; style; onTime(sec): void }`.
  - A `<video controls>` with a `<canvas>` overlay at the displayed size.
  - Each frame it draws the active blocks with `drawBlock` at full frame size into an offscreen canvas, then scales it down. It's the same function as the burn-in.
- **`useAutosave(project)`**: debounces `PATCH` by 800 ms and sends `version`.
  - Shows "Saved", "Saving…" or the 409 message.
  - Never drops edits on a failure; it keeps them and retries on the next change.
- **`useRenderJob(projectId)`**:
  1. `ensureFonts()`;
  2. `renderBlockPng` for every block, 4 in parallel;
  3. `POST overlays` and upload every PNG;
  4. `POST render`;
  5. poll `GET /[id]` every 4 s while `status` is queued, segmenting, encoding or joining, skipping non-ok reads (see #422 for the pattern).
  - A double click is guarded by a ref.
  - It resumes polling on mount when a render is in flight (Review Focus 4).
- **Editor layout**, top to bottom:
  - Name;
  - Upload (a dropzone; the result reads "Video: 1440p · 5:44 · deleted on 7 Dec 2026");
  - Title (input), Credits (textarea), Lyrics (textarea; "one line per lyric line");
  - Preview, then Timeline;
  - Text size (slider 0.75–1.5) and Lyric position (Lower / Middle);
  - **Make video**, showing the stage and elapsed time, e.g. "Encoding 7/18 · 2:14";
  - Download.
  - Every error shows directly under the control that caused it.
  - After a re-upload with `moved > 0`, show "N lines were past the new end and were moved inside the video."

- [ ] **Step 1: Write failing tests:**
  - an empty project shows only Name and Upload;
  - pasting 4 lines into Lyrics gives 4 lyric blocks;
  - an ArrowRight keypress on a focused block moves it 0.1 s, and a move into a neighbour clamps;
  - autosave sends one PATCH 800 ms after the last keystroke, with `version`;
  - a 409 shows the conflict message and keeps the typed text;
  - Make video double-clicked sends one render POST;
  - mounting with `render.status: 'encoding'` resumes polling and shows "Encoding";
  - a render error appears under Make video;
  - the re-upload "moved" message renders;
  - the nav contains `/admin/video-text`.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement the page, the components, the nav entry and the docs entry.**
- [ ] **Step 4: Run the tests, plus `npx tsc --noEmit` and `npm run lint`, and confirm they pass.**
- [ ] **Step 5: Commit** with `feat(video-text): editor page with timeline, preview, autosave and render`.

### Task 9: End-to-end checks

**Files:**
- Create: `tests/e2e/video-text.spec.ts`

**Interfaces:**
- Consumes: the page from Task 8. Follow `tests/e2e/mastering-layout.spec.ts`: skip without credentials, pin `level: 1`, and arm `waitForURL` before clicks.

- [ ] **Step 1: Write the spec (read-only):**
  - load `/admin/video-text`;
  - assert the h1 "Video Text" and the project list or the "New project" button;
  - never create a project, upload or render. The dev server uses the production table.
- [ ] **Step 2: Run it.** `npx playwright test --project=setup --project=admin tests/e2e/video-text.spec.ts`, run unpiped. Expected: pass.
- [ ] **Step 3: Run the full CI set:**
  - `npx tsc --noEmit`
  - `npm run lint` (0 errors, 16 warnings)
  - `NODE_OPTIONS=--no-experimental-strip-types npm test -- --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`
  - Expected: all exit 0.
- [ ] **Step 4: Commit** with `test(video-text): read-only E2E`.
- [ ] **Step 5: Manual "done when" (after Raj approves the deploy and the setup script):**
  - Raj renders a real 5:44 1440p song with about 40 lines.
  - Confirm the Tamil, the preview match and that the audio streamhash is equal.
  - Confirm a reload mid-edit loses nothing, and that a failure shows beside Make video.
