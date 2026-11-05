# Visual Story Studio — Video Clips (Phases 4–5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Make video" button on every shot that generates a Grok Imagine clip (`grok-imagine-video-1.5`) under the story's hard budget, copies the finished clip into private storage, and lets the admin review and select clips per shot — with the shot's chosen still as the opening frame and the shot's characters' reference photos for consistent faces.

**Architecture:** Async, client-driven polling (spec §7.2, D1): the generate route reserves, writes a `GENJOB#` row (sparse `GSI1PK='VSTORY_INFLIGHT'` while non-terminal), submits to Grok and returns 202; each poll request makes exactly one provider call and, on `done`, copies the clip to S3 and writes the candidate. One shared `advanceGenJob` function serves the poll route and the "Reconcile in-flight" button. Exactly one settle per reservation, guaranteed by conditional job transitions (the pattern `DRAFTJOB#` already uses).

**Tech Stack:** Next.js 15 route handlers, `fetch` for xAI, `@aws-sdk/lib-dynamodb` via `DynamoDBOperations`, `S3Operations`, jest (jsdom; `@jest-environment node` for route/service tests).

**Spec:** `docs/superpowers/specs/2026-09-11-visual-story-studio-design.md` (revised; §6, §6.2.1, §6.3, §7.2, §7.3, §11, §13). Phases 2–3 are live (#402–#405).

## Global Constraints

- **Request format is the owner's (binding, 2026-11-05):** `POST https://api.x.ai/v1/videos/generations` with headers `Content-Type: application/json` and `Authorization: Bearer <XAI_API_KEY>`, body `{ model, prompt, ... }` → `.request_id`; poll `GET https://api.x.ai/v1/videos/<request_id>` → `.status`: `"done"` → `.video.url`; `"failed"` | `"expired"` → error; anything else → still working.
- **Model is the owner's choice "best":** every clip uses `grok-imagine-video-1.5` at **$0.080/s** (rate card `grok` / `HERO`). No lite/MOTION option is offered in the UI.
- Body always carries `generate_audio: false`, `duration` (the shot's integer 1–15 s), `aspect_ratio` (the story's `9:16` | `16:9`), and `resolution`: `"720p"` when `reference_images` is present, else `"1080p"`.
- Optional body fields: `image: { url }` = the shot's pinned first-frame STILL (signed S3 URL); `reference_images: [{ url }, …]` = the shot's characters' reference photos (signed S3 URLs, max 14), prompt refers to them as `<IMAGE_0>…`.
- Signed URLs for xAI: `S3Operations.getSignedUrl(key, 3600)`. Clips stored at `audio/mastering/visual-story/<vsId>/candidates/<candId>.mp4` (private prefix; playback via `/api/admin/mastering/download?mode=play`).
- xAI key via `getXaiApiKey()` (signs with the app user — #405). A key that is empty or starts with `dummy` counts as **not configured**.
- **Money:** reserve `estimateCostUsd('grok','HERO',durationSec)` before submit; billed = `done` (incl. `respect_moderation: false`) **and** a cancelled job that Grok had accepted (it may still finish and charge); unbilled = synchronous submit failure, `failed`, `expired`. Exactly one settle per reservation; only the side whose conditional job transition succeeds settles. Paid calls never receive the client's abort signal (R10).
- Every route `requireAdmin`; every mutation `requireBearer` (literal calls — `admin-auth-coverage` test). Errors render inside the shot card. Public repo: no song titles in fixtures.
- jest: `NODE_OPTIONS=--no-experimental-strip-types npx jest <path>`; before each task's commit: the full suite (redirect to a file, read the tail), `npx tsc --noEmit`, eslint on changed files. **No test may need AWS credentials** (mock SSM/S3/DynamoDB/fetch).

## Review Focus

1. **The admin closes the tab while a clip renders** — the job keeps its reservation; reopening the story shows it "Rendering…" and resumes polling; "Reconcile in-flight" finishes it without the studio open. Test in Task 4 and Task 6.
2. **The clip finished but the copy to S3 fails or the xAI link has expired** — never silently lost or double-charged: the job stays `running` and retries on the next poll; after 10 failed copies it is marked failed **billed** with "The clip was made but couldn't be saved; it was still charged." Test in Task 4.
3. **Double click / two tabs press Make video on the same shot** — one job only (409 "A video is already rendering for this shot."), one reservation. Test in Task 3.
4. **Reorder, delete or apply a draft while a clip renders** — refused with 409 "Wait for the video to finish first." so a job never lands on a moved or missing shot. Test in Task 7.
5. **Grok refuses the prompt after rendering** (`done` + `respect_moderation:false`) — billed, the content-policy message shows in that shot's card, no candidate is written. Test in Task 2 and Task 4.

---

### Task 1: Spec amendment, job types and repository rows

**Files:** Modify `docs/superpowers/specs/2026-09-11-visual-story-studio-design.md` (§11 mode table + one paragraph: owner chose `grok-imagine-video-1.5` for every clip on 2026-11-05; MOTION/lite not offered), `src/types/visualStory.ts`, `src/infrastructure/database/VisualStoryRepository.ts`; Test `__tests__/infrastructure/visual-story-repository-genjobs.test.ts`

**Interfaces — Produces:**
- `GenJobStatus` (existing union) and `GenJob { jobId; sceneOrder; shotOrder; status: GenJobStatus; providerId; providerTaskId: string | null; reservedUsd; candId: string; attempts; copyFailures; lastPolledAt: string | null; code?: VideoErrorCode | 'billing'; error?: string; createdAt; updatedAt }`; `isGenJobId` (`gj_` prefix, Task 1 id shape); `candIdForJob(jobId) = 'cd_' + jobId.slice(3)` (deterministic so a repeated copy is idempotent).
- Repository: `genJobSk(jobId) = 'GENJOB#'+jobId`; `createGenJob(vsId, job)` (put, writes `GSI1PK='VSTORY_INFLIGHT'`, `GSI1SK='<createdAt>#<vsId>#<jobId>'`, condition `attribute_not_exists(PK)`); `getGenJob(vsId, jobId)`; `transitionGenJob(vsId, jobId, from: GenJobStatus[], to, fields?)` → updated job | null (same conditional pattern as `transitionDraftJob`; on a terminal `to` (`succeeded|failed|cancelled`) also `REMOVE GSI1PK, GSI1SK`); `touchGenJob(vsId, jobId, { copyFailed?: boolean })` (ADD attempts 1 [, copyFailures 1], SET lastPolledAt); `listInflight()` (Query GSI1 `VSTORY_INFLIGHT`, paginated) → `{ vsId, job }[]`; `loadTree` additionally returns `genJobs: GenJob[]`.

- [ ] **Step 1: Failing tests** — create writes the sparse index attrs and refuses a duplicate id; `transitionGenJob(['running'],'succeeded')` sends the `#s IN (...)` condition and REMOVEs GSI1PK/GSI1SK; a non-terminal transition does not REMOVE them; a failed condition returns null; `touchGenJob` increments attempts (and copyFailures when asked); `listInflight` follows `LastEvaluatedKey`; `loadTree` splits `GENJOB#` rows into `genJobs`; `candIdForJob('gj_1793000000000_abc123')` → `'cd_1793000000000_abc123'`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(visual-story): video job rows and spec note on the owner's model choice`

### Task 2: GrokProvider (the owner's format)

**Files:** Create `src/services/video/providers/grok.ts`; Modify `src/services/video/providers/types.ts` (failed poll state gains `billed: boolean`), `src/services/video/providers/index.ts` (`'grok'` → `new GrokProvider()`), `src/services/video/providers/fake.ts` (failed state `billed: false`); Test `__tests__/services/video/grok-provider.test.ts` (mock `global.fetch` and `getXaiApiKey`; never call xAI).

**Interfaces — Produces:** `GrokProvider implements VideoGenerationProvider` with `id = 'grok'`, `model = 'grok-imagine-video-1.5'`, `isConfigured()`, `estimateCostUsd(req) = estimateCostUsd('grok','HERO',req.durationSec)`, `submit(req)`, `poll(id)`; exported `buildGrokVideoBody(req): Record<string, unknown>`.

Mapping (spec §6.2.1 + owner's format): submit HTTP 200 with `request_id` → `{ ok:true, providerTaskId }`; a body mentioning credit/billing → `billing` (add `'billing'` to the `VideoErrorCode` union; copy "The xAI account is out of credit. Add credits in the xAI console, then try again."), checked before status mapping (as R7 does for images); HTTP 401/403 → `auth`; 429 → `rate_limit`; other → `upstream`. Poll: `status:"done"` with `respect_moderation !== false` → `succeeded` with one `video` asset (`video.url`, `video/mp4`), `actualCostUsd: null`; `done` + `respect_moderation:false` → `failed`, `content_policy`, `billed:true`; `status:"failed"` → `failed`, `billed:false`, `error.code` mapped (`invalid_argument` → `content_policy` if the message mentions moderation else `bad_response`; `permission_denied` → `auth`; others → `upstream`); `status:"expired"` → `failed`, `upstream`, `billed:false`; any other status → `running` (`pending` → `pending`). 20 s timeout per call; never the client's signal; raw upstream text logged (name + status only), never returned.

- [ ] **Step 1: Failing tests** — `buildGrokVideoBody` exactly equals `{ model:'grok-imagine-video-1.5', prompt, duration: 6, aspect_ratio:'9:16', resolution:'1080p', generate_audio:false }` with no images; adds `image:{url}` for a first frame (resolution stays 1080p); with references adds `reference_images:[{url},…]` and `resolution:'720p'`; caps references at 14; submit POSTs to `https://api.x.ai/v1/videos/generations` with both headers and returns `request_id`; poll GETs `https://api.x.ai/v1/videos/<id>`; every status mapping above (incl. `expired` and moderation-false billed); 401 → `auth` with no raw text; placeholder key `dummy-key` → `not_configured` with no fetch; registry `getVideoProvider('grok')` returns a `GrokProvider`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(visual-story): Grok Imagine video provider in the owner's request format`

### Task 3: Make-video route (reserve → job → submit)

**Files:** Create `src/app/api/admin/visual-story/[vsId]/shots/[shotKey]/video/route.ts`, `src/services/video/gen-job.ts` (shared helpers); Test `__tests__/api/admin-visual-story-video.test.ts`

**Interfaces — Produces:** `POST …/shots/[nnn-mmm]/video` → `202 { success, data: { jobId } }`; `buildVideoRequest(tree, shot): Promise<VideoGenRequest>` in `gen-job.ts` (prompt = shot prompt + each cast member's "name: description"; `firstFrameUrl` from `shot.firstFrameCandidateId` when it names a STILL candidate of this shot; `referenceImageUrls` from the cast's `refImageKeys`, signed, max 14; `mode:'HERO'`; story aspect; shot duration).

**Flow:** auth + bearer + limiter → load tree (404) → shot (404) → empty prompt 400 "Write a visual prompt first." → an existing `submitted|running` job for this shot → 409 "A video is already rendering for this shot." → provider `isConfigured` false → 503 "Grok video generation is not configured." → `est` → `reserve` false → 402 (same copy as STILL) → `createGenJob(status 'submitted', candId = candIdForJob(jobId), reservedUsd = est)` → `submit` (no client signal) → ok: `transitionGenJob(['submitted'],'running',{ providerTaskId })`, 202 → not ok: `transitionGenJob(['submitted'],'failed',{code,error})` and settle unbilled only if that won; status from code (`billing`/`not_configured` 503, `rate_limit` 429, `content_policy` 422, `auth` 502, else 502); a thrown submit → treated as unbilled `upstream` 502.

- [ ] **Step 1: Failing tests** — happy path: reserve with $0.48 for a 6 s shot, job row created, submit called **without** a signal and with the first-frame/reference URLs from signed keys, 202 with jobId; second press while running → 409 and no reserve; reserve false → 402, no submit; submit `rate_limit` → 429, job failed, settle `{reservedUsd:0.48, billedUsd:0}` once; thrown submit → 502 unbilled; empty prompt → 400; no bearer → 401.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(visual-story): make-video route under the hard budget cap`

### Task 4: Advance a job (poll, copy, settle) and the job route

**Files:** Modify `src/services/video/gen-job.ts`; Create `src/app/api/admin/visual-story/[vsId]/video-jobs/[jobId]/route.ts` (GET = advance once; POST `{op:'cancel'}`); Test `__tests__/services/video/gen-job.test.ts`, `__tests__/api/admin-visual-story-video-jobs.test.ts`

**Interfaces — Produces:** `advanceGenJob(repo, provider, vsId, job, deps?: { fetchImpl?, now? }): Promise<GenJob>` (returns the job after this step) and `cancelGenJob(repo, vsId, job)`; `VIDEO_COPY_MAX_FAILURES = 10`; `VIDEO_STALE_MS = 60 * 60_000`.

`advanceGenJob`: terminal job → return as is. `running` → `provider.poll(providerTaskId)` once → `pending|running` → `touchGenJob`; `succeeded` → fetch the asset (25 s timeout) → `S3Operations.uploadFile({ key: candidates/<candId>.mp4, contentType:'video/mp4' })` → `putCandidate({ candId, jobId, providerId:'grok', providerTaskId, mode:'HERO', s3Key, costUsd: reservedUsd })` → `transitionGenJob(['running'],'succeeded')` → settle billed `reservedUsd` only if it won; a fetch/upload failure → `touchGenJob({copyFailed:true})`, and once `copyFailures` reaches 10 → `transition(['running'],'failed',{code:'upstream', error:'The clip was made but couldn\'t be saved; it was still charged.'})` + settle **billed**; `failed` → transition `failed` with code/error + settle billed per `billed`; poll `ok:false` (network) → `touchGenJob` only. `cancelGenJob`: `transition(['submitted','running'],'cancelled')` → settle billed `reservedUsd` if a `providerTaskId` exists (Grok may still charge), else unbilled. Settle failures are logged and swallowed (existing pattern).

- [ ] **Step 1: Failing tests** — running+pending → attempts 1, no settle; succeeded → uploads to the exact key, writes the candidate with `candId = candIdForJob(jobId)`, one billed settle; a second advance after success does nothing; lost transition (concurrent advance) → no settle; copy failure → job still running, copyFailures 1; 10th copy failure → failed + billed settle with the exact copy; moderated → failed `content_policy` billed, no candidate; expired → failed unbilled; cancel with providerTaskId → billed, without → unbilled, cancel of a finished job → 409 "This video already finished."; job route GET returns the job and calls advance once; unknown job → 404; route never forwards the request signal.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(visual-story): advance video jobs, save clips, settle exactly once`

### Task 5: Choose a first frame

**Files:** Modify `src/app/api/admin/visual-story/[vsId]/shots/route.ts` (`update` accepts `firstFrameCandidateId: string | null`), `src/types/visualStory.ts` (schema); Test `__tests__/api/admin-visual-story-edit.test.ts` (extend)

**Rule:** the id must be a STILL candidate of the same shot (400 "Pick one of this shot's still pictures." otherwise); `null` clears it.

- [ ] **Step 1: Failing tests** — set to a STILL of the shot → saved; a video candidate → 400; another shot's still → 400; null → cleared.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(visual-story): pin a still as a shot's first frame`

### Task 6: Reconcile in-flight

**Files:** Create `src/app/api/admin/visual-story/reconcile/route.ts`; Modify `src/app/api/admin/visual-story/route.ts` (GET adds `inflightCount`), `src/components/admin/visual-story/StoryList.tsx`, `src/app/(admin)/admin/visual-story/page.tsx`; Test `__tests__/api/admin-visual-story-reconcile.test.ts`, `__tests__/components/visual-story-list.test.tsx` (extend)

**Behaviour:** `POST /api/admin/visual-story/reconcile` (auth + bearer) → `listInflight()` → `advanceGenJob` each, sequentially, stopping before 20 s elapse → `{ checked, finished, stillRunning }`. Button-only (owner's 2026-09-12 decision): the list page shows **"Check rendering videos (N)"** when `inflightCount > 0`; the result line ("2 finished, 1 still rendering") shows beside the button.

- [ ] **Step 1: Failing tests** — reconcile advances every in-flight job once and reports counts; stops at the time budget and reports the rest as still running; GET list returns `inflightCount`; button hidden at 0, shown with N, never fires on page load.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(visual-story): reconcile in-flight video jobs from the list page`

### Task 7: Guards while a clip renders

**Files:** Modify the shots route (`delete`, `reorder`), scenes route (`delete`), `draft/[draftId]/apply/route.ts`, `[vsId]/route.ts` (DELETE); Test `__tests__/api/admin-visual-story-edit.test.ts`, `__tests__/api/admin-visual-story-draft.test.ts`, `__tests__/api/admin-visual-story.test.ts` (extend)

**Rule:** if the story has any `submitted|running` gen job (from `loadTree().genJobs`), these mutations return 409 "Wait for the video to finish first." Edits of prompt/duration on other shots stay allowed.

- [ ] **Step 1: Failing tests** — each of the five mutations returns 409 with a running job and succeeds once it is terminal; a prompt update on another shot is allowed.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(visual-story): block structural edits while a clip renders`

### Task 8: Studio UI — make, watch, review, select

**Files:** Modify `src/components/admin/visual-story/ShotCard.tsx`, `Inspector.tsx`, `Studio.tsx`, `CharactersPanel.tsx`; shared helpers may move to `src/components/admin/visual-story/ui-utils.tsx`; Test `__tests__/components/visual-story-studio.test.tsx` (extend; lucide mock list if a new icon is used)

**Behaviour:**
- ShotCard: **"Make video (6 s · $0.48)"** (price from `estimateCostUsd('grok','HERO',duration)`) → confirm dialog showing the story total after this call → POST → card shows **"Rendering… about 1–3 minutes"** and polls the job route every 5 s via `pollJob` (cap 15 min, then "Still rendering. Use “Check rendering videos” on the story list.") and a **Cancel** link (confirm: "Grok may still charge for this clip."); on finish reload the tree. A running job found in `tree.genJobs` on load resumes polling. Errors (402/409/422/503/502 and a failed job's `error`) render inside the card. Button disabled while a job runs (ref + state guard).
- Candidate strip: videos as `<video controls muted playsinline preload="metadata">` from the play URL with a "Video" badge; stills keep "Still"; the radio selects either. A still has **"Use as first frame"** (PATCH Task 5) and the pinned one shows "First frame".
- Inspector: shows the first frame thumbnail with "Clear"; a line that character photos are used for videos (and limit them to 720p).
- CharactersPanel note updated: reference photos are now used for video clips.

- [ ] **Step 1: Failing tests** — confirm shows `$0.48` and the story total; pending card shows "Rendering…" and a second click sends nothing; a running job in the loaded tree resumes polling; a failed job's message renders inside the card; video candidates render a `video` element and can be selected; "Use as first frame" PATCHes the shot.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(visual-story): make, watch and select video clips in the studio`

### Task 9: Docs and the cost check

**Files:** Modify `docs/VISUAL_STORY_STUDIO.md`, `src/content/admin-docs.ts` (`visual-story-studio-plan` entry), `src/services/video/cost.ts` (comment only).

- [ ] **Step 1:** Document: Make video, prices ($0.08/s, e.g. 6 s = $0.48, a 30 s Short ≈ $2.40 per full pass), first frame, character photos (720p), cancel and the "may still charge" rule, reconcile button, what's next (assembly with the song = Phase 6). Add the **exit check** (spec §15 Phase 4): after the first clips, compare xAI console usage against the stories' spent totals; until confirmed, `GROK_RATES_VERIFIED_AT` stays null.
- [ ] **Step 2:** Full suite + `tsc` + eslint + `npx next build` — all exit 0.
- [ ] **Step 3: Commit** `docs(visual-story): video clips operator guide`

**After merge (controller + owner):** the site deploy is all that's needed (no worker, no IAM change — the app user already reads `XAI_API_KEY`). Owner makes one short test clip; controller compares xAI usage with recorded spend.
