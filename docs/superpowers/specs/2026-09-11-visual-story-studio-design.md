# Visual Story Studio — Design

- **Date:** 2026-09-11
- **Status:** Approved design. Implementation plan not yet written.
- **Scope:** A provider-neutral AI visual-story workflow inside the existing TamilAgaval admin.

---

## 1. Purpose

Turn a published TamilAgaval piece — a song or a musical story — into a sequence of
AI-generated video clips, through an admin workflow that keeps the expensive step
deliberate and reversible:

```
Content → Visual Story → Scenes → Shots → Character Refs
        → Visual Prompts → AI Generation → Candidates → Selected Clips → Timeline
```

Seedance 2.5 (BytePlus) is the first video provider. The application is **not** coupled
to it: generation sits behind a `VideoGenerationProvider` port so Veo or any other
provider is a new adapter file plus one `case` in a registry.

## 2. Background — the `/api/stories` name collision

The original brief said to reuse `/api/stories`. Inspection shows that would be wrong,
and the reason is a name collision worth recording so it is not re-proposed later.

`/api/stories` is the **"Share Your Story" fan-submission moderation inbox**:

- `PK=STORY#<id>`, `SK=METADATA`, `entityType: 'STORY'`
- fields: `name`, `email`, `featureConsent`, `theme`, `source`
- lifecycle: `NEW → REVIEWED → FEATURED → ARCHIVED`
- one public, rate-limited, honeypot-guarded POST route

The artifact a Visual Story storyboards is a different entity entirely: a **`CONTENT`**
record (for example the 2026-09-11 musical story, `cnt_1789096978174_fd96yxbx61`).
Hanging scenes off a moderation-queue row would couple the studio to an unrelated
lifecycle.

**Decision:** a Visual Story anchors to a `contentId`. `src/app/api/stories/route.ts` and
`src/types/story.ts` are not modified by this work.

What *is* reused from `/api/stories` is its route shape: a client-safe types module in
`src/types/` carrying the zod schemas, `DynamoDBOperations` for persistence, and the
validation/rate-limit conventions.

## 3. Constraints

**Product constraints (set by the project owner):**

1. Reuse the existing architecture; follow existing patterns rather than introducing new ones.
2. Use the existing DynamoDB single table `TamilWebContent`. No second datastore.
3. Use the existing S3 infrastructure for references and generated video.
4. BytePlus credentials go through the existing SSM SecureString mechanism.
5. Video generation must be asynchronous.
6. Track generation status, provider task ID, cost, candidates, selected clip, and errors.
7. Support `STILL`, `MOTION`, and `HERO` modes to control cost.
8. No unnecessary dependencies and no unnecessary AWS resources.

**Platform constraint (discovered, and decisive):**

Amplify managed compute has a **~30 s execution ceiling and silently drops `after()`
background work**. This is documented in `worker/compose-worker.ts` and was learned in
production — `suno-setup` shipped inline on an Amplify route and 504'd on every real
song. Long work therefore runs on a standalone worker Lambda, bundled from `src/` by
esbuild so there is no logic drift.

Constraint 8 and the need to poll a minutes-long provider task pull against each other.
Section 7 records how that tension was resolved and why.

## 4. Decisions locked before writing this spec

| # | Decision | Chosen | Rejected alternatives |
|---|---|---|---|
| D1 | Provider polling | **Client-driven poll** | EventBridge + reconciler Lambda (needs a new AWS resource); self-rescheduling worker (no precedent in this repo) |
| D2 | Parent entity | **Anchor to `contentId`**, many treatments per content allowed | One visual story per content (`PK=VSTORY#<contentId>`); standalone with nullable `contentId` |
| D3 | Seedance API schema | **Project owner supplies the BytePlus API reference at Phase 4.** A `FakeVideoProvider` unblocks Phases 2–4 | Model researches public docs (Seedance 2.5 is new; risk of stale or incomplete references) |

## 5. Data model

One DynamoDB partition holds an entire visual story, so loading the studio is a single
`Query` against the base table with no index.

```
PK = VSTORY#<vsId>

  SK = METADATA
       contentId, title, status, aspectRatio, providerId,
       budgetUsdCap, spentUsd, createdAt, updatedAt
       GSI1PK = 'VSTORY'
       GSI1SK = '<contentId>#<createdAt>#<vsId>'

  SK = CHAR#<charId>
       name, description, refImageKeys[], createdAt

  SK = SCENE#<nnn>
       order, heading, summary, tamilText

  SK = SHOT#<nnn>#<mmm>
       sceneOrder, shotOrder, mode, durationSec,
       visualPrompt, negativePrompt, charIds[], selectedCandidateId

  SK = CAND#<nnn>#<mmm>#<candId>
       jobId, providerId, providerTaskId, s3Key, posterKey,
       costUsd, createdAt

  SK = GENJOB#<jobId>
       status, mode, providerId, providerTaskId, sceneOrder, shotOrder,
       estimatedCostUsd, actualCostUsd, attempts, lastPolledAt,
       error { code, message }, createdAt, updatedAt
       GSI1PK = 'VSTORY_INFLIGHT'        (present ONLY while non-terminal)
       GSI1SK = '<createdAt>#<vsId>#<jobId>'
```

**Ordering.** `nnn` and `mmm` are zero-padded three-digit integers so `begins_with`
scans sort correctly. Reordering rewrites the `order` field and the item key; it is a
batch write, not an in-place mutation.

**No TTL.** Unlike `MASTERJOB#` items, a `GENJOB#` item *is* the cost record and must
survive indefinitely.

### 5.1 Access patterns

| Pattern | Mechanism | Index |
|---|---|---|
| Load a whole visual story | `Query PK=VSTORY#<vsId>` | none |
| Scenes only / shots in a scene / candidates for a shot | same query, `SK begins_with` | none |
| List all visual stories | `Query GSI1PK='VSTORY'` | GSI1 (sparse) |
| Find treatments of one content record | `Query GSI1PK='VSTORY'`, `GSI1SK begins_with '<contentId>#'` | GSI1 (sparse) |
| Find stranded in-flight jobs | `Query GSI1PK='VSTORY_INFLIGHT'` | GSI1 (sparse) |

**No new GSI is created.** DynamoDB permits 20 GSIs per table and `TamilWebContent`
uses 5 (`GSI1`–`GSI5`), so headroom is not the issue; the reason to avoid one is
constraint 8 plus backfill cost over ~11.9k items. GSI1 is already shared across entity
types, and the two new partition values (`VSTORY`, `VSTORY_INFLIGHT`) are namespaced so
they cannot collide with existing ones such as `MASTERJOB_SAVED`.

The sparse-index technique — write the `GSI1PK` attribute only on rows that belong in the
index, and `REMOVE` it when they no longer do — follows `MasterJobRepository`, which uses
it for saved masters.

> **Pre-existing defect, noted but not fixed here.** `ContentRepository.getMostViewed()`
> (`src/infrastructure/database/ContentRepository.ts:597`) queries `GSI6`, which does not
> exist on the table. That call throws `ValidationException` in production today. It is
> unrelated to this work and should be tracked separately.

### 5.2 Status vocabularies

```ts
type VisualStoryStatus = 'DRAFT' | 'STORYBOARDING' | 'GENERATING' | 'REVIEW' | 'COMPLETE';
type ShotMode         = 'STILL' | 'MOTION' | 'HERO';
type GenJobStatus     = 'submitted' | 'running' | 'succeeded' | 'failed' | 'cancelled';
```

`succeeded`, `failed` and `cancelled` are terminal; reaching any of them removes the
`GSI1PK` attribute from the job item.

## 6. Provider architecture

Modelled directly on the existing `ComposerEngine` port
(`src/services/ai/engines/types.ts`), which already proves the pattern with two adapters.

```ts
export type VideoErrorCode =
  | 'not_configured'   // credential missing or placeholder
  | 'auth'             // credential present but rejected
  | 'rate_limit'       // provider 429 / quota exhausted
  | 'upstream'         // any other API or network failure, incl. timeout
  | 'bad_response'     // call succeeded but returned nothing usable
  | 'content_policy';  // provider refused the prompt

export interface VideoGenRequest {
  prompt: string;
  negativePrompt?: string;
  mode: ShotMode;
  durationSec: number;
  aspectRatio: '16:9' | '9:16' | '1:1';
  referenceImageUrls?: string[];   // short-lived signed S3 URLs
  seed?: number;
  signal?: AbortSignal;
}

export interface ProviderAsset {
  kind: 'video' | 'poster';
  url: string;                     // provider-hosted, expiring
  contentType: string;
}

export type SubmitResult =
  | { ok: true; providerTaskId: string; estimatedCostUsd: number }
  | { ok: false; code: VideoErrorCode; error: string };

export type PollResult =
  | { ok: true; state: 'pending' | 'running' }
  | { ok: true; state: 'succeeded'; assets: ProviderAsset[]; actualCostUsd: number | null }
  | { ok: true; state: 'failed'; code: VideoErrorCode; error: string }
  | { ok: false; code: VideoErrorCode; error: string };

export interface VideoGenerationProvider {
  readonly id: string;
  readonly model: string;
  isConfigured(): Promise<boolean>;
  estimateCostUsd(req: VideoGenRequest): number;
  submit(req: VideoGenRequest): Promise<SubmitResult>;
  poll(providerTaskId: string): Promise<PollResult>;
  cancel?(providerTaskId: string): Promise<void>;
}
```

`isConfigured()` is async — unlike the composer engines, whose keys arrive as build-time
env vars, video credentials are read from SSM at request time (section 6.2).

### 6.1 Registry

`src/services/video/providers/index.ts` mirrors `getEngine()`:

```
getVideoProvider(id?) → explicit id → VIDEO_PROVIDER env → DEFAULT_PROVIDER_ID
```

`DEFAULT_PROVIDER_ID` is `'seedance'`. An unknown id throws. Adding Veo later means one
new adapter file and one `case`.

Two adapters exist at the end of Phase 4:

- **`SeedanceProvider`** (`seedance.ts`) — BytePlus. Written against the API reference the
  project owner supplies (D3).
- **`FakeVideoProvider`** (`fake.ts`) — selected by `VIDEO_PROVIDER=fake`. Returns canned
  task IDs, transitions `pending → running → succeeded` on a timer, and yields a
  placeholder asset. It exercises the full poll loop, the stranded-job sweep, and cost
  accounting with zero BytePlus knowledge, and remains the permanent test double.

### 6.2 Credentials

BytePlus credentials use the **runtime** SSM path already proven by
`src/lib/twitch/tokens.ts`, which reads SecureStrings from the SSR Lambda per request:

```
/amplify/${AWS_APP_ID}/${AWS_BRANCH}/BYTEPLUS_API_KEY
```

read with `SSMClient` + `GetParameterCommand({ WithDecryption: true })`, cached in module
scope for the life of the Lambda container.

Consequences: `amplify.yml` needs no change, the key never enters the build output, and
rotating it requires no redeploy. The Amplify service role needs `ssm:GetParameter` on
that one parameter path — an IAM permission change, not a new AWS resource.

### 6.3 Asset custody

Provider assets are **copied into the TamilAgaval S3 bucket** on success, never
hotlinked. Provider URLs expire, so a stored reference would rot; copying also means
`src/config/csp.ts` needs no new media source, and swapping providers never orphans a
finished clip.

```
visual-story/<vsId>/refs/<charId>/<uuid>.<ext>       character reference images
visual-story/<vsId>/candidates/<candId>.mp4          generated clip
visual-story/<vsId>/candidates/<candId>.jpg          poster frame
```

### 6.4 STILL mode does not use the video provider

`STILL` is a single frame, and TamilAgaval already generates images:
`generateCoverArt()` in `src/services/ai/cover-art.ts` (OpenAI `gpt-image-1`, returns
base64 for S3 upload).

`STILL` shots are served by an `ImageShotService` wrapping that function. `MOTION` and
`HERO` go to the `VideoGenerationProvider`. Both write `CAND#` items of the same shape,
so the review UI and timeline treat them identically.

A `STILL` candidate records `providerId: 'openai-image'` and leaves `providerTaskId`
null — the image call is synchronous and completes inside the request, so it never
creates a `GENJOB#` item or enters the `VSTORY_INFLIGHT` partition. The candidate's
`costUsd` still counts against `spentUsd`, so the budget covers every mode.

This is deliberate: it makes **Phase 3 a complete, useful storyboarding tool with no video
provider wired at all**, and it means the cheapest mode never depends on the most
expensive integration.

## 7. Async generation workflow

### 7.1 Why the existing pattern does not fully apply

Every async precedent in this repo is *push*: a route creates a job, invokes a worker
Lambda with `InvocationType: 'Event'`, the worker completes the whole task within its
timeout (120 s compose, 180 s master), writes terminal state, and the browser polls
DynamoDB.

Seedance does not fit. The provider returns a task ID and the task runs for minutes; the
caller polls *the provider*. A Lambda cannot sit and wait, and Amplify's 30 s ceiling
forbids doing it inline.

### 7.2 Chosen mechanism (D1)

```
POST /api/admin/visual-story/[vsId]/generate
  ├─ requireAdmin + requireBearer
  ├─ rate limit (per admin)
  ├─ estimatedCostUsd = provider.estimateCostUsd(req)      ← local, no network
  ├─ budget check: spentUsd + estimatedCostUsd <= budgetUsdCap  (authoritative)
  ├─ write GENJOB# item, status 'submitted', estimatedCostUsd,
  │                      GSI1PK='VSTORY_INFLIGHT'
  ├─ provider.submit(req) → providerTaskId + the provider's own estimate
  ├─ patch job: providerTaskId, status 'running',
  │             estimatedCostUsd ← submit's value when it differs from the local one
  └─ 202 { jobId }

browser: pollJob(GET /api/admin/visual-story/jobs/[jobId])
  └─ route performs ONE provider.poll(providerTaskId) per request
       ├─ pending/running → patch lastPolledAt, attempts++; return status
       ├─ succeeded → copy assets to S3, write CAND# item,
       │              add costUsd to METADATA.spentUsd (atomic ADD),
       │              REMOVE GSI1PK, status 'succeeded'
       └─ failed    → record error{code,message}, REMOVE GSI1PK, status 'failed'
```

One provider HTTP call per request keeps every route far inside the 30 s ceiling. The
client cadence reuses `pollJob()` from `src/lib/poll-job.ts` with `adminFetch()`, exactly
as `SunoSetupPanel` and `ComposerForm` do.

### 7.3 The known cost of this choice

**If the admin closes the tab mid-generation, nobody is polling and the job strands in
`running`.** This is the accepted trade for adding no AWS resource. It is mitigated, not
ignored:

1. Non-terminal jobs carry `GSI1PK='VSTORY_INFLIGHT'`, so they are always findable in one
   query — never a table scan.
2. **`POST /api/admin/visual-story/reconcile`** sweeps that partition, polls each job's
   provider task once, and advances any that finished. It is exposed as a
   "Reconcile in-flight" button on the list page and runs automatically when that page
   loads. This ships in **Phase 4, alongside generation** — not later.
3. Each job carries `attempts` and `lastPolledAt`. A job exceeding `MAX_POLL_ATTEMPTS`
   (default 240) or not polled for over an hour renders as **stale** in the UI with an
   explicit "check provider" action, rather than appearing to be quietly working.
4. Cancellation calls `provider.cancel()` when the adapter implements it, and marks the
   job `cancelled` regardless, so a stuck job is always clearable.

If stranded jobs prove to be a practical annoyance, the upgrade path is a single
EventBridge Scheduler rule driving the same `reconcile` logic. The reconcile handler is
therefore written as a plain exported function that both the route and a future Lambda
can call.

## 8. API surface

All routes are admin-gated with `requireAdmin()`. Every mutation additionally calls
`requireBearer()` to reject cookie-only auth (CSRF), following
`src/app/api/admin/compose/route.ts`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/visual-story` | List; optional `?contentId=` filter |
| `POST` | `/api/admin/visual-story` | Create from `{ contentId, title, aspectRatio }` |
| `GET` | `/api/admin/visual-story/[vsId]` | Full tree, one Query |
| `PATCH` | `/api/admin/visual-story/[vsId]` | Title, status, `budgetUsdCap` |
| `DELETE` | `/api/admin/visual-story/[vsId]` | Delete story and all child items |
| `POST` | `/api/admin/visual-story/[vsId]/scenes` | Create / update / reorder |
| `POST` | `/api/admin/visual-story/[vsId]/shots` | Create / update / reorder / edit prompt |
| `POST` | `/api/admin/visual-story/[vsId]/characters` | Create; returns presigned POST for refs |
| `POST` | `/api/admin/visual-story/[vsId]/generate` | Enqueue a shot generation → `202 { jobId }` |
| `GET` | `/api/admin/visual-story/jobs/[jobId]` | Status; performs one provider poll |
| `POST` | `/api/admin/visual-story/jobs/[jobId]/cancel` | Cancel an in-flight job |
| `POST` | `/api/admin/visual-story/reconcile` | Sweep `VSTORY_INFLIGHT` |
| `POST` | `/api/admin/visual-story/[vsId]/select` | Set `selectedCandidateId` on a shot |
| `GET` | `/api/admin/visual-story/[vsId]/timeline` | Ordered selected clips + manifest |

`POST /api/admin/visual-story` validates that `contentId` resolves to a real `CONTENT`
record through `ContentRepository.findById()` before writing anything.

Character reference upload reuses the presigned-POST mechanism from
`/api/admin/upload` (`S3Operations.createPresignedPost()`), which enforces a size cap
server-side — a presigned PUT cannot.

## 9. File structure

**New:**

```
src/types/visualStory.ts                             client-safe types + zod schemas
src/infrastructure/database/VisualStoryRepository.ts
src/services/video/providers/types.ts                the port
src/services/video/providers/index.ts                registry
src/services/video/providers/seedance.ts             BytePlus adapter (Phase 4)
src/services/video/providers/fake.ts                 test double (Phase 2)
src/services/video/credentials.ts                    runtime SSM read + cache
src/services/video/image-shot.ts                     STILL via generateCoverArt
src/services/video/cost.ts                           mode cost table, estimate, budget
src/services/video/reconcile.ts                      sweep logic, route + future Lambda
src/lib/visual-story-rate-limit.ts                   per-admin limiter
src/app/api/admin/visual-story/**                    routes from section 8
src/app/(admin)/admin/visual-story/page.tsx          list
src/app/(admin)/admin/visual-story/[vsId]/page.tsx   studio
src/components/admin/visual-story/*.tsx              panels
docs/VISUAL_STORY_STUDIO.md                          operator guide
```

`src/types/visualStory.ts` is **client-safe** — it imports no server SDK — so routes,
repository and React components share one source of truth. This follows
`src/types/story.ts`.

**Modified:**

- `src/app/(admin)/AdminLayoutClient.tsx` — one nav entry and two `PAGE_TITLES` rows.
- `docs/IAM_LEAST_PRIVILEGE.md` and the Amplify service-role policy — `ssm:GetParameter`
  on the new parameter path.

**Explicitly not modified:**

- `src/app/api/stories/route.ts`, `src/types/story.ts` — different entity (section 2).
- `amplify.yml` — runtime SSM means no build-time key fetch.
- `src/config/csp.ts` — assets are copied to our own S3 (section 6.3).

**Not created:** no new DynamoDB table, no new GSI, no new S3 bucket, no new Lambda, no
new npm dependency. Every AWS SDK client required — `client-dynamodb`, `lib-dynamodb`,
`client-s3`, `s3-presigned-post`, `client-ssm` — is already in `package.json`.

## 10. UI

A new entry in `AdminLayoutClient`'s `PAGE_TITLES`, grouped with the creative tools
(Music Director, Lyricist, Suno Prompts).

**`/admin/visual-story`** — table of visual stories with their linked content title,
status, shot count, and spend against cap. "New from content" opens a content picker.
"Reconcile in-flight" is present whenever the `VSTORY_INFLIGHT` query returns rows, and
runs automatically on page load.

**`/admin/visual-story/[vsId]`** — three regions:

- **Left rail** — scenes, reorderable, each showing its shot count.
- **Centre** — shot grid for the selected scene. Each card carries a mode badge, the
  visual prompt, character chips, estimated cost, a Generate button, and a candidate
  strip beneath it with radio-select for the chosen clip.
- **Right inspector** — the selected shot's full prompt editor and negative prompt, or
  the Characters panel (upload a reference, or generate one from a description).
- **Bottom bar** — the timeline: selected clips in order, running duration, running spend
  against `budgetUsdCap`.

State is managed with `adminFetch` + `pollJob`. No new client-state library.

## 11. Cost control

Four layers, each grounded in an existing mechanism.

**1. The mode ladder.** Mode is a per-shot field, so a story's cost profile is visible
before any video is generated.

| Mode | Output | Served by | Intended use |
|---|---|---|---|
| `STILL` | one image | `generateCoverArt` (`gpt-image-1`) | Block out the whole storyboard cheaply |
| `MOTION` | short, low-resolution clip | `VideoGenerationProvider` | Confirm motion and composition |
| `HERO` | full resolution and duration | `VideoGenerationProvider` | A deliberate handful of shots |

The workflow the UI encourages is: storyboard entirely in `STILL`, promote selected shots
to `MOTION`, promote a few to `HERO`.

**2. Estimate before spend.** `estimateCostUsd()` is on the port, so the UI shows both the
shot price and the resulting story total before the confirm click.

`src/services/video/cost.ts` holds a `Record<providerId, Record<ShotMode, RateCard>>`.
The `FakeVideoProvider` ships a zero-cost card. The Seedance card is populated in Phase 4
from the BytePlus rate reference supplied under D3 — the structure is fixed by this
design; only the numbers arrive later.

**3. Server-side budget ceiling.** `budgetUsdCap` and `spentUsd` live on the METADATA
item. The generate route checks `spentUsd + estimatedCostUsd <= budgetUsdCap` before
submitting, so a client that bypasses the confirm dialog is still refused with `402`.
`spentUsd` is incremented with an atomic DynamoDB `ADD` when a job succeeds, using
`actualCostUsd` when the provider reports one and `estimatedCostUsd` otherwise.

`budgetUsdCap` is set when the story is created — the create route accepts it and falls
back to `DEFAULT_BUDGET_USD_CAP`, a constant in `cost.ts`. It is editable afterwards via
`PATCH`. A cap of `0` is legal and blocks all paid generation, which is how a story is
frozen without deleting it.

**4. Per-admin rate limit.** `visualStoryLimiter` mirrors `composeLimiter`
(`src/lib/compose-rate-limit.ts`) — a separate module because Next rejects unknown
exports from a route file. This caps concurrent spend from one account or a stolen
session.

## 12. Security

- Every route: `requireAdmin()`. Every mutation: `requireBearer()`.
- `contentId` validated against a real `CONTENT` record before a story is created.
- `vsId`, `charId`, `candId` and `jobId` validated by regex before being used to build a
  DynamoDB key, following `isStoryId()` in `src/types/story.ts`.
- S3 keys are always derived server-side from validated ids; a client never supplies a key.
- Reference images are delivered to the provider as short-lived signed URLs, never by
  making an object public.
- Provider error strings are mapped to a `VideoErrorCode` and a safe message. Raw upstream
  text is logged, never returned — mirroring the composer's contract.
- The BytePlus key is never written to DynamoDB, never logged, and never reaches the
  client bundle.

## 13. Error handling

The `VideoErrorCode` taxonomy maps 1:1 from provider adapter to job record to API
response, with no translation layer — the same discipline as `EngineErrorCode`.

| Condition | Behaviour |
|---|---|
| No credential | `not_configured`; the Generate button is disabled with an explanatory note. The feature is inert rather than broken. |
| Provider rejects the key | `auth`; job fails, spend not incremented. |
| 429 / quota | `rate_limit`; job fails with a retry affordance. Not auto-retried — retrying costs money. |
| Provider refuses the prompt | `content_policy`; surfaced verbatim next to the prompt editor so it can be rewritten. |
| Asset copy to S3 fails after a successful generation | Job stays `running`, `attempts` increments, the next poll retries the copy. The provider task already succeeded, so the clip is not lost while its URL lives. |
| Poll exceeds `MAX_POLL_ATTEMPTS` or one hour since `lastPolledAt` | Rendered **stale**, with a manual "check provider" action. Never silently `running` forever. |

A failed generation never increments `spentUsd`.

## 14. Testing

Jest, jsdom environment, `npx jest <path>` (this repo uses jest, not vitest). The full
suite is a deploy gate in `amplify.yml`'s preBuild, so anything landing here must pass.

- **Repository** — key construction, zero-padded ordering, sparse-index attribute written
  on create and `REMOVE`d on every terminal transition, atomic `spentUsd` increment.
- **Types** — zod schemas accept valid input and reject each malformed field.
- **Cost** — estimate per mode; budget refusal at the boundary; spend recorded from
  `actualCostUsd` when present and `estimatedCostUsd` when not.
- **Provider port** — `FakeVideoProvider` drives the complete lifecycle: submit → running
  → succeeded → candidate written → `GSI1PK` removed. Also the failure and cancel paths.
- **Routes** — auth rejection (no admin, cookie-only), rate-limit refusal, budget refusal,
  `contentId` validation, `202` shape.
- **Reconcile** — a job left `running` with no poller is advanced by the sweep.

Because `FakeVideoProvider` exercises every path, Phases 2–4 are fully testable before
any BytePlus credential exists.

> Note for whoever adds AWS SDK imports to a test: `jest.config.ts` sets
> `testEnvironment: 'jsdom'` globally, which makes jest resolve the `browser` export
> condition. `moduleNameMapper` entries already redirect the affected `@aws-sdk/core` and
> `@smithy/core` subpaths to their Node builds. If a future SDK bump breaks tests, extend
> that mapper — do not reach for transforms.

## 15. Phases

| Phase | Deliverable | Depends on |
|---|---|---|
| 1 | Architecture review and this design | — |
| 2 | `visualStory.ts` types and zod, `VisualStoryRepository`, `cost.ts`, provider port, `FakeVideoProvider`. Unit tests. No UI. | — |
| 3 | Studio CRUD: stories, scenes, shots, characters, prompt editing, reference upload, `STILL` mode via `generateCoverArt`. Nav entry. | 2 |
| 4 | `SeedanceProvider`, credentials, `MOTION` mode, generate/poll/cancel routes, reconcile sweep, budget enforcement end to end. | 3, and the BytePlus API reference (D3) |
| 5 | Candidate review UI, selection, `HERO` mode, spend reconciliation. | 4 |
| 6 | Timeline export: ordered selected clips plus manifest. | 5 |

Phase 3 deliberately lands a complete, useful storyboarding tool before any money is spent
on video generation.

## 16. Out of scope

- Rendering or stitching a finished video. Phase 6 exports an ordered manifest of selected
  clips; assembly happens elsewhere.
- Publishing anything to YouTube or to the public site.
- Audio, music synchronisation, or caption alignment.
- Any change to how `/content/<id>` or `/stories` pages render.
- Fixing the `GSI6` defect in `ContentRepository.getMostViewed()` (section 5.1).
- Multi-user collaboration or locking. The admin is a single operator.

## 17. Dependency to resolve before Phase 4

Per D3, the project owner supplies the BytePlus / Seedance 2.5 API reference. Four facts
are needed, and nothing else blocks:

1. The submit endpoint — request schema, how reference images are attached, how duration
   and aspect ratio are expressed.
2. The status/poll endpoint — request and response schema.
3. Task-ID semantics — lifetime, and whether a completed task's asset URLs expire.
4. Billing units — what is charged per generation, so the Seedance rate card in
   `cost.ts` can be populated.

Phases 2 and 3 require none of this.
