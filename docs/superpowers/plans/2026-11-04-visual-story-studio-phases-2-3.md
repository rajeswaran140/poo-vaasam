# Visual Story Studio — Phases 2–3 Implementation Plan (Grok revision)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working storyboarding studio in the admin: start a story from a saved master and a 30–120 s window, have Claude draft scenes/shots/prompts from pasted lyrics, edit them, upload character references, and generate STILL frames with Grok Imagine under a hard per-story budget. No video generation yet, and no money spent on video.

**Architecture:** One DynamoDB partition per story (`PK=VSTORY#<vsId>`), loaded in one Query; sparse GSI1 for list-all and (later) stranded jobs. The video provider port and `FakeVideoProvider` land now so Phase 4 is an adapter. STILL frames go through an `ImageProvider` seam (Grok first). The storyboard draft follows the Lyricist's inline, tool-forced Claude call. Budget is a hard cap: reserve before a paid call, settle after.

**Tech Stack:** Next.js 15 App Router, TypeScript, zod, `@anthropic-ai/sdk`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-s3` + `s3-presigned-post`, `@aws-sdk/client-ssm`, jest (jsdom), `fetch` for xAI.

**Spec:** `docs/superpowers/specs/2026-09-11-visual-story-studio-design.md` (revised 2026-11-04, PR #400). Supersedes `docs/superpowers/plans/2026-09-12-visual-story-studio-phases-2-3.md`.

## Global Constraints

- No new AWS resource (table, GSI, bucket, Lambda) and **no new npm dependency**. xAI is called with `fetch`.
- Table `TamilWebContent` only through `DynamoDBOperations` (`src/infrastructure/database/dynamodb-client.ts`): `put/get/query/update/delete/batchWrite/transactWrite`. Never a scan.
- Every route: `requireAdmin(request)`; every mutation also `requireBearer(request)` (`@/lib/auth-helper`), errors via `authErrorResponse`.
- Storage: bucket `TAKES_BUCKET` (`tamil-web-media`), prefix **`audio/mastering/visual-story/<vsId>/`** — `refs/<charId>/<uuid>.<ext>`, `candidates/<candId>.jpg`. Keys always built server-side from validated ids. Playback/preview via the existing `/api/admin/mastering/download?key=…&mode=play` (its `isMasteringKey` accepts this prefix).
- xAI key: runtime SSM `/amplify/${AWS_APP_ID ?? 'd3rkmepk4popv0'}/${AWS_BRANCH ?? 'master'}/XAI_API_KEY`, `WithDecryption`, cached per container. Never logged, stored or sent to the client. Missing ⇒ `not_configured`, feature inert.
- Statuses verbatim: `VisualStoryStatus = 'DRAFT'|'STORYBOARDING'|'GENERATING'|'REVIEW'|'COMPLETE'`; `ShotMode = 'STILL'|'MOTION'|'HERO'`; `GenJobStatus = 'submitted'|'running'|'succeeded'|'failed'|'cancelled'`.
- `AspectRatio = '16:9' | '9:16'`, fixed at creation. Window length 30–120 s inside the master's `editedDurationSec`. Shot `durationSec` integer 1–15.
- Rates (spec §11): Grok image $0.02/image; `grok-imagine-video-1.5-lite` $0.020/s (MOTION); `grok-imagine-video-1.5` $0.080/s (HERO). `DEFAULT_BUDGET_USD_CAP = 40`.
- Sparse index: METADATA `GSI1PK='VSTORY'`, `GSI1SK='<masterJobId>#<createdAt>#<vsId>'`.
- Public repo: **no song titles or arrangement detail** in code, tests or fixtures — use "Test song", "Scene 1".
- Error copy shows **next to the control that caused it**, not only in a page banner.
- jest: `NODE_OPTIONS=--no-experimental-strip-types npx jest <path>`; full suite + `npx tsc --noEmit` + `npx eslint .` green before each commit's push. `npm install` needs `--legacy-peer-deps` (not expected here).

## Review Focus

1. **Double-clicked or concurrent paid calls** (two STILL clicks, a STILL during a draft) — the cap must hold: the second reservation that would cross it is refused with 402 and nothing is called. Test in Task 3 and Task 10.
2. **A master with no recorded length** (`editedDurationSec: null`, ~1 in 5 saved masters) or an unsaved master — creation must refuse with a message that names the fix, not 500. Test in Task 8.
3. **A draft whose durations don't add up to the window** (model drift) — repaired deterministically or refused, never applied as a non-tiling storyboard. Test in Task 7.
4. **9:16 stories** — every STILL request carries the story's aspect; a 16:9 frame in a vertical story is a defect. Test in Task 6 and Task 10.
5. **Provider charges when it refuses** — Grok image `respect_moderation: false` is billed: spend increases and the shot shows a content-policy message beside its prompt. Test in Task 6 and Task 10.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/types/visualStory.ts` | Client-safe types, zod schemas, id validators, `deriveStartSecs`, `tilesWindow`. |
| `src/services/video/cost.ts` | Rate cards, estimates, draft cost from tokens. Pure. |
| `src/infrastructure/database/VisualStoryRepository.ts` | All DynamoDB access incl. reserve/settle. |
| `src/services/video/providers/{types,fake,index}.ts` | Video port, test double, registry. |
| `src/services/video/credentials.ts` | Runtime SSM read of `XAI_API_KEY`. |
| `src/services/video/image-providers.ts` | STILL seam: `grok-image`, `openai-image`. |
| `src/services/ai/storyboarder.ts` (+ `storyboarderSchema.ts`) | Claude storyboard draft. |
| `src/lib/visual-story-rate-limit.ts` | `visualStoryLimiter`. |
| `src/lib/visual-story-storage.ts` | Key builders + accepted ref types/caps. |
| `src/app/api/admin/visual-story/**` | Routes (spec §8, Phase 2–3 subset). |
| `src/app/(admin)/admin/visual-story/{page.tsx,[vsId]/page.tsx}` | List + studio. |
| `src/components/admin/visual-story/*.tsx` | Panels. |

---

### Task 1: Types, schemas and timeline helpers

**Files:** Create `src/types/visualStory.ts`; Test `__tests__/types/visualStory.test.ts`

**Interfaces — Produces:**
- Types `VisualStoryStatus`, `ShotMode`, `GenJobStatus`, `AspectRatio`, `VisualStory`, `Scene`, `Shot`, `Character`, `Candidate`, `StoryboardDraft`, `DraftScene`, `DraftShot`.
- `isVsId(s)`: `/^vs_\d{13}_[a-z0-9]{6,12}$/`; `isCharId`, `isCandId`, `isDraftId` same shape with prefixes `ch_`, `cd_`, `dr_`; `newId(prefix)`.
- `createStorySchema`: `{ masterJobId, title (1–120), aspectRatio, windowStartSec ≥0, windowEndSec, contentId?, budgetUsdCap? (0–500) }` with refinement `30 ≤ end−start ≤ 120`.
- `sceneInputSchema { heading 1–120, summary ≤600 }`, `shotInputSchema { mode, durationSec int 1–15, visualPrompt 1–2000, negativePrompt ≤1000, charIds ≤14 }`, `characterInputSchema { name 1–60, description ≤1000 }`.
- `draftRequestSchema { lyrics 1–8000 (trimmed) }`.
- `deriveStartSecs(shots: {durationSec}[]): number[]` — cumulative, starting 0.
- `tilesWindow(shots, windowSec): boolean` — sum of durations === windowSec.

- [ ] **Step 1: Write the failing tests** — `createStorySchema` accepts `{masterJobId:'abc-1', title:'Test song', aspectRatio:'9:16', windowStartSec:10, windowEndSec:70}`; rejects window 29 s and 121 s with a message containing `30–120`; rejects `aspectRatio:'1:1'`; `shotInputSchema` rejects `durationSec: 0`, `16`, `2.5`; `deriveStartSecs([{durationSec:5},{durationSec:8},{durationSec:2}])` → `[0,5,13]`; `tilesWindow` true for sum 60 vs 60, false for 59; `isVsId('vs_1793000000000_abc123')` true, `isVsId('VSTORY#x')` false.
- [ ] **Step 2: Run** `NODE_OPTIONS=--no-experimental-strip-types npx jest __tests__/types/visualStory.test.ts` — Expected: FAIL, module not found.
- [ ] **Step 3: Implement** — no server imports (follows `src/types/story.ts`).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(visual-story): types, schemas and timeline helpers`

### Task 2: Cost model

**Files:** Create `src/services/video/cost.ts`; Test `__tests__/services/video/cost.test.ts`

**Interfaces — Consumes:** `ShotMode`. **Produces:** `RateCard { flatUsd; perSecondUsd }`, `RATE_CARDS: Record<'fake'|'grok', Record<ShotMode, RateCard>>`, `GROK_RATES_VERIFIED_AT = null as string | null` (set in Phase 4), `DEFAULT_BUDGET_USD_CAP = 40`, `estimateCostUsd(providerId, mode, durationSec): number`, `DRAFT_ESTIMATE_USD = 0.15`, `SONNET_USD_PER_MTOK = { input: 3, output: 15 }`, `draftCostUsd(inputTokens, outputTokens): number`.

- [ ] **Step 1: Failing tests** — `estimateCostUsd('grok','STILL',8)` = 0.02; `('grok','MOTION',5)` ≈ 0.10; `('grok','HERO',15)` ≈ 1.20; `('fake','HERO',10)` = 0; unknown provider throws `/unknown provider/i`; `draftCostUsd(2000, 1500)` ≈ 0.0285.
- [ ] **Step 2: Run** — FAIL, module not found.
- [ ] **Step 3: Implement** — STILL ignores duration (`flatUsd: 0.02`); MOTION/HERO `perSecondUsd` 0.02/0.08, `flatUsd: 0`. Header comment: rates from xAI's table 2026-11-04, unverified against billing until Phase 4.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(visual-story): Grok rate card and cost estimates`

### Task 3: Repository — story lifecycle and the budget reservation

**Files:** Create `src/infrastructure/database/VisualStoryRepository.ts`; Test `__tests__/infrastructure/visual-story-repository.test.ts` (mock `DynamoDBOperations` as other repository tests do).

**Interfaces — Produces:** class `VisualStoryRepository` with `create(input: CreateStoryInput & {audioKey}): Promise<VisualStory>`, `findById(vsId)`, `list()`, `listByMaster(masterJobId)`, `patch(vsId, fields: {title?, status?, budgetUsdCap?})`, `remove(vsId)` (query partition → batch delete), **`reserve(vsId, usd): Promise<boolean>`**, **`settle(vsId, {reservedUsd, billedUsd}): Promise<void>`**; key builders `vsPk`, `sceneSk(n)`, `shotSk(s, sh)`, `candSk(s, sh, candId)`, `charSk`, `draftSk`; constants `VSTORY_INDEX_PK = 'VSTORY'`, `VSTORY_INFLIGHT_PK = 'VSTORY_INFLIGHT'`.

- METADATA carries **`committedUsd` = spentUsd + reservedUsd**, because DynamoDB condition expressions cannot do arithmetic.
- `reserve`: read the story (`findById`), compute `:limit = budgetUsdCap − usd`, then one `update`: `ADD reservedUsd :u, committedUsd :u` with `ConditionExpression: committedUsd <= :limit AND budgetUsdCap = :capRead`. The second clause makes a cap edit between the read and the write fail the reservation instead of overspending. `ConditionalCheckFailedException` ⇒ `false`; any other error rethrows. A negative `:limit` returns `false` without writing.
- `settle({reservedUsd: r, billedUsd: b})`: one `update`, `ADD reservedUsd :negR, spentUsd :b, committedUsd :delta` where `:negR = −r` and `:delta = b − r` (computed in code).
- Money is rounded to 6 decimals before every write to keep float drift out of the condition.
- `create` writes `spentUsd: 0, reservedUsd: 0, committedUsd: 0`, `budgetUsdCap ?? DEFAULT_BUDGET_USD_CAP`, status `DRAFT`, `providerId: 'grok'`, `GSI1PK/GSI1SK`.

- [ ] **Step 1: Failing tests** — create writes the index attrs and zero counters; `listByMaster` queries GSI1 with `begins_with '<masterJobId>#'`; `reserve` returns `true` and sends the conditional ADD; `reserve` returns `false` on `ConditionalCheckFailedException` and rethrows any other error; **two reserves of 0.30 against cap 0.50 → first true, second false** (fake store that evaluates the condition); `settle({reservedUsd:0.02, billedUsd:0.02})` leaves `committedUsd` unchanged and moves 0.02 from reserved to spent; `settle({reservedUsd:0.02, billedUsd:0})` releases only.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(visual-story): repository with hard-cap budget reservation`

### Task 4: Repository — tree, scenes, shots, characters, candidates, drafts

**Files:** Modify `VisualStoryRepository.ts`; Test `__tests__/infrastructure/visual-story-repository-tree.test.ts`

**Interfaces — Produces:** `loadTree(vsId): Promise<{story, scenes, shots, characters, candidates, drafts} | null>` (one Query, split by SK prefix; shots carry derived `startSec` via `deriveStartSecs` over scene→shot order); `putScene`, `putShot`, `deleteShot`, `reorderShots(vsId, sceneOrder, newOrder: number[])` (rewrites keys by `transactWrite`, ≤ 100 items), `putCharacter`, `addCharacterRef(vsId, charId, key)`, `putCandidate(vsId, cand)`, `selectCandidate(vsId, s, sh, candId)`, `putDraft(vsId, draft)`, `getDraft`, **`applyDraft(vsId, draftId)`** — replaces all `SCENE#/SHOT#` items with the draft's and creates `CHAR#` items for draft characters not already present by name, in one `transactWrite`; refuses (throws `DraftTooLargeError`) above 100 items.

- [ ] **Step 1: Failing tests** — `loadTree` returns shots ordered and with `startSec` `[0,5,13]` for durations 5/8/2; `reorderShots` writes new SKs and deletes old ones in one transaction; `applyDraft` of 3 scenes / 8 shots writes 11 items + new characters and deletes prior scenes/shots; a draft over 100 items throws `DraftTooLargeError`; `selectCandidate` sets `selectedCandidateId`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(visual-story): story tree, ordering and draft apply`

### Task 5: Video port, fake, registry and the xAI credential

**Files:** Create `src/services/video/providers/{types,fake,index}.ts`, `src/services/video/credentials.ts`; Tests `__tests__/services/video/{fake-provider,credentials}.test.ts`

**Interfaces — Produces:** the port verbatim from spec §6 (`VideoErrorCode`, `VideoGenRequest` with `aspectRatio: AspectRatio` and `firstFrameUrl?`, `SubmitResult`, `PollResult`, `VideoGenerationProvider`); `FakeVideoProvider` (`pending→running→succeeded` after N polls, cost 0); `getVideoProvider(id?)` (`id → VIDEO_PROVIDER env → 'grok'`; unknown throws; `'grok'` throws `not implemented until Phase 4` for now); `getXaiApiKey(): Promise<string | null>` (cached; `ParameterNotFound` ⇒ null; other errors rethrow); `__resetXaiKeyCacheForTests()`.

- [ ] **Step 1: Prove `@aws-sdk/client-ssm` resolves under jsdom** (spec §14): a test that imports `credentials.ts` with `SSMClient.prototype.send` mocked. Run it. If it fails on a `browser`-conditioned subpath, add that exact subpath to `moduleNameMapper` in `jest.config.ts` (enumerate; no wildcard, no transform). Expected after fix: resolves.
- [ ] **Step 2: Failing tests** — key cached (second call no SSM send); `ParameterNotFound` ⇒ null; parameter name is `/amplify/d3rkmepk4popv0/master/XAI_API_KEY` with env unset; fake: submit → poll ×N → `succeeded` with one `video` asset; `getVideoProvider('nope')` throws.
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement.** **Step 5: Run** — PASS.
- [ ] **Step 6: Commit** `feat(visual-story): video provider port, fake, registry, xAI credential`

### Task 6: STILL image providers

**Files:** Create `src/services/video/image-providers.ts`; Test `__tests__/services/video/image-providers.test.ts` (mock `global.fetch` and `getXaiApiKey`; never call xAI).

**Interfaces — Consumes:** `getXaiApiKey`, `AspectRatio`, `VideoErrorCode`, `generateCoverArt`. **Produces:** `ImageResult = {ok:true; bytes: Buffer; contentType: 'image/jpeg'|'image/png'; billed: true} | {ok:false; code: VideoErrorCode | 'billing'; error: string; billed: boolean}`; `generateStillImage({providerId?: 'grok-image'|'openai-image', prompt, aspectRatio, signal?}): Promise<ImageResult>`.

Grok request: `POST https://api.x.ai/v1/images/generations`, headers `Authorization: Bearer <key>`, body `{ model: 'grok-imagine-image', prompt, n: 1, aspect_ratio, response_format: 'b64_json' }`, 25 s timeout. Response `data[0].b64_json`. Mapping: `respect_moderation === false` ⇒ `{code:'content_policy', billed:true}`; HTTP 401/403 ⇒ `auth`; 429 ⇒ `rate_limit`; body mentioning credits/billing ⇒ `billing` ("The xAI account is out of credit. Add credits in the xAI console, then try again."); other ⇒ `upstream`; missing data ⇒ `bad_response`; no key ⇒ `not_configured`. Raw upstream text logged, never returned. `openai-image` refuses `9:16` with `bad_response` "OpenAI stills are landscape only" (spec §6.4).

- [ ] **Step 1: Failing tests** — body carries `aspect_ratio: '9:16'` and `response_format: 'b64_json'` and model `grok-imagine-image`; success decodes bytes; `respect_moderation:false` ⇒ `content_policy`, `billed:true`; 401 ⇒ `auth`, error has no raw text; 429 ⇒ `rate_limit`; no key ⇒ `not_configured` and fetch never called; openai-image with 9:16 refused without calling `generateCoverArt`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(visual-story): Grok still-image provider`

### Task 7: Storyboard drafter (Claude)

**Files:** Create `src/services/ai/storyboarderSchema.ts`, `src/services/ai/storyboarder.ts`; Test `__tests__/services/ai/storyboarder.test.ts` (mock `@anthropic-ai/sdk` as `lyricist.test.ts` does).

**Interfaces — Produces:** `storyboardOutputSchema` = `{ characters: [{name, description}] ≤ 6, scenes: [{heading, summary, shots: [{durationSec 1–15 int, mode: ShotMode (default STILL), visualPrompt, characterNames[]}] ≥1}] 1–12 }` + `storyboardOutputJsonSchema`; `generateStoryboard({lyrics, windowSec, aspectRatio, signal?}): Promise<{ok:true; data; usage:{inputTokens, outputTokens}} | {ok:false; code: 'not_configured'|'auth'|'billing'|'rate_limit'|'upstream'|'bad_response'; error}>`.

Copy the Lyricist's call shape (`claude-sonnet-4-6`, tool-forced `submit_storyboard`, `REQUEST_TIMEOUT_MS = 25_000`, max_tokens 6000) and its error mapping including the `billing` branch from #399. System prompt requirements (spec §6.5): imagery specific to the lyrics' places, seasons and people; no stock clichés; no text or lettering in frame; apolitical rule copied from the Lyricist; characters invented for this song only; shots in `aspectRatio` framing; durations sum to `windowSec`.

**Tiling repair (deterministic):** after parsing, let `diff = windowSec − Σdur`. If `|diff| ≤ 15`, adjust shots from the last backwards, each within 1–15, until `diff = 0`; otherwise return `bad_response` "The draft's shots did not fit the chosen length. Please draft again."

- [ ] **Step 1: Failing tests** — happy path returns data whose durations sum to `windowSec`; sum short by 4 ⇒ repaired (last shot +4, capped at 15, spill to previous); sum off by 40 ⇒ `bad_response`; system prompt contains `no text` and the apolitical line; the user message contains the lyrics and `9:16`; credit-balance 400 ⇒ `billing`; max_tokens stop ⇒ `bad_response`; usage returned.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(visual-story): Claude storyboard drafter with tiling repair`

### Task 8: Story routes — list, create, read, patch, delete

**Files:** Create `src/lib/visual-story-rate-limit.ts` (`visualStoryLimiter = new RateLimiter({ windowMs: 60_000, max: 20 })`), `src/app/api/admin/visual-story/route.ts`, `src/app/api/admin/visual-story/[vsId]/route.ts`; Tests `__tests__/api/admin-visual-story.test.ts`

**Interfaces — Consumes:** Tasks 1, 3, 4; `MasterJobRepository.get`, `isValidMasterJobId`, `ContentRepository.findById`. **Produces:** `GET /api/admin/visual-story[?masterJobId=]` → `{success, data: VisualStory[]}`; `POST` → `201 {success, data: VisualStory}`; `GET /[vsId]` → `{success, data: tree}`; `PATCH /[vsId]` `{title?, status?, budgetUsdCap?}`; `DELETE /[vsId]`.

Create refusals (400 unless noted, message shown beside the form): invalid body; master not found (404) — "That master no longer exists."; master not saved — "Save this master in the library first."; no `masterKey` — "This master hasn't finished mastering."; `editedDurationSec == null` — "This master has no recorded length. Re-open it in Mastering and save it again."; window beyond the length — "The window ends after the song does (song is m:ss)."; `contentId` given but unknown (404). `audioKey = masterKey`. PATCH refuses `budgetUsdCap < committedUsd` (409, "The cap can't go below what's already spent or reserved ($x.xx).").

- [ ] **Step 1: Failing tests** — 401 without auth; 403/401 on cookie-only POST (bearer required); each refusal above with its status and message; happy create returns 201 with `audioKey` = the master's `masterKey`; PATCH cap below committed → 409; DELETE removes the partition; rate-limit 21st POST → 429.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(visual-story): story routes anchored to saved masters`

### Task 9: Scene, shot, character routes and reference upload

**Files:** Create `src/lib/visual-story-storage.ts`, `src/app/api/admin/visual-story/[vsId]/{scenes,shots,characters}/route.ts`, `.../characters/[charId]/upload/route.ts`; Tests `__tests__/api/admin-visual-story-edit.test.ts`, `__tests__/lib/visual-story-storage.test.ts`

**Interfaces — Produces:** `refKey(vsId, charId, ext)`, `candidateKey(vsId, candId, ext)` (both under `audio/mastering/visual-story/`), `ACCEPTED_REF_TYPES = ['image/jpeg','image/png','image/webp']`, `MAX_REF_BYTES = 10 * 1024 * 1024`, `MAX_REFS_PER_CHARACTER = 4`. Routes: scenes `{op:'create'|'update'|'delete', ...}`; shots `{op:'create'|'update'|'delete'|'reorder', ...}` (update of `durationSec` returns the recomputed `startSec`s and the window's tiling state); characters create/update; upload → presigned POST (pattern of `/api/admin/mastering/upload`: `content-length-range` 1..MAX_REF_BYTES, pinned content type, 1 h TTL) and on `{op:'confirm', key}` appends the key to the character after `HeadObject` confirms it exists.

- [ ] **Step 1: Failing tests** — keys never contain `..` and always start with `audio/mastering/visual-story/<vsId>/`; upload refuses `image/gif` and a 5th ref; a client-supplied key outside the character's prefix on confirm → 400; shot update with `durationSec: 16` → 400; reorder returns new `startSec`s; every mutation without bearer → 401.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(visual-story): scene, shot and character editing with private reference upload`

### Task 10: STILL generation route

**Files:** Create `src/app/api/admin/visual-story/[vsId]/shots/[shotKey]/still/route.ts` (`shotKey` = `nnn-mmm`), `src/app/api/admin/visual-story/[vsId]/select/route.ts`; Test `__tests__/api/admin-visual-story-still.test.ts`

**Flow:** auth + bearer → rate limit → load tree, find shot (404) → `est = estimateCostUsd('grok','STILL',…)` → `reserve(vsId, est)`; false ⇒ **402** "This would go over the story's budget ($spent of $cap)." → `generateStillImage({prompt: shot.visualPrompt + character descriptions, aspectRatio: story.aspectRatio, signal})` → on ok: `PutObject` to `candidateKey(vsId, candId, 'jpg')`, `putCandidate({providerId:'grok-image', providerTaskId:null, s3Key, costUsd: est, mode:'STILL'})`, `settle({reservedUsd: est, billedUsd: est})`, 201 with the candidate → on failure: `settle({reservedUsd: est, billedUsd: billed ? est : 0})`, status from the code (`not_configured` 503, `billing` 503, `rate_limit` 429, `content_policy` 422, else 502). If the S3 put fails after a billed image, settle as billed and return 502 "The image was made but couldn't be saved; it was still charged." `select` sets `selectedCandidateId`.

- [ ] **Step 1: Failing tests** — happy path: provider called with the story's `aspectRatio` (`9:16` fixture), S3 key under `candidates/`, spend settled 0.02; reserve false ⇒ 402 and provider never called; content_policy ⇒ 422, settled as billed; upstream ⇒ 502, released (billed 0); not_configured ⇒ 503, released; S3 failure after success ⇒ 502 and billed; select with a candidate from another shot ⇒ 400.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(visual-story): STILL generation under the hard budget cap`

### Task 11: Draft routes

**Files:** Create `src/app/api/admin/visual-story/[vsId]/draft/route.ts`, `.../draft/[draftId]/apply/route.ts`; Test `__tests__/api/admin-visual-story-draft.test.ts`

**Flow (draft):** auth + bearer → rate limit → `draftRequestSchema` → `reserve(vsId, DRAFT_ESTIMATE_USD)` (402 as Task 10) → `generateStoryboard({lyrics, windowSec: end − start, aspectRatio})` → ok: `putDraft({draftId, lyricsHash: sha256(lyrics), model, inputTokens, outputTokens, costUsd: draftCostUsd(...), scenes, characters})`, `settle({reservedUsd: DRAFT_ESTIMATE_USD, billedUsd: costUsd})`, 201 → failure: settle with billed 0, status by code (`billing` 503 with its message). **The lyrics are not stored** — only the hash. **Apply:** `applyDraft`; `DraftTooLargeError` ⇒ 400; sets story status `STORYBOARDING`.

- [ ] **Step 1: Failing tests** — stored draft item has `lyricsHash` and **no `lyrics` field** (assert on the put payload); settle uses actual token cost; empty lyrics → 400; 8001 chars → 400; billing → 503 with the out-of-credit message; apply replaces scenes/shots and returns the tree; apply of unknown draft → 404.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(visual-story): storyboard draft and apply routes`

### Task 12: List page, "New from master" and navigation

**Files:** Create `src/app/(admin)/admin/visual-story/page.tsx`, `src/components/admin/visual-story/{StoryList,NewStoryForm,WindowPicker}.tsx`; Modify `src/app/(admin)/AdminLayoutClient.tsx` (nav entry beside the Lyricist/Music Director creative tools; `PAGE_TITLES['/admin/visual-story']` = "Visual Story Studio" / "Storyboard and generate music videos"); Test `__tests__/components/visual-story-list.test.tsx`

**Behaviour:** table of stories (title, aspect, status, shots, `$spent of $cap`) linking to the studio; "New from master" lists saved masters via `GET /api/admin/music-lab/masters` (title, length); WindowPicker = start (m:ss) + length (30–120 s) with the end shown and clamped to the song; aspect radio 16:9 / 9:16; budget field (default 40). Create errors render under the form's submit button.

- [ ] **Step 1: Failing tests** — list renders spend as `$0.42 of $40.00`; picking a master with `editedDurationSec: 95` clamps a 120 s length to 95−start; a 400 from create shows its message beneath the submit button; masters without a length are listed but disabled with "no recorded length".
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** with `adminFetch`. **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(visual-story): story list, new-from-master form and nav`

### Task 13: The studio page

**Files:** Create `src/app/(admin)/admin/visual-story/[vsId]/page.tsx`, `src/components/admin/visual-story/{Studio,SceneRail,ShotGrid,ShotCard,Inspector,CharactersPanel,DraftPanel,SpendBar}.tsx`; Test `__tests__/components/visual-story-studio.test.tsx` (if the studio introduces a new lucide icon, add it to the test's lucide mock list).

**Behaviour (spec §10):** left scene rail; centre shot grid (mode badge, prompt, character chips, `startSec`–end in m:ss, estimate, **"Generate still ($0.02)"** → confirm dialog showing the story total after this call → POST; candidate strip with radio select); right inspector (prompt, negative prompt, duration, characters) and Characters panel (create, upload ref with preview via `mode=play`); Draft panel (paste lyrics → "Draft storyboard (≈$0.15)" → preview scenes/shots with total vs window → "Apply" with a warning that it replaces the current storyboard); bottom SpendBar (`$spent + $reserved of $cap`) and a tiling indicator ("Shots fill 58 of 60 s"). A shot's error (402/422/503) renders **inside that ShotCard** next to its button; draft errors inside the Draft panel. The Generate button is disabled while its request is in flight (no double click).

- [ ] **Step 1: Failing tests** — a 422 from still renders the content-policy message inside the shot card, not the page banner; the button is disabled while pending and a second click sends nothing; confirm dialog shows the price and the story total; Apply shows the replace warning; tiling indicator reads `Shots fill 58 of 60 s` for that fixture.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(visual-story): studio page with draft, still generation and spend`

### Task 14: Docs, IAM change and owner steps

**Files:** Modify `src/content/admin-docs.ts` (the `visual-story-studio-plan` entry: Grok, master anchor, draft, what Phase 3 can do, owner steps), `docs/IAM_LEAST_PRIVILEGE.md` (the `ssm:GetParameter` grant on `/amplify/d3rkmepk4popv0/master/XAI_API_KEY`); Create `docs/VISUAL_STORY_STUDIO.md` (operator guide: create → draft → edit → stills; costs; where files live). Test: existing admin-docs tests pass.

- [ ] **Step 1:** Update the docs. Prepare the exact IAM policy JSON in the PR description. **Do not apply it** — the owner applies or approves it (spec §6.2.2).
- [ ] **Step 2: Run** the full suite, `npx tsc --noEmit`, `npx eslint .` — Expected: all green.
- [ ] **Step 3: Commit** `docs(visual-story): operator guide, admin doc and IAM grant`

**After merge (owner):** create the xAI key and store it as the SecureString above; approve the IAM grant. Until then the studio works for storyboarding and drafts, and STILL buttons show "Grok isn't connected yet".
