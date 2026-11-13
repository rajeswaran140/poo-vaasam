# Fit to the Lyrics, Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A story's rows can be re-cut onto the sung lyric lines while keeping the clips already made. The studio times the lyrics on the story's own song, moves each cut to a line start or into the music, and trims or slightly slows each clip. It saves row lengths in tenths of a second, and the render follows them frame-exactly.

**Architecture:** There are three parts.
1. **Timing.** A pure fitter (`visual-story-lyric-fit.ts`) takes timed lines from the existing lyric-timing worker and alignment, run on the story's `audioKey` through a new story route. It solves the cuts by dynamic programming on a 0.1 s grid.
2. **Clip rule.** One shared rule (`visual-story-clip-fit.ts`) decides whether a made clip is trimmed, slowed (to 88% at most) or out of date. The panel, the fitter and the render plan all use it.
3. **Render.** The render takes frame ranges from the running total and slows clips with `setpts`.

**Tech Stack:** Next.js route handlers, zod, React (admin UI), Jest (jsdom), ffmpeg in `worker/master-worker.ts`, DynamoDB via `VisualStoryRepository`.

**Spec:** `docs/superpowers/specs/2026-11-13-fit-to-lyrics-design.md`. Phase 1 is §9 item 1, and §§4, 5.2 and 6 are the rules. Raj approved it 2026-11-13. The open questions take the spec's defaults: the slow-down floor is 88%, and rows keep their count and order.

**Branch:** `feat/visual-story-fit-to-lyrics`, cut from `docs/fit-to-lyrics-design`. That branch is master plus only the spec, this plan and the fixture, so the PR ships them together on purpose.

## Global Constraints

- `MIN_PLAYBACK_RATE = 0.88`: a clip never plays slower than 88%.
- `BREAK_GAP_SEC = 4`: a gap of ≥ 4 s between one line's end and the next line's start is a music break.
- A break starts `BREAK_LEAD_SEC = 0.3` s after the last line's end.
- Row seconds are stored in 0.1 s steps: 1–15 for stills and Grok clips, 1–60 for own clips.
- A cut inside singing lands on a line start **floored** to the tenth (at or before the first sung word).
- A grid point inside a break is clamped to ≤ the next line's floored start.
- Grok is asked for `Math.ceil(row seconds)` (still ≤ 15). Price, reservation and `GenJob.durationSec` all use that whole number.
- Render frames: shot i covers `round(start_i × 25)` to `round(end_i × 25)` frames, from the running total of row seconds.
- Totals compare in hundredths: `Math.round(a * 100) === Math.round(b * 100)`. Never compare float sums with `===`.
- The lyrics Raj pastes are sent to the align route and are not stored in phase 1.
- Words are cached at `audio/mastering/lyric-timing/vs/<vsId>/<audio base>.words.json`. The worker's role can already write `lyric-timing/*`.
- No Grok or Claude spend in phase 1. Timing is one worker run per song file.
- Errors render in the row or panel that caused them, in Raj's words. Every deploy and push needs Raj's yes, and Raj runs `~/push.sh`.

## Review Focus

1. **Lyrics typed but the song never listened to, or the timing is stale.** Align says "Press Listen to the song first", and nothing changes. *Test in Task 5.*
2. **A story whose window starts after 0:00** (`windowStartSec = 40`). Lines are shifted to window time, and lines starting before or at/after the window are dropped. *Test in Task 4.*
3. **A fit applied while a row's clip is being made, or a row deleted meanwhile.** The `lengths` op refuses the whole set when the rows on file don't match, so nothing is half-applied. *Test in Task 6.*
4. **Float drift.** 13 rows of tenths summing to 179.99999 must still tile 180, in the panel, the render plan and the worker alike. *Tests in Tasks 1 and 3.*
5. **Old clips with no stored length.** Until the backfill runs, the fitter keeps such a row at its current whole seconds (fixed bounds), and the panel never trims or slows a clip on a guessed length. *Tests in Tasks 2 and 4; backfill in Task 8, which runs before Raj fits பூவும்.*

---

### Task 1: Row seconds in tenths

**Files:**
- Modify: `src/types/visualStory.ts`: `shotInputSchema.durationSec` (line ~334), `deriveStartSecs`, `tilesWindow`; add `roundTenth`, `isTenth`, `sameSec`
- Modify: `src/lib/visual-story-route.ts:84` (`totalSec` rounded to hundredths)
- Modify: `src/services/video/check-job.ts:77`: `isInt(s.durationSec)` becomes `typeof s.durationSec === 'number' && s.durationSec > 0`
- Modify: `src/components/admin/visual-story/PicturePanel.tsx:712-717` (seconds field: `step="0.1"`, parse with `roundTenth`, compare with `sameSec`) and `:154` (`fits` uses `sameSec`)
- Modify: `src/components/admin/visual-story/Inspector.tsx` (seconds field: same as above)
- Test: `__tests__/lib/visual-story-timeline.test.ts` (new); extend `__tests__/api/admin-visual-story-edit.test.ts`

**Interfaces:**
- Produces:
  - `roundTenth(n: number): number`
  - `isTenth(n: number): boolean`, true when `Math.abs(n * 10 - Math.round(n * 10)) < 1e-6`
  - `sameSec(a: number, b: number): boolean` (hundredths)
  - `deriveStartSecs` returns starts rounded to hundredths
  - `tilesWindow` uses `sameSec`

- [ ] **Step 1: Write failing tests**
  - `tilesWindow([...Array(12)].map(() => ({durationSec: 13.9})).concat({durationSec: 13.2}), 180)` is `true`. The tenths sum to 179.99999… in floats.
  - `deriveStartSecs` of `[14.9, 15, 13.2]` is `[0, 14.9, 29.9]`.
  - `isTenth(14.9)` is true; `isTenth(14.95)` is false.
  - In the edit route test, `op:'update'` with `durationSec: 14.9` gives 200; with `14.95` gives 400; with `0.9` gives 400.
  - In the check-job test, a check result whose shots carry `durationSec: 14.9` is accepted.
- [ ] **Step 2: Run and see them fail.** Run `npx jest __tests__/lib/visual-story-timeline.test.ts __tests__/api/admin-visual-story-edit.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the helpers.** Schema: `z.number().min(MIN_SHOT_SEC).max(MAX_OWN_CLIP_SEC).refine(isTenth, 'Seconds go in tenths, like 12.4')`. Seconds fields accept tenths, and the fields that show seconds print one decimal only when it isn't `.0`.
- [ ] **Step 4: Run.** Run the same command, then `npx tsc --noEmit`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit.** Message: `feat(visual-story): row seconds in tenths`.

### Task 2: One rule for a made clip against its row

**Files:**
- Create: `src/lib/visual-story-clip-fit.ts`
- Modify: `src/components/admin/visual-story/PicturePanel.tsx:139-150` (`staleLengthOf` and `needsClip` use the rule), and the note at `:733-736`. The new copy is "Its clip is {c} s; this row needs it slower than 88 %. Make the video makes it again for {ceil(row)} s, or shorten the row to {floor(c/0.88·10)/10} s or less."
- Modify: `src/services/video/gen-job.ts:113` (Grok `durationSec: Math.ceil(shot.durationSec)`)
- Modify: `src/app/api/admin/visual-story/[vsId]/shots/[shotKey]/video/route.ts:119,140` (estimate and `job.durationSec` use `Math.ceil`)
- Modify: `PicturePanel.tsx:152,730` (price uses `Math.ceil`)
- Test: `__tests__/lib/visual-story-clip-fit.test.ts` (new); extend `__tests__/api/admin-visual-story-video.test.ts` and `__tests__/components/visual-story-picture-panel.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export const MIN_PLAYBACK_RATE = 0.88;
  export type ClipFit =
    | { kind: 'exact' }
    | { kind: 'trim'; trimSec: number }
    | { kind: 'slow'; rate: number }   // 0.88 ≤ rate < 1, 3 decimals
    | { kind: 'stale' };
  /** clipSec null = length unknown (made before 2026-11-13): 'exact' for a whole-second row, else 'stale'. Never trimmed or slowed on a guess. */
  export function clipFitFor(clipSec: number | null, rowSec: number, opts?: { continuedFrom?: boolean }): ClipFit;
  /** Longest row a clip can fill without going stale. */
  export function maxRowSecFor(clipSec: number): number; // floor(clipSec / 0.88 * 10) / 10
  ```
  - `continuedFrom` means a chained row starts from this clip's last frame.
  - In that case `trim` becomes `stale`, because trimming would make a jump at the seam.
  - Equality is to the hundredth.

- [ ] **Step 1: Write failing tests**
  - `clipFitFor(14, 13.2)` is `{kind:'trim', trimSec: 0.8}`.
  - `clipFitFor(14, 15.2)` is `{kind:'slow', rate: 0.921}`.
  - `clipFitFor(14, 16)` is `{kind:'stale'}`.
  - `clipFitFor(14, 14)` is `{kind:'exact'}`.
  - `clipFitFor(14, 13.2, {continuedFrom:true})` is `{kind:'stale'}`.
  - `clipFitFor(null, 14)` is `{kind:'exact'}`.
  - `clipFitFor(null, 14.6)` is `{kind:'stale'}`, and so is `clipFitFor(null, 13.2)`. An unknown length is never trimmed or slowed on a guess (Review Focus 5).
  - `maxRowSecFor(14)` is `15.9`.
  - Video route: a 13.2 s row reserves `estimateCostUsd('grok','HERO',14)` and writes `job.durationSec: 14`.
  - Panel: a row of 15.2 s with a 14 s clip shows "Clip made" and is not in the Make-the-video count. At 16 s it shows the out-of-date note.
- [ ] **Step 2: Run and see them fail.** Run `npx jest __tests__/lib/visual-story-clip-fit.test.ts __tests__/api/admin-visual-story-video.test.ts __tests__/components/visual-story-picture-panel`. Expected: FAIL.
- [ ] **Step 3: Implement `clipFitFor` and `maxRowSecFor`** and wire them in at the lines above.
- [ ] **Step 4: Run.** Same command. Expected: PASS. Then `npx jest __tests__/components/visual-story-picture-panel.own-clips.test.tsx`, which must still pass.
- [ ] **Step 5: Commit.** Message: `feat(visual-story): made clips trim or slow to fit their row`.

### Task 3: Render follows tenths, frame-exact, with slowed clips

**Files:**
- Modify: `src/lib/visual-story-assemble.ts`:
  - `AssemblyShot` gains `playbackRate?: number`
  - add `segmentFrames(durations: number[]): number[]`
  - `buildClipSegmentArgs` takes `frames: number` in place of `durationSec`, plus optional `playbackRate`
- Modify: `src/lib/visual-story-render.ts:50-75` (set `playbackRate` from `clipFitFor(cand.durationSec ?? null, shot.durationSec)` when the kind is `slow`; total check uses `sameSec`)
- Modify: `worker/master-worker.ts:2038-2054` (validation) and `:2178-2200` (loop)
- Test: extend `__tests__/lib/visual-story-assemble.test.ts` and `__tests__/api/admin-visual-story-render.test.ts`

**Interfaces:**
- Consumes: `clipFitFor` (Task 2), `isTenth` and `sameSec` (Task 1).
- Produces: `segmentFrames(durations)`. Frame i is `round(end_i×25) − round(start_i×25)`, the frames sum to `round(total×25)`, and every frame count is ≥ 1.

- [ ] **Step 1: Write failing tests**
  - `segmentFrames([14.9, 15, 13.2])` is `[373, 375, 330]`, and its sum is `round(43.1×25)` = 1078.
  - `segmentFrames(Array(30).fill(0.1))` sums to exactly 75 frames, even though rounding each 2.5 on its own would drift.
  - `buildClipSegmentArgs({..., frames: 380, playbackRate: 0.921})`:
    - the `-vf` string contains `setpts=PTS/0.921` before `fps=25`
    - `-frames:v` is `380`
    - `tpad` stop_duration is `15.2`
  - With no `playbackRate`, there is no `setpts` in `-vf`.
  - Render plan: a 15.2 s row whose chosen 14 s clip has `durationSec: 14` gives `playbackRate: 0.921`. A 13.2 s row gives none.
  - Render plan: tenths rows totalling 179.99999 are accepted.
- [ ] **Step 2: Run and see them fail.** Run `npx jest __tests__/lib/visual-story-assemble.test.ts __tests__/api/admin-visual-story-render.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Worker validation:
    - `isTenth(durationSec)` replaces `Number.isInteger`
    - `playbackRate`, when present, must be a finite number in `[0.88, 1)`, else "has a speed this renderer does not accept"
    - the sum check uses `sameSec`
  - Worker loop: `const frames = segmentFrames(shots.map(s => s.durationSec))` is computed after the tail is added to the last shot.
    - Clips get `frames[i]`.
    - Stills get `seconds: frames[i] / 25`.
  - `estimateAssembleSec`: add `durationSec × (1/rate − 1) × clipPerSec` for slowed clips, which re-time more frames.
- [ ] **Step 4: Run.** Same command, plus `npx tsc --noEmit` (the worker is in tsc's scope). Expected: PASS.
- [ ] **Step 5: Local render smoke.** Render a 3-shot story locally with `scripts/.tmp/folk-render.ts` style args, using rows `[14.9, 15.2, 13.2]` and a 14 s test clip at rate 0.921. Then `ffprobe -count_frames` the output. Expected: 1083 frames (43.3 s × 25) and an audio length of 43.3 s ± 0.04.
- [ ] **Step 6: Commit.** Message: `feat(visual-story): render rows in tenths frame-exact, slow clips to fit`.

### Task 4: The fitter

**Files:**
- Create: `src/lib/visual-story-lyric-fit.ts`
- Test: `__tests__/lib/visual-story-lyric-fit.test.ts` (new), using `__tests__/fixtures/poovum-lines.json`. This file is committed with this plan: 36 lines, `windowSec: 180`, `clipSecs` `[14×12, 12]`.

**Interfaces:**
- Consumes: `TimedLine` from `src/lib/video-text/lyric-timing.ts`; `clipFitFor`, `maxRowSecFor` and `MIN_PLAYBACK_RATE` (Task 2).
- Produces:
  ```ts
  export const BREAK_GAP_SEC = 4;
  export const BREAK_LEAD_SEC = 0.3;
  export interface WindowLine { text: string; startSec: number; endSec: number; heard: boolean } // window time
  export function linesInWindow(lines: TimedLine[], windowStartSec: number, windowEndSec: number): WindowLine[];
  export interface CutGrid { tenths: number[] /* allowed cut positions, integer tenths, ascending, excl. 0 and end */; breaks: Array<[number, number]> /* tenths */ }
  export function cutGrid(lines: WindowLine[], windowSec: number): CutGrid;
  export interface FitRowIn { clipSec: number | null; isClip: boolean; isOwn: boolean; continuedFrom: boolean; currentSec: number }
  export interface FitRowOut { startSec: number; endSec: number; durationSec: number; fit: ClipFit | null; lines: [number, number] | null /* 1-based, window lines */ }
  export type KeepRowsFit = { ok: true; rows: FitRowOut[]; staleCount: number } | { ok: false; error: string };
  export function fitKeepRows(rows: FitRowIn[], lines: WindowLine[], windowSec: number): KeepRowsFit;
  ```
- The algorithm, which the signature doesn't settle:
  - Work in integer tenths.
  - DP over (row k, cut position j), with each row's length bounded `[10, maxTenths(k)]`, scanning back at most 600 tenths. That is 60 s, the own-clip cap; for Grok rows it is effectively 159.
  - Cost is the squared distance from the row's target, where the target is `clipSec ?? currentSec`.
  - For Grok-clip rows (`isClip && !isOwn`), a length outside their clip's fit costs 1000 plus 0, the row's fit becomes `stale`, and its bounds widen to 1–15 s.
  - Own clips and stills never go stale. A still is 1–15 s, and an own clip is bounded by its clip fit.
  - A Grok-clip row with `clipSec: null` is pinned to `currentSec`, its length unknown.
  - Ties go to the earlier cut.
  - Return `ok:false` with "These {n} rows cannot cover {m:ss} with every cut on a line start or in the music. Add or remove a row." when no solution exists.

- [ ] **Step 1: Write failing tests**, on the fixture unless noted.
  - `cutGrid`:
    - every grid point is either a floored line start or inside a break
    - no point lies in (floor(start_k), end_k + 0.3) of any line followed within 4 s by another
    - the point after line 26's break is ≤ `floor(141.98×10)` = 1419 (Review Focus clamp)
  - `fitKeepRows` with the 13 clips (`clipSec` from fixture, `isClip:true`, `isOwn:false`, `continuedFrom:false`):
    - `ok`, 13 rows, `staleCount: 0`
    - rows tile 180
    - every row's `fit.kind` is not `stale`
    - the minimum `rate` is ≥ 0.88
    - every cut is in `cutGrid(...).tenths`
  - The same with `MIN_PLAYBACK_RATE` forced to 1 (pass a test-only option `{ minRate: 1 }`): `staleCount` ≥ 1. The design's prototype said 9; record the actual count in the test name.
  - `continuedFrom: true` on row 3: row 3 is never `trim`.
  - A row with `clipSec: null`, `isClip: true` and `currentSec: 14` comes out exactly 14 s long.
  - `linesInWindow(lines, 40, 100)`:
    - drops lines starting < 40 or ≥ 100
    - subtracts 40
    - clamps `endSec` to 60
  - Two rows over 180 s: `ok:false` with the copy above.
- [ ] **Step 2: Run and see them fail.** Run `npx jest __tests__/lib/visual-story-lyric-fit.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Same command. Expected: PASS, and the whole file runs in under 2 s.
- [ ] **Step 5: Commit.** Message: `feat(visual-story): fit rows to timed lyric lines`.

### Task 5: Timing a story's song

**Files:**
- Create: `src/lib/lyric-timing-status.ts` (server). Move `readJson`, `statusFor`, `STALE_AFTER_MS` and `invokeLyricTiming(keys, sourceKey)` here from `src/app/api/admin/video-text/[id]/lyric-timing/route.ts`, which then imports them. Its behaviour is unchanged, and its existing tests must still pass.
- Modify: `src/lib/video-text/lyric-timing.ts`: add `storyLyricTimingKeys(vsId: string, audioKey: string)`, which has the same shape as `lyricTimingKeys` with the prefix `audio/mastering/lyric-timing/vs/<vsId>/<base>`.
- Create: `src/app/api/admin/visual-story/[vsId]/lyric-timing/route.ts`:
  - `GET` returns the status
  - `POST {op:'start'}` returns 202 running, or the current status
  - `POST {op:'align', lyricsText}` returns `{ lines: WindowLine[], heard: number, total: number }`
  - Auth uses `requireAdmin` and, on POST, `requireBearer`; `isVsId`; rate limit via `limitMutation`.
- Test: `__tests__/api/admin-visual-story-lyric-timing.test.ts` (new, modelled on `admin-video-text-lyric-timing.test.ts`)

**Interfaces:**
- Consumes: `timeLyricLines` and `LyricTimingWords` (existing), `linesInWindow` (Task 4).
- Align clamps `durationSec` to `min(sensor.durationSec, story.windowEndSec + 30)`, so a window near the end of the song still times.

- [ ] **Step 1: Write failing tests**
  - `start` invokes the Lambda with `{bucket, sourceKey: story.audioKey, wordsKey: 'audio/mastering/lyric-timing/vs/<vsId>/<base>.words.json', errorKey}`.
  - A second `start` while running returns `running` and does not invoke again.
  - `align` with no words file gives 409 "Press Listen to the song first." (Review Focus 1).
  - `align` with the fixture's words gives window-time lines (mock S3 with a words JSON built from the fixture: one word per line at its start).
  - `align` when text doesn't round-trip gives 422 with `timeLyricLines`'s message.
  - An unknown vsId gives 404, and no bearer gives 401.
- [ ] **Step 2: Run and see them fail.** Run `npx jest __tests__/api/admin-visual-story-lyric-timing.test.ts __tests__/api/admin-video-text-lyric-timing.test.ts`. Expected: the new test FAILS and the old one passes.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Same command. Expected: both PASS.
- [ ] **Step 5: Commit.** Message: `feat(visual-story): time a story's lyrics on its own song`.

### Task 6: Save every row's length at once

**Files:**
- Modify: `src/app/api/admin/visual-story/[vsId]/shots/route.ts`: add `{ op: 'lengths', lengths: [{ sceneOrder, shotOrder, durationSec }] }` (1–100 items, each `durationSec` passes the Task 1 schema rule).
- Modify: `src/infrastructure/database/VisualStoryRepository.ts`: add `setShotLengths(vsId, lengths): Promise<void>`. It is one `TransactWriteItems`; each Update is conditioned on the shot existing (`attribute_exists(PK)`).
- Test: extend `__tests__/api/admin-visual-story-edit.test.ts`

**Interfaces:**
- Produces: the `lengths` op, which the panel in Task 7 calls once.
- The route refuses with 409 "The rows changed while fitting. Fit again." in two cases:
  - the set doesn't name exactly the story's current shots
  - the new lengths don't tile the window (`tilesWindow`)
- A transaction cancelled by the condition gives the same 409.

- [ ] **Step 1: Write failing tests**
  - A valid 13-row set gives 200, and the response's `tiles` is true.
  - A set missing one shot gives 409, and no shot is written (Review Focus 3).
  - A set that doesn't tile gives 409.
  - A `TransactionCanceledException` from the repository gives 409.
- [ ] **Step 2: Run and see them fail.** Run `npx jest __tests__/api/admin-visual-story-edit.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** Message: `feat(visual-story): save all row lengths in one write`.

### Task 7: The Lyrics panel

**Files:**
- Create: `src/components/admin/visual-story/LyricsFitPanel.tsx`
- Modify: `src/components/admin/visual-story/Studio.tsx:180` (render it directly above `PicturePanel` with the same `story`, `shots`, `candidates` and `onChanged` props)
- Test: `__tests__/components/visual-story-lyrics-fit-panel.test.tsx` (new)

**Interfaces:**
- Consumes: the Task 5 route; `fitKeepRows` and `cutGrid` (Task 4); `clipFitFor` (Task 2); the Task 6 `lengths` op.
- Also consumes the existing `GET /api/admin/video-text` (list) and `GET /api/admin/video-text/[id]` (`lyricsText`).
- What it shows, top to bottom (copy is fixed):
  - The heading **"Fit to the lyrics"**.
  - A lyrics textarea, with the hint "One line per lyric line, a blank line between verses, as in Video Text."
  - **"Use the lyrics from Video Text"**: a select of Video Text projects, which fills the textarea.
  - **"Listen to the song"**. While it runs, the copy is "Listening… a 4-minute song takes a few minutes." When done, "{heard} of {total} lines heard."
  - **"Fit the rows"**, which shows a table with one line per row:
    - `#`
    - `start–end` as m:ss.s
    - the length
    - the lines as `9–14` or `music`
    - what happens to its clip, as one of:
      - "as is"
      - "trim 0.8 s"
      - "plays at 92 %"
      - "needs a new clip" (in red)
  - Below the table: "Every cut lands on a line start or in the music." When `staleCount > 0`: "{n} rows need a new clip; Make the video will make them."
  - **"Use these rows"** (calls `lengths` once, then `onChanged`) and **"Cancel"**.
  - Nothing is saved before **Use these rows**. Errors show inside this panel.
- Row inputs: `clipSec` comes from the selected clip candidate's `durationSec`, or null. `isOwn` comes from `providerId === 'upload'`. `continuedFrom` is true when the next row is chained to this one (`chainFromPrevious` on the next row, same rule as `PicturePanel.chained`).

- [ ] **Step 1: Write failing tests**, with fetch mocked.
  - Paste the lyrics, press Listen, and the status flips to ready: "36 of 36 lines heard".
  - Fit the rows: 13 table rows, no "needs a new clip".
  - Use these rows: exactly one POST with `op:'lengths'` and 13 entries.
  - The align 409 shows "Press Listen to the song first." inside the panel.
  - Before Use these rows, no POST to `/shots` happens.
- [ ] **Step 2: Run and see them fail.** Run `npx jest __tests__/components/visual-story-lyrics-fit-panel.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Same command, then `npx jest __tests__/components/visual-story` and `npm run lint`. Expected: PASS and clean.
- [ ] **Step 5: Commit.** Message: `feat(visual-story): Fit to the lyrics panel`.

### Task 8: Real clip lengths, docs, release checks

**Files:**
- Create: `scripts/visual-story-clip-lengths.ts`.
  - Default is a dry run; `--write` applies.
  - It lists every story's non-STILL candidates with no `durationSec` (`.mp4`).
  - It runs `ffprobe` on a 10-minute presigned URL, and writes `durationSec` rounded to hundredths with a condition that it is still absent.
  - It prints `vsId candId old→new` and a count.
- Modify: `src/content/admin-docs.ts`, the Visual Story doc (slug `visual-story-plan-…` near line 5407): a "Fit to the lyrics" section in Raj's words, covering what each button does, the 88% rule, trims, and that Video Text still adds the words.
- Modify: `docs/VISUAL_STORY_STUDIO.md`: the tenths, `playbackRate`, the lengths op and the story lyric-timing keys.
- Test: none for the script (ops tool). The docs test `__tests__/content` must still pass.

- [ ] **Step 1: Dry run.** Run `npx tsx scripts/visual-story-clip-lengths.ts`. Expected: it lists 25 old clips, the 13 பூவும் clips among them, near 14/12 s.
- [ ] **Step 2: Ask Raj** before `--write`, since it writes live data. Then run it, and re-run the dry run. Expected: 0 left.
- [ ] **Step 3: Write the docs.** Run `npx jest __tests__/content`. Expected: PASS.
- [ ] **Step 4: Run the full gate.** Run `npx tsc --noEmit && npm run lint && npx jest`. Expected: all green.
- [ ] **Step 5: Commit, then the PR.**
  - Commit message: `docs(visual-story): Fit to the lyrics + clip length backfill`.
  - Raj pushes.
  - The PR body lists two deploys: Amplify (the site) and the master worker (render).
  - Before deploying, diff the live worker bundle against master, as `project_worker_deploy_branch_drift` warns.
- [ ] **Step 6: After deploy, Raj tests on பூவும்.** I don't press Use these rows on his story. When he renders, I check the render's cut times against the fixture (ffprobe scene cuts) and report.
