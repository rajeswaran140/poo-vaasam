# Visual Story Studio — Design

- **Date:** 2026-09-11, **revised 2026-11-04**
- **Status:** Revision awaiting approval. The 2026-09-11 design was approved; this revision
  changes the provider and widens the scope (see "Revision 2026-11-04" below).
- **Scope:** A provider-neutral AI music-video workflow inside the existing TamilAgaval admin,
  from a mastered song to a finished, uploadable video.

## Revision 2026-11-04 — what changed and why

The project owner asked for an AI video studio that turns an original TamilAgaval song into
a 60–120 s cinematic music video, with full control over every paid generation. That is this
design with three changes, all requested on 2026-11-04:

1. **xAI Grok Imagine replaces BytePlus Seedance as the first video provider.** The BytePlus
   reference (old D3) never arrived; xAI's public docs answer all four questions it was
   waiting for (§17). The provider port is unchanged, so this is an adapter swap.
2. **The scope now ends in a finished video.** The 2026-09-11 design stopped at an ordered
   list of selected clips and put audio, music sync and stitching out of scope. Those are now
   in: the studio lays the selected clips over the song and renders one MP4 (§7.4, Phase 6).
3. **A language model drafts the storyboard** from the song's lyrics (§6.5). The owner asked
   to "also use the Transformer LLM Architecture"; this design reads that as an LLM drafting
   scenes, shots and visual prompts, using the Claude path the Lyricist already uses.
   *(Confirmed by the owner 2026-11-04.)*

The owner's condition for spending on generation is that **each video comes out unique**.
That is the success criterion this revision designs for (§1.1).

Decisions marked **(builder's call)** were made by the designer, not the owner, and are open
to override. The Phases 2–3 plan of 2026-09-12 predates this revision and is superseded; a
new plan follows approval.

---

## 1. Purpose

Turn a published TamilAgaval piece — a song or a musical story — into a sequence of
AI-generated video clips, through an admin workflow that keeps the expensive step
deliberate and reversible:

```
Saved master → Visual Story → Scenes → Shots → Character Refs
        → Visual Prompts → AI Generation → Candidates → Selected Clips → Timeline
```

The pipeline now runs one step further, to a finished video:

```
… → Selected Clips → Timeline (clips placed on the song) → Rendered music video (MP4)
```

xAI Grok Imagine is the first video provider. The application is **not** coupled
to it: generation sits behind a `VideoGenerationProvider` port so Veo, Seedance or any other
provider is a new adapter file plus one `case` in a registry.

### 1.1 Goals, non-goals, anti-goals

**Goal.** From one saved master, produce a music video of 30–120 s (60–120 s typical) in 9:16 or 16:9 whose every
shot was generated for that song, with every paid call approved before it runs and every
attempt's cost recorded.

**"Unique"** (the owner's word; confirmed 2026-11-04 as "every song its own world"): each story's
characters, references and prompts belong to that story. Nothing is shared or reused across
stories by default, no stock footage, and the storyboard is drafted from that song's own
lyrics.

**Non-goals now:** user accounts, multi-tenant SaaS, subscriptions, credit billing (the
provider port and per-story budgets keep that path open, nothing more); a second provider;
automatic beat detection; lip sync; publishing to YouTube from the studio.

**Anti-goals:** a generation that spends money without an explicit click; spend that is not
recorded; a finished video whose audio differs from the master.

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

**Decision (revised by D4, 2026-11-04):** a Visual Story anchors to a saved master
(`masterJobId`), with an optional `contentId` — never to a `STORY#` row. `src/app/api/stories/route.ts` and
`src/types/story.ts` are not modified by this work.

What *is* reused from `/api/stories` is its route shape: a client-safe types module in
`src/types/` carrying the zod schemas, `DynamoDBOperations` for persistence, and the
validation/rate-limit conventions.

## 3. Constraints

**Product constraints (set by the project owner):**

1. Reuse the existing architecture; follow existing patterns rather than introducing new ones.
2. Use the existing DynamoDB single table `TamilWebContent`. No second datastore.
3. Use the existing S3 infrastructure for references and generated video.
4. Provider credentials (`XAI_API_KEY`) go through the existing SSM SecureString mechanism.
5. Video generation must be asynchronous.
6. Track generation status, provider task ID, cost, candidates, selected clip, and errors.
7. Support `STILL`, `MOTION`, and `HERO` modes to control cost.
8. No unnecessary dependencies and no unnecessary AWS resources.
9. The public repo carries no song titles and no musical-arrangement detail — specs, tests and
   fixtures use neutral placeholders.
10. Changing `master-worker` is a **manual worker deploy** that needs the owner's explicit yes
    (Phase 6 only).

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
| D3 | Provider API schema | **Superseded 2026-11-04.** Grok Imagine's public docs supply the schema (§17). `FakeVideoProvider` still unblocks Phases 2–4 | Waiting on the BytePlus reference (never arrived) |
| D4 | Parent entity (revises D2) | **Anchor to a saved master (`masterJobId`)**; `contentId` optional. *(Builder's call.)* Videos are made before a song is published, and the release pipeline already renders from a master | Content-only anchor (the song usually has no `CONTENT` record until it premieres) |
| D5 | Assembly | **A new `assemble` action in `master-worker`**, reusing its ffmpeg layer, concat join and audio verify. *(Builder's call.)* | A new Lambda (constraint 8); in-browser assembly (quality, length) |
| D6 | Aspect | **One aspect ratio per story**, fixed at creation, 9:16 or 16:9. A second format is a second story. *(Builder's call.)* | Generating both per shot (double cost); cropping 16:9 to 9:16 (loses most of the frame) |
| D7 | STILL provider | **Grok `grok-imagine-image`** ($0.02/image), so one key serves the studio and 9:16 stills work. *(Confirmed by the owner 2026-11-04.)* | `gpt-image-1` via `generateCoverArt` (stays as the fallback adapter) |
| D8 | Storyboard draft | **Claude (Sonnet) drafts scenes, shots and prompts from lyrics** the admin pastes or the song stores; nothing is generated until the admin edits and approves. *(Confirmed by the owner 2026-11-04.)* | No drafting; a model per shot at generate time |

## 5. Data model

One DynamoDB partition holds an entire visual story, so loading the studio is a single
`Query` against the base table with no index.

```
PK = VSTORY#<vsId>

  SK = METADATA
       masterJobId, audioKey, contentId?, title, status, aspectRatio, providerId,
       windowStartSec, windowEndSec,            the part of the song the video covers
       budgetUsdCap, spentUsd, reservedUsd, createdAt, updatedAt
       GSI1PK = 'VSTORY'
       GSI1SK = '<masterJobId>#<createdAt>#<vsId>'

  SK = CHAR#<charId>
       name, description, refImageKeys[], createdAt

  SK = SCENE#<nnn>
       order, heading, summary, tamilText

  SK = SHOT#<nnn>#<mmm>
       sceneOrder, shotOrder, mode, durationSec, startSec,
       visualPrompt, negativePrompt, charIds[], firstFrameCandidateId?,
       selectedCandidateId

  SK = CAND#<nnn>#<mmm>#<candId>
       jobId, providerId, providerTaskId, s3Key, posterKey,
       costUsd, createdAt

  SK = GENJOB#<jobId>
       jobId, sceneOrder, shotOrder, status, providerId, providerTaskId,
       reservedUsd, candId, attempts, copyFailures, lastPolledAt,
       code, error, createdAt, updatedAt
       GSI1PK = 'VSTORY_INFLIGHT'        (present ONLY while non-terminal)
       GSI1SK = '<createdAt>#<vsId>#<jobId>'

  SK = VIDLOCK#<nnn>#<mmm>                one-video-per-shot lock (V5)
       jobId, createdAt                   taken by conditional put (absent OR older than 1 h)
                                          before any reserve; released at every terminal
                                          transition (jobId-guarded delete). A separate row
                                          so shot edits cannot wipe it.

  SK = DRAFT#<draftId>                    one LLM storyboard draft (§6.5)
       lyricsHash, model, inputTokens, outputTokens, costUsd, scenes[], createdAt

  SK = RENDER#<renderId>                  one assembly of the timeline (§7.4)
       status, aspectRatio, windowStartSec, windowEndSec, clipKeys[],
       outputKey, seconds, audioCheck, error, createdAt, updatedAt
```

`startSec` places a shot on the song's timeline, relative to `windowStartSec`. The shots
of a story tile the window: each shot starts where the previous one ends, and the last ends
at `windowEndSec`. The studio derives `startSec` from shot order and `durationSec`, and
refuses a render whose shots do not tile the window.

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
| Find stories of one master | `Query GSI1PK='VSTORY'`, `GSI1SK begins_with '<masterJobId>#'` | GSI1 (sparse) |
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
type RenderStatus     = 'queued' | 'rendering' | 'done' | 'failed';
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
  aspectRatio: '16:9' | '9:16';
  referenceImageUrls?: string[];   // short-lived signed S3 URLs
  firstFrameUrl?: string;          // a STILL candidate pinned as the opening frame
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

`DEFAULT_PROVIDER_ID` is `'grok'`. An unknown id throws. Adding Veo or Seedance later means
one new adapter file and one `case`.

Two adapters exist at the end of Phase 4:

- **`GrokProvider`** (`grok.ts`) — xAI Grok Imagine, written against the facts in §17.
- **`FakeVideoProvider`** (`fake.ts`) — selected by `VIDEO_PROVIDER=fake`. Returns canned
  task IDs, transitions `pending → running → succeeded` on a timer, and yields a
  placeholder asset. It exercises the full poll loop, the stranded-job sweep, and cost
  accounting with no provider account, and remains the permanent test double.

### 6.2 Credentials

The xAI key uses the **runtime** SSM path already proven by
`src/lib/twitch/tokens.ts`, which reads SecureStrings from the SSR Lambda per request:

```
/amplify/${AWS_APP_ID}/${AWS_BRANCH}/XAI_API_KEY
```

The owner creates the key in the xAI console and stores it there; the key never passes
through chat or the repo.

read with `SSMClient` + `GetParameterCommand({ WithDecryption: true })`, cached in module
scope for the life of the Lambda container.

Consequences: `amplify.yml` needs no change, the key never enters the build output, and
rotating it requires no redeploy. The Amplify service role needs `ssm:GetParameter` on
that one parameter path — an IAM permission change, not a new AWS resource.

### 6.2.1 How `GrokProvider` maps the port

| Port | Grok Imagine |
|---|---|
| `submit` | `POST https://api.x.ai/v1/videos/generations` → `{ request_id }` = `providerTaskId` |
| `poll` | `GET https://api.x.ai/v1/videos/{request_id}` |
| `pending` | `status: "pending"` |
| `succeeded` | `status: "done"` **and** `video.respect_moderation !== false`; asset = `video.url` |
| `failed` / `content_policy` | `status: "done"` with `respect_moderation: false` — **assume it was billed** and add the estimate to `spentUsd` |
| `failed` | `status: "failed"` (`error.code` → `invalid_argument` ⇒ `content_policy` when the message says moderation, else `bad_response`; `permission_denied` ⇒ `auth`; `failed_precondition` ⇒ `bad_response`; `service_unavailable`/`internal_error` ⇒ `upstream`) |
| `failed` (`upstream`) | `status: "expired"` — handle it although only one docs page lists it |
| HTTP 401/403 · 429 | `auth` · `rate_limit` (returned synchronously, before a job exists) |

Request body, always:

- `model`: `grok-imagine-video-1.5` (HERO) or `grok-imagine-video-1.5-lite` (MOTION).
- `prompt`, `duration` (integer 1–15 s), `aspect_ratio` (`9:16` | `16:9`).
- **`generate_audio: false`.** The song is the audio; Grok's default soundtrack is never wanted.
- `resolution`: `1080p` for HERO without references, **`720p` when `reference_images` is
  present** (reference-to-video caps at 720p), `480p` for MOTION.
- `reference_images`: the shot's characters' reference images as short-lived signed S3 URLs
  (max 14), referred to in the prompt as `<IMAGE_0>…`. Per xAI's guidance: one role per
  image, a small cast, static props.
- `image` (first frame): a selected STILL candidate when the shot pins one. Image-to-video
  **ignores `aspect_ratio` and follows the image**, so STILL candidates are always
  generated in the story's aspect.

The poll response carries **no cost field**, so `actualCostUsd` is always null for Grok and
spend equals the estimate. Phase 4 ends with a check of the xAI console's usage against
`spentUsd` for the first clips (§17).

### 6.2.2 Owner steps before Phase 3

1. Create an xAI API key in the xAI console and store it as the SecureString
   `/amplify/d3rkmepk4popv0/master/XAI_API_KEY` (the owner does this; the key never passes
   through chat).
2. Grant the Amplify service role `ssm:GetParameter` on that one parameter. The builder
   prepares the policy change and shows it; it is applied only with the owner's yes.

Phase 3's STILL and draft features stay inert (`not_configured`) until both are done; the
rest of Phase 3 does not wait on them.

### 6.3 Asset custody

Provider assets are **copied into the TamilAgaval S3 bucket** on success, never
hotlinked. Grok returns "temporary URLs" with no stated lifetime, so the copy happens on the
first poll that sees `done`. The copy streams the download into a multipart S3 upload; a
15 s 1080p clip is tens of MB, well inside the route's 30 s, and a failed copy leaves the
job `running` so the next poll retries it (§13). Provider URLs expire, so a stored reference would rot; copying also means
`src/config/csp.ts` needs no new media source, and swapping providers never orphans a
finished clip.

**Bucket and prefix (builder's call):** everything lives in the mastering bucket
(`TAKES_BUCKET`, `tamil-web-media`) under `audio/mastering/visual-story/`. That prefix is
private — CloudFront denies `audio/mastering/*` — so an unreleased video is never public, and
it is the bucket `master-worker` already reads and writes, so Phase 6 needs no new worker
grant. Uploads presign into it the way `/api/admin/mastering/upload` already does, not
through `/api/admin/upload` (which targets public-read prefixes). Playback in the admin uses
the existing signed `mastering/download?mode=play` path.

```
audio/mastering/visual-story/<vsId>/refs/<charId>/<uuid>.<ext>    character reference images
audio/mastering/visual-story/<vsId>/candidates/<candId>.mp4       generated clip
audio/mastering/visual-story/<vsId>/candidates/<candId>.jpg       poster frame / STILL
audio/mastering/visual-story/<vsId>/renders/<renderId>.mp4        assembled video
```

### 6.4 STILL mode does not use the video provider

`STILL` is a single frame. It is served by an `ImageShotService` behind a small
`ImageProvider` seam with two adapters:

- **`grok-image`** — `grok-imagine-image` at $0.02 per image, the default *(D7, confirmed
  by the owner)*, so the studio needs one provider key.
- **`openai-image`** — the existing `generateCoverArt()` (`gpt-image-1`), kept as the
  fallback. It is hard-coded to landscape `1536x1024` (`src/services/ai/cover-art.ts`), so as
  it stands it cannot serve 9:16 stories; using it for them needs a size parameter added.

`MOTION` and `HERO` go to the `VideoGenerationProvider`. Both write `CAND#` items of the
same shape, so the review UI and timeline treat them identically. A STILL is always
generated at the story's aspect, so it can later be pinned as a video shot's first frame.

A `STILL` candidate leaves `providerTaskId` null — the image call is synchronous and
completes inside the request, so it never creates a `GENJOB#` item or enters the
`VSTORY_INFLIGHT` partition. The candidate's `costUsd` still counts against `spentUsd`, so
the budget covers every mode.

This is deliberate: it makes **Phase 3 a complete, useful storyboarding tool with no video
provider wired at all**, and it means the cheapest mode never depends on the most
expensive integration.

### 6.5 Storyboard draft (LLM)

`POST /api/admin/visual-story/[vsId]/draft` sends the lyrics, the window length and the
story's aspect to Claude Sonnet through the same inline, tool-forced pattern as
`src/services/ai/lyricist.ts` (one call, ~10–25 s, inside the 30 s ceiling). The model
returns structured scenes → shots, each shot with a duration (1–15 s), a mode suggestion
(STILL by default), a visual prompt and the characters it needs; durations sum to the window.

- **Lyrics source:** the admin pastes them. Most songs have no stored lyrics, so stored
  lyrics are a convenience, not a requirement.
- **Nothing is generated from a draft.** "Apply draft" writes editable `SCENE#`/`SHOT#`/
  `CHAR#` items; the admin edits them; every paid generation is still its own click.
- **Uniqueness:** the system prompt asks for imagery specific to the lyrics' places,
  seasons and people, forbids stock clichés and text in frame, and keeps the existing
  apolitical rule. Characters are created per story, never pulled from another.
- The draft records its token usage and cost and counts against `spentUsd`.
- The error taxonomy is the Lyricist's, including the `billing` code from #399.

## 7. Async generation workflow

### 7.1 Why the existing pattern does not fully apply

Every async precedent in this repo is *push*: a route creates a job, invokes a worker
Lambda with `InvocationType: 'Event'`, the worker completes the whole task within its
timeout (120 s compose, 180 s master), writes terminal state, and the browser polls
DynamoDB.

A video provider does not fit. Grok Imagine returns a request ID and the task runs for minutes; the
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
   "Reconcile in-flight" button on the list page. It is **button-only** (owner's decision,
   2026-09-12): it never runs on page load. That decision's exit condition was "polling turns
   out to be unbilled"; xAI bills per second of output, not per status call, so the
   condition is met — but the rule stays button-only until the owner changes it. This ships
   in **Phase 4, alongside generation** — not later.
3. Each job carries `attempts` and `lastPolledAt`. A job exceeding `MAX_POLL_ATTEMPTS`
   (default 240) or not polled for over an hour renders as **stale** in the UI with an
   explicit "check provider" action, rather than appearing to be quietly working.
4. Cancellation calls `provider.cancel()` when the adapter implements it, and marks the
   job `cancelled` regardless, so a stuck job is always clearable.

If stranded jobs prove to be a practical annoyance, the upgrade path is a single
EventBridge Scheduler rule driving the same `reconcile` logic. The reconcile handler is
therefore written as a plain exported function that both the route and a future Lambda
can call.

### 7.4 Assembly (Phase 6)

`POST /api/admin/visual-story/[vsId]/render` checks that every shot has a selected
candidate and that the shots tile the window, writes a `RENDER#` item (`queued`), and
Event-invokes `master-worker` with `{ assemble: { vsId, renderId } }` — dispatched on its own
event key the way `event.render` and `event.short` already are. The worker:

1. Downloads the selected clips in timeline order and the master audio (`audioKey`).
2. Normalises each clip to the story's frame size and frame rate and trims it to its shot's
   `durationSec` (Grok clips are whole seconds; a STILL becomes a held frame, as the
   slideshow already does).
3. Joins them with the concat demuxer beside the audio. The audio-window cut and the fades
   are **new steps** (modelled on the Short's window and fades); the concat join follows
   `buildJoinArgs`, without `-shortest`.
4. Verifies the result with `verifyRenderedClip` (duration and audio against the master's
   window), uploads
   `audio/mastering/visual-story/<vsId>/renders/<renderId>.mp4`, and patches the `RENDER#` item.

The browser polls the `RENDER#` item with `pollJob()`. A 120 s render is well inside the
worker's 900 s and 3 GB. **This changes `master-worker`, so it ships only with a manual
worker deploy that the owner approves (constraint 10).**

## 8. API surface

All routes are admin-gated with `requireAdmin()`. Every mutation additionally calls
`requireBearer()` to reject cookie-only auth (CSRF), following
`src/app/api/admin/compose/route.ts`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/visual-story` | List; optional `?masterJobId=` filter |
| `POST` | `/api/admin/visual-story` | Create from `{ masterJobId, title, aspectRatio, windowStartSec, windowEndSec, contentId? }` |
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
| `POST` | `/api/admin/visual-story/[vsId]/draft` | LLM storyboard draft from pasted lyrics (§6.5) |
| `POST` | `/api/admin/visual-story/[vsId]/draft/[draftId]/apply` | Write the draft as editable scenes/shots/characters |
| `POST` | `/api/admin/visual-story/[vsId]/render` | Queue an assembly → `202 { renderId }` (§7.4) |
| `GET` | `/api/admin/visual-story/[vsId]/render/[renderId]` | Render status + download link |

`POST /api/admin/visual-story` validates that `masterJobId` resolves to a **saved** master
with a master audio key, that the window lies inside the master's duration and is 30–120 s
long, and — when given — that `contentId` resolves through `ContentRepository.findById()`,
before writing anything.

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
src/services/video/providers/grok.ts                 xAI Grok Imagine adapter (Phase 4)
src/services/video/image-providers.ts                STILL seam: grok-image, openai-image
src/services/ai/storyboarder.ts                      LLM storyboard draft (Phase 3)
src/lib/visual-story-assemble.ts                     pure ffmpeg arg builders for assembly
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
- `worker/master-worker.ts` — the `assemble` action (Phase 6, manual deploy).

**Explicitly not modified:**

- `src/app/api/stories/route.ts`, `src/types/story.ts` — different entity (section 2).
- `amplify.yml` — runtime SSM means no build-time key fetch.
- `src/config/csp.ts` — assets are copied to our own S3 (section 6.3).

**Not created:** no new DynamoDB table, no new GSI, no new S3 bucket, no new Lambda, no
new npm dependency (Grok is called with `fetch`, as the composer engines call their APIs). Every AWS SDK client required — `client-dynamodb`, `lib-dynamodb`,
`client-s3`, `s3-presigned-post`, `client-ssm` — is already in `package.json`.

## 10. UI

A new entry in `AdminLayoutClient`'s `PAGE_TITLES`, grouped with the creative tools
(Music Director, Lyricist, Suno Prompts).

**`/admin/visual-story`** — table of visual stories with their master's name, aspect,
status, shot count, and spend against cap. "Reconcile in-flight" is present whenever the
`VSTORY_INFLIGHT` query returns rows; it runs only when clicked.

**`/admin/visual-story/[vsId]`** — three regions:

- **Left rail** — scenes, reorderable, each showing its shot count.
- **Centre** — shot grid for the selected scene. Each card carries a mode badge, the
  visual prompt, character chips, estimated cost, a Generate button, and a candidate
  strip beneath it with radio-select for the chosen clip.
- **Right inspector** — the selected shot's full prompt editor and negative prompt, or
  the Characters panel (upload a reference, or generate one from a description).
- **Bottom bar** — the timeline: selected clips in order, running duration, running spend
  against `budgetUsdCap`.

- **Draft panel** (Phase 3) — paste lyrics, "Draft storyboard", review the proposed scenes
  and shots with their total length against the window, then "Apply".
- **Render panel** (Phase 6) — "Render video" once every shot has a selection; progress;
  the finished MP4 with a download link and the audio check's verdict.

New stories start from a **saved master** ("New from master" opens the saved-masters list)
and a window picker shaped like the Shorts window picker (start + length, 30–120 s).

Errors render next to the control that caused them, never only in a page banner.

State is managed with `adminFetch` + `pollJob`. No new client-state library.

## 11. Cost control

Four layers, each grounded in an existing mechanism.

**1. The mode ladder.** Mode is a per-shot field, so a story's cost profile is visible
before any video is generated.

| Mode | Output | Served by | Intended use |
|---|---|---|---|
| `STILL` | one image | `grok-imagine-image` ($0.02) | Block out the whole storyboard cheaply |
| `MOTION` | 480p clip | `grok-imagine-video-1.5-lite` ($0.02/s) | Confirm motion and composition |
| `HERO` | 1080p (720p with references) | `grok-imagine-video-1.5` ($0.08/s) | Every shot in the finished video |

The workflow the UI encourages is: storyboard entirely in `STILL`, promote selected shots
to `MOTION`, promote a few to `HERO`.

**Owner's model choice (2026-11-05).** The owner chose `grok-imagine-video-1.5` ("best") for
every clip. The UI therefore offers no `MOTION`/lite option: every video clip is generated as
`HERO` at $0.080/s. The `MOTION` row and its rate card remain in the contract, but nothing in
the UI or the generate route selects them.

**2. Estimate before spend.** `estimateCostUsd()` is on the port, so the UI shows both the
shot price and the resulting story total before the confirm click.

`src/services/video/cost.ts` holds a `Record<providerId, Record<ShotMode, RateCard>>`.
The `FakeVideoProvider` ships a zero-cost card. The Grok card is xAI's published table
(2026-11-04): image $0.02 each; `grok-imagine-video-1.5-lite` $0.020/s;
`grok-imagine-video-1.5` $0.080/s. Third-party sites claim higher rates at 720p/1080p, so the
card carries a `verifiedAt` note and Phase 4 compares the xAI console's charges for the first
clips against `spentUsd` before the card is trusted.

**What a video costs at those rates.** A 120 s video is 120 s of HERO output = **$9.60 if
every shot is kept first time**. With a STILL pass over the storyboard (~15 images, $0.30),
MOTION checks on a few shots, and two or three HERO attempts per shot, a realistic total is
**$25–35**. `DEFAULT_BUDGET_USD_CAP` becomes **$40**, editable per story.

**3. Server-side budget ceiling — a hard cap (builder's call).** `budgetUsdCap`,
`spentUsd` and `reservedUsd` live on the METADATA item. Before submitting, the generate route
**reserves** the estimate with one conditional update — `ADD reservedUsd :est` on condition
`spentUsd + reservedUsd + :est <= budgetUsdCap` — so concurrent generations cannot together
pass the cap, and a client that bypasses the confirm dialog is refused with `402`. When the
job ends, one update settles it: `reservedUsd` drops by the estimate and, **if the provider
billed the call**, `spentUsd` rises by `actualCostUsd ?? estimatedCostUsd`. Billed means
`succeeded`, or `done` but rejected by moderation (§6.2.1). A call that failed before any
output (`failed`, `expired`, `cancelled`, a synchronous 4xx) releases the reservation only.
STILL images and storyboard drafts are synchronous; they reserve and settle inside the one
request.

**Video-clip money rules as built (2026-11-05).** A **cancelled** clip is always counted as
billed (V6): cancel can race Grok accepting the submit, so the studio over-records rather than
under-records. A job still unfinished **1 hour** after it was created is ended and counted as
billed (V4/V4b), even without a provider task id, so a broken poll cannot spin forever. A
finished clip whose copy into our bucket keeps failing is counted (and ended) after **10**
tries. Only a synchronous submit failure, `failed` and `expired` are unbilled.

**Known residual race (V8).** A structural edit (reorder, delete) and a Make-video press landing
within a fraction of a second of each other can still put a clip on a moved or missing shot.
Money is unaffected: the reservation and settle are independent of the shot row.

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
- The xAI key is never written to DynamoDB, never logged, and never reaches the
  client bundle.
- Pasted lyrics are sent only to the storyboard model and stored only as a hash on the draft.

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

A generation that the provider did not bill never increments `spentUsd`; a moderated
`done` result is billed and does (§11).

## 14. Testing

Jest, jsdom environment, `npx jest <path>` (this repo uses jest, not vitest). The full
suite is a deploy gate in `amplify.yml`'s preBuild, so anything landing here must pass.

- **Repository** — key construction, zero-padded ordering, sparse-index attribute written
  on create and `REMOVE`d on every terminal transition, atomic `spentUsd` increment.
- **Types** — zod schemas accept valid input and reject each malformed field.
- **Cost** — estimate per mode; budget refusal at the boundary; two concurrent reservations
  that together exceed the cap — the second is refused; settle on success, on moderated
  `done` (billed), and on failure (released only); spend recorded from `actualCostUsd` when
  present and `estimatedCostUsd` when not.
- **Provider port** — `FakeVideoProvider` drives the complete lifecycle: submit → running
  → succeeded → candidate written → `GSI1PK` removed. Also the failure and cancel paths.
- **Routes** — auth rejection (no admin, cookie-only), rate-limit refusal, budget refusal,
  `contentId` validation, `202` shape.
- **Reconcile** — a job left `running` with no poller is advanced by the sweep.
- **Grok adapter** — request body (`generate_audio: false`, resolution rule with and without
  references, model per mode), every status mapping in §6.2.1 including `expired` and
  `respect_moderation: false`, and no raw upstream text in errors. `fetch` is mocked; no test
  calls xAI.
- **Storyboarder** — tool-forced output parsed and validated; durations tile the window;
  the error taxonomy matches the Lyricist's.
- **Assembly** — pure arg builders: clip order, trim to `durationSec`, audio window, fades,
  no `-shortest`; refusal when shots do not tile the window.

Because `FakeVideoProvider` exercises every path, Phases 2–4 are fully testable before
any xAI credential exists.

> **This is a Phase 2 task, not a future risk.** `jest.config.ts` sets
> `testEnvironment: 'jsdom'` globally, so jest resolves the `browser` export condition for
> any package publishing one. `moduleNameMapper` currently enumerates exactly six
> subpaths across `@aws-sdk/core` and `@smithy/core`, anchored, with no wildcards.
> `@aws-sdk/client-ssm` — pulled in by `credentials.ts` — is a **new import surface for
> this test suite**. If it or a transitive `@smithy` dependency resolves a
> `browser`-conditioned subpath that the mapper does not list, the first route test fails
> in a way that looks like application code and is not. Because the suite is a deploy
> gate, that would block every deploy of the repository, not only this feature.
>
> So: before writing route tests, import `client-ssm` in a throwaway test and confirm it
> resolves. Extend the mapper by enumerating any new subpath — do not reach for
> transforms, and do not add a wildcard. Transforming the SDK does not work here: the
> `@smithy/core` browser builds are valid CJS that parse fine and then fail at runtime
> with `loadConfig is not a function`, so compiling them only moves the failure.

## 15. Phases

| Phase | Deliverable | Depends on |
|---|---|---|
| 1 | Architecture review and this design (revised 2026-11-04) | — |
| 2 | `visualStory.ts` types and zod, `VisualStoryRepository`, `cost.ts` (Grok card), provider port, `FakeVideoProvider`. Unit tests. No UI. **First task: confirm `@aws-sdk/client-ssm` resolves under jsdom (see section 14) and extend `moduleNameMapper` if not.** | — |
| 3 | Studio CRUD from a saved master + window: stories, scenes, shots, characters, reference upload, **LLM storyboard draft**, `STILL` mode via `grok-imagine-image`. Nav entry. | 2, and `XAI_API_KEY` in SSM for STILL |
| 4 | `GrokProvider`, runtime credentials, `MOTION` mode, generate/poll/cancel routes, reconcile button, budget enforcement end to end. **Exit check:** xAI console charges for the first clips match `spentUsd`. | 3 |
| 5 | Candidate review UI, selection, first-frame pinning, `HERO` mode, spend reconciliation. | 4 |
| 6 | Timeline + **assembly**: clips placed on the song, `assemble` action in `master-worker`, render panel, finished MP4. **Manual worker deploy with the owner's yes.** | 5 |

Phase 3 deliberately lands a complete, useful storyboarding tool before any money is spent
on video generation.

## 16. Out of scope

- Uploading the finished video to YouTube from the studio. The MP4 is downloadable; the
  existing release pipeline and YouTube Studio handle publishing.
- User accounts, multi-tenant SaaS, subscriptions and credit billing (§1.1).
- A second video provider. The port keeps it to one adapter file.
- Automatic beat detection and lip sync. Shot boundaries are set by the admin (or the draft).
- Any change to how `/content/<id>` or `/stories` pages render.
- Fixing the `GSI6` defect in `ContentRepository.getMostViewed()` (section 5.1).
- Multi-user collaboration or locking. The admin is a single operator.

## 17. Provider facts (Grok Imagine, read 2026-11-04)

The four facts the old D3 waited for, from xAI's public docs:

1. **Submit** — `POST /v1/videos/generations` with `model`, `prompt`, `duration` (1–15 s),
   `aspect_ratio` (incl. `9:16`, `16:9`), `resolution` (`480p` | `720p` | `1080p`),
   `generate_audio`, and optionally `image` (first frame), `last_frame`, `keyframes` (≤4),
   `reference_images` (≤14 on 1.5; URL, data URI or file id). Returns `{ request_id }`.
2. **Status** — `GET /v1/videos/{request_id}` → `status` `pending` | `done` | `failed`
   (`expired` also documented); on `done`: `video.url`, `video.duration`,
   `video.respect_moderation`; on `failed`: `error.code`, `error.message`.
3. **Task and asset lifetime** — videos are "temporary URLs" with no stated lifetime;
   copy on first `done` (§6.3).
4. **Billing** — per second of output: `grok-imagine-video-1.5` $0.080/s,
   `grok-imagine-video-1.5-lite` $0.020/s, `grok-imagine-video` $0.050/s; images
   $0.02 (`grok-imagine-image`) / $0.04 (`2.0`). No cost in the poll response.

**Still to verify in Phase 4:** whether resolution changes the per-second price (the
official table is flat, third parties say it is not), request rate limits (undocumented;
429s come back synchronously), and the asset URL lifetime in practice.

Sources: docs.x.ai — Imagine overview, Video generation, Reference-to-video, Pricing.
