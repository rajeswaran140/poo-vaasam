# Visual Story Studio — Phase 6 (assembly) + longer windows

> Executed inline (superpowers:executing-plans), one fresh whole-branch review at the end.

**Goal:** "Render video" joins every shot's chosen picture or clip, in order, over the story's window of the song, into one MP4; and a story may cover far more than 120 s of the song.

**Spec:** `docs/superpowers/specs/2026-09-11-visual-story-studio-design.md` §7.4, §8 (render routes), §6.5 (drafts). Owner asked 2026-11-06: "build Phase 6 and raise the limit".

## Global constraints
- Frame: 16:9 → 1920×1080, 9:16 → 1080×1920, 25 fps, H.264 yuv420p, one encode recipe for every segment (concat by stream copy).
- Total video frames = `windowSec × 25` exactly; audio = the master's window, never `-shortest`.
- Fade in only when `windowStartSec > 0`; fade out only when the window ends before the song.
- Stills get a slow zoom (owner was told so); clips are trimmed or held to the shot's `durationSec`.
- The master-worker role (shared `tamilagaval-compose-worker-role`) has Get/Put/UpdateItem only: the worker NEVER queries. The route sends the whole timeline in the event; the worker only conditionally updates `RENDER#<renderId>`.
- Every key in the event is re-checked in the worker (audio `isMasterKey`; shots under `audio/mastering/visual-story/<vsId>/candidates/` with a known extension).
- Process one shot at a time; delete its source and frame before the next (a 4× motion frame is ~100 MB).
- Draft `max_tokens` ≤ 20 000 (SDK refuses non-streaming above ~21 333 without a client timeout); reserve, label and request share one function. `WORKER_DRAFT_TIMEOUT_MS` < compose-worker Lambda timeout < `DRAFT_JOB_STALE_MS`; DraftPanel poll cap grows with them.
- No song titles in the repo. Worker deploys + compose-worker timeout change only with the owner's yes, from master, after diffing live bundles.

## Review focus
1. A long all-stills window exceeding the 900 s worker — the route estimates render time from the real shot list and refuses over budget.
2. Clips with audio, 24 fps, 720p, shorter/longer than the shot — exact frame counts.
3. A render racing a story delete — conditional writes, DELETE refuses while queued/running.
4. A stale render never finished by the worker — GET fails it conditionally.
5. A whole-song window — no fade clipping the first note or the ending.

## Tasks
1. **`src/lib/visual-story-assemble.ts`** — frame size, per-shot segment args (clip: drop audio, fps 25, fill-crop, `tpad` clone + `-frames:v d×25`; still: compose + zoom via `buildMotionSegmentArgs`), concat/join args with the window and conditional fades, `isAssemblyShotKey`, `estimateAssembleSec`, `MAX_ASSEMBLE_SEC`. Tests. `scripts/verify-assemble.ts` on the layer binary measures per-shot cost and proves frame/audio exactness → sets the constants and `MAX_WINDOW_SEC`.
2. **Longer windows** — `MAX_WINDOW_SEC`; `draftMaxOutputTokens(windowSec)` used by storyboarder, `draftReserveUsd`, label; timeouts/stale/poll; WindowPicker/NewStoryForm copy; docs.
3. **Render record + routes** — `RenderJob` type, repo `createRender/listRenders/getRender/transitionRender`; `POST /[vsId]/render` (all chosen, tiles, none in flight, estimate ≤ budget, Event-invoke master-worker), `GET /[vsId]/render/[renderId]` (stale sweep); DELETE refuses during a render. Tests.
4. **Worker `assemble` action** — validate, mark running, per shot download→segment→delete, join, verify, upload `renders/<renderId>.mp4`, mark done/failed (shot-named errors). Tests.
5. **Render panel** — replaces the "not built yet" banner: readiness, Render video, progress poll, player + download, last render. Tests; docs in both copies.
