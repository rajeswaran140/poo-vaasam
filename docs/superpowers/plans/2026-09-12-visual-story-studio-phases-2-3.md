# Visual Story Studio — Phases 2–3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete storyboarding tool for TamilAgaval — visual stories, scenes, shots, character references, visual prompts, and STILL-mode image generation — with no video provider wired and no money spent on video.

**Architecture:** One DynamoDB partition per visual story (`PK=VSTORY#<vsId>`) so the studio loads in a single Query with no index. Sparse GSI1 partitions serve list-all and find-stranded-jobs. Generation sits behind a `VideoGenerationProvider` port modelled on the existing `ComposerEngine` seam; a `FakeVideoProvider` satisfies it so everything is testable with no credential. STILL mode bypasses the port entirely and reuses `generateCoverArt`.

**Tech Stack:** Next.js 15.5 App Router, TypeScript 5.9, zod, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-s3`, Cognito via `aws-jwt-verify`, Jest (jsdom).

**Spec:** `docs/superpowers/specs/2026-09-11-visual-story-studio-design.md`

## Global Constraints

- **No new AWS resources.** No new table, no new GSI, no new bucket, no new Lambda. Verified: the access patterns in §5.1 of the spec need none.
- **No new npm dependencies.** Every SDK client required is already in `package.json`.
- **Do not modify** `src/app/api/stories/route.ts` or `src/types/story.ts` — different entity (spec §2).
- **Table:** `TamilWebContent`, `ca-central-1`, accessed only through `DynamoDBOperations`. Never a raw scan.
- **Every API route** calls `requireAdmin(request)`. Every mutation additionally calls `requireBearer(request)`.
- **Test runner is jest, not vitest.** `NODE_ENV=test npx jest <path>`. Full suite is the `amplify.yml` deploy gate — it must stay green.
- **`npm install` needs `--legacy-peer-deps`** (React 19 vs a React 16 peer).
- Status vocabularies, verbatim from spec §5.2:
  - `VisualStoryStatus = 'DRAFT' | 'STORYBOARDING' | 'GENERATING' | 'REVIEW' | 'COMPLETE'`
  - `ShotMode = 'STILL' | 'MOTION' | 'HERO'`
  - `GenJobStatus = 'submitted' | 'running' | 'succeeded' | 'failed' | 'cancelled'`
- Sparse index values: `GSI1PK='VSTORY'` on METADATA rows, `GSI1PK='VSTORY_INFLIGHT'` on non-terminal GENJOB rows. Namespaced so they cannot collide with `MASTERJOB_SAVED`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/types/visualStory.ts` | Client-safe types, zod schemas, id validators. No server SDK import. |
| `src/services/video/cost.ts` | Mode rate cards, cost estimation, budget arithmetic. Pure. |
| `src/infrastructure/database/VisualStoryRepository.ts` | All DynamoDB access for the entity family. |
| `src/services/video/providers/types.ts` | The `VideoGenerationProvider` port. |
| `src/services/video/providers/fake.ts` | Test double satisfying the port. |
| `src/services/video/providers/index.ts` | Registry + selection. |
| `src/services/video/image-shot.ts` | STILL mode — wraps `generateCoverArt`. |
| `src/app/api/admin/visual-story/**` | Routes from spec §8. |
| `src/components/admin/visual-story/*.tsx` | Studio panels. |
| `src/app/(admin)/admin/visual-story/**` | List + studio pages. |

---

### Task 1: Types and validation

**Files:**
- Create: `src/types/visualStory.ts`
- Test: `__tests__/types/visualStory.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `VisualStoryStatus`, `ShotMode`, `GenJobStatus`, `VisualStory`, `Scene`, `Shot`, `CharacterRef`, `Candidate`, `GenJob`, `createVisualStorySchema`, `updateVisualStorySchema`, `sceneSchema`, `shotSchema`, `isVsId(id: string): boolean`, `newVsId(): string`, `padOrder(n: number): string`.

- [ ] **Step 1: Write the failing test**

```ts
/** @jest-environment node */
import {
  isVsId, newVsId, padOrder, createVisualStorySchema, SHOT_MODES,
} from '@/types/visualStory';

describe('id + ordering helpers', () => {
  it('mints ids that validate', () => {
    expect(isVsId(newVsId())).toBe(true);
  });
  it('rejects anything that is not a vs id — keys are built from this', () => {
    for (const bad of ['', 'vs', 'cnt_123', 'vs_../../etc', 'VS_123 ']) {
      expect(isVsId(bad)).toBe(false);
    }
  });
  it('zero-pads order to three digits so SK begins_with sorts correctly', () => {
    expect(padOrder(0)).toBe('000');
    expect(padOrder(7)).toBe('007');
    expect(padOrder(42)).toBe('042');
    expect(padOrder(999)).toBe('999');
  });
});

describe('createVisualStorySchema', () => {
  it('accepts a well-formed create', () => {
    const r = createVisualStorySchema.safeParse({
      contentId: 'cnt_1789096978174_fd96yxbx61',
      title: 'Anjukame — visual treatment',
      aspectRatio: '16:9',
    });
    expect(r.success).toBe(true);
  });
  it('rejects an unknown aspect ratio', () => {
    const r = createVisualStorySchema.safeParse({
      contentId: 'cnt_1', title: 'x', aspectRatio: '21:9',
    });
    expect(r.success).toBe(false);
  });
  it('requires a contentId — a visual story is never standalone', () => {
    expect(createVisualStorySchema.safeParse({ title: 'x', aspectRatio: '16:9' }).success).toBe(false);
  });
});

describe('SHOT_MODES', () => {
  it('is exactly the three cost tiers', () => {
    expect([...SHOT_MODES]).toEqual(['STILL', 'MOTION', 'HERO']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test npx jest __tests__/types/visualStory.test.ts`
Expected: FAIL — `Cannot find module '@/types/visualStory'`

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Visual Story Studio — the shared contract.
 *
 * CLIENT-SAFE: imports no server SDK, so routes, the repository and the React
 * panels share one source of truth. Mirrors src/types/story.ts, which is a
 * DIFFERENT entity — that one is the fan-submission inbox. See the spec §2.
 */
import { z } from 'zod';

export const VISUAL_STORY_STATUSES = ['DRAFT', 'STORYBOARDING', 'GENERATING', 'REVIEW', 'COMPLETE'] as const;
export type VisualStoryStatus = (typeof VISUAL_STORY_STATUSES)[number];

export const SHOT_MODES = ['STILL', 'MOTION', 'HERO'] as const;
export type ShotMode = (typeof SHOT_MODES)[number];

export const GEN_JOB_STATUSES = ['submitted', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type GenJobStatus = (typeof GEN_JOB_STATUSES)[number];

/** Reaching any of these removes the GSI1PK attribute from the job row. */
export const TERMINAL_JOB_STATUSES: readonly GenJobStatus[] = ['succeeded', 'failed', 'cancelled'];

export const ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export interface VisualStory {
  vsId: string;
  contentId: string;
  title: string;
  status: VisualStoryStatus;
  aspectRatio: AspectRatio;
  providerId: string;
  budgetUsdCap: number;
  spentUsd: number;
  createdAt: string;
  updatedAt: string;
}

export interface Scene { order: number; heading: string; summary: string; tamilText: string }

export interface Shot {
  sceneOrder: number;
  shotOrder: number;
  mode: ShotMode;
  durationSec: number;
  visualPrompt: string;
  negativePrompt: string;
  charIds: string[];
  selectedCandidateId: string | null;
}

export interface CharacterRef { charId: string; name: string; description: string; refImageKeys: string[]; createdAt: string }

export interface Candidate {
  candId: string; sceneOrder: number; shotOrder: number;
  jobId: string | null; providerId: string; providerTaskId: string | null;
  s3Key: string; posterKey: string | null; costUsd: number; createdAt: string;
}

export interface GenJob {
  jobId: string; status: GenJobStatus; mode: ShotMode; providerId: string;
  providerTaskId: string | null; sceneOrder: number; shotOrder: number;
  estimatedCostUsd: number; actualCostUsd: number | null;
  attempts: number; lastPolledAt: string | null;
  error: { code: string; message: string } | null;
  createdAt: string; updatedAt: string;
}

// --- ids ---------------------------------------------------------------------
// Validated before ever being used to build a DynamoDB key, following
// isStoryId() in src/types/story.ts.
export function newVsId(): string {
  return `vs_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
export function isVsId(id: string): boolean {
  return /^vs_[0-9]+_[a-z0-9]+$/.test(id);
}

/**
 * Three-digit zero pad. Scene and shot order live IN the sort key, so they must
 * sort lexicographically — 'SCENE#010' must come after 'SCENE#009', which
 * unpadded integers do not.
 */
export function padOrder(n: number): string {
  return String(Math.max(0, Math.trunc(n))).padStart(3, '0');
}

// --- validation --------------------------------------------------------------
export const createVisualStorySchema = z.object({
  contentId: z.string().trim().min(1, 'A content record is required'),
  title: z.string().trim().min(1).max(200),
  aspectRatio: z.enum(ASPECT_RATIOS),
  budgetUsdCap: z.number().nonnegative().optional(),
});
export type CreateVisualStoryInput = z.infer<typeof createVisualStorySchema>;

export const updateVisualStorySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  status: z.enum(VISUAL_STORY_STATUSES).optional(),
  budgetUsdCap: z.number().nonnegative().optional(),
});

export const sceneSchema = z.object({
  order: z.number().int().min(0).max(999),
  heading: z.string().trim().max(200).default(''),
  summary: z.string().trim().max(2000).default(''),
  tamilText: z.string().trim().max(5000).default(''),
});

export const shotSchema = z.object({
  sceneOrder: z.number().int().min(0).max(999),
  shotOrder: z.number().int().min(0).max(999),
  mode: z.enum(SHOT_MODES),
  durationSec: z.number().min(1).max(60),
  visualPrompt: z.string().trim().max(2000).default(''),
  negativePrompt: z.string().trim().max(1000).default(''),
  charIds: z.array(z.string().trim().min(1)).max(10).default([]),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test npx jest __tests__/types/visualStory.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types/visualStory.ts __tests__/types/visualStory.test.ts
git commit -m "feat(visual-story): shared types, zod schemas and key-safe id helpers"
```

---

### Task 2: Cost model

**Files:**
- Create: `src/services/video/cost.ts`
- Test: `__tests__/services/video/cost.test.ts`

**Interfaces:**
- Consumes: `ShotMode` from Task 1.
- Produces: `DEFAULT_BUDGET_USD_CAP: number`, `RateCard`, `RATE_CARDS: Record<string, Record<ShotMode, RateCard>>`, `estimateCostUsd(providerId: string, mode: ShotMode, durationSec: number): number`, `withinBudget(spentUsd: number, estimateUsd: number, capUsd: number): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
/** @jest-environment node */
import {
  DEFAULT_BUDGET_USD_CAP, estimateCostUsd, withinBudget, RATE_CARDS,
} from '@/services/video/cost';

describe('estimateCostUsd', () => {
  it('costs the fake provider nothing, so tests never simulate spend', () => {
    expect(estimateCostUsd('fake', 'HERO', 10)).toBe(0);
  });
  it('prices per second on top of a flat fee', () => {
    // seedance MOTION: flatUsd 0.02 + 0.01/s  →  5s = 0.07
    expect(estimateCostUsd('seedance', 'MOTION', 5)).toBeCloseTo(0.07, 6);
  });
  it('ranks the modes STILL < MOTION < HERO at equal duration', () => {
    const still = estimateCostUsd('seedance', 'STILL', 5);
    const motion = estimateCostUsd('seedance', 'MOTION', 5);
    const hero = estimateCostUsd('seedance', 'HERO', 5);
    expect(still).toBeLessThan(motion);
    expect(motion).toBeLessThan(hero);
  });
  it('throws on an unknown provider rather than silently costing zero', () => {
    expect(() => estimateCostUsd('nope', 'STILL', 5)).toThrow(/unknown provider/i);
  });
});

describe('withinBudget', () => {
  it('allows spend that lands exactly on the cap', () => {
    expect(withinBudget(9.5, 0.5, 10)).toBe(true);
  });
  it('refuses spend that would exceed the cap', () => {
    expect(withinBudget(9.5, 0.51, 10)).toBe(false);
  });
  it('a zero cap freezes the story without deleting it', () => {
    expect(withinBudget(0, 0.01, 0)).toBe(false);
    expect(withinBudget(0, 0, 0)).toBe(true);
  });
});

describe('rate cards', () => {
  it('ships a card for every mode of every provider', () => {
    for (const [pid, card] of Object.entries(RATE_CARDS)) {
      for (const mode of ['STILL', 'MOTION', 'HERO'] as const) {
        expect(card[mode]).toBeDefined();
        expect(typeof card[mode].flatUsd).toBe('number');
      }
      expect(pid).toBeTruthy();
    }
  });
  it('has a sane default cap', () => {
    expect(DEFAULT_BUDGET_USD_CAP).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test npx jest __tests__/services/video/cost.test.ts`
Expected: FAIL — `Cannot find module '@/services/video/cost'`

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Cost model for Visual Story generation.
 *
 * Pure arithmetic, no network — so the budget rules can be tested without a
 * provider and the generate route can price a shot before spending anything.
 *
 * ⚠️ The seedance numbers below are PLACEHOLDER SHAPE, not published rates.
 * Phase 4 replaces them with the BytePlus rate card. They are ordered
 * STILL < MOTION < HERO so the ladder behaves correctly in the meantime, and
 * the fake provider is free so no test ever simulates spend.
 */
import type { ShotMode } from '@/types/visualStory';

export interface RateCard {
  /** Charged once per generation. */
  flatUsd: number;
  /** Charged per second of output. */
  perSecondUsd: number;
}

export const RATE_CARDS: Record<string, Record<ShotMode, RateCard>> = {
  fake: {
    STILL: { flatUsd: 0, perSecondUsd: 0 },
    MOTION: { flatUsd: 0, perSecondUsd: 0 },
    HERO: { flatUsd: 0, perSecondUsd: 0 },
  },
  seedance: {
    STILL: { flatUsd: 0.01, perSecondUsd: 0 },
    MOTION: { flatUsd: 0.02, perSecondUsd: 0.01 },
    HERO: { flatUsd: 0.05, perSecondUsd: 0.05 },
  },
};

/** Fallback cap applied when a story is created without one. */
export const DEFAULT_BUDGET_USD_CAP = 5;

export function estimateCostUsd(providerId: string, mode: ShotMode, durationSec: number): number {
  const card = RATE_CARDS[providerId]?.[mode];
  if (!card) throw new Error(`Unknown provider or mode: ${providerId}/${mode}`);
  const seconds = mode === 'STILL' ? 0 : Math.max(0, durationSec);
  return card.flatUsd + card.perSecondUsd * seconds;
}

/**
 * Authoritative budget gate. The UI shows the price, but this is what the
 * generate route enforces, so a client that skips the confirm dialog is still
 * refused. Landing exactly on the cap is allowed.
 */
export function withinBudget(spentUsd: number, estimateUsd: number, capUsd: number): boolean {
  return spentUsd + estimateUsd <= capUsd;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test npx jest __tests__/services/video/cost.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/video/cost.ts __tests__/services/video/cost.test.ts
git commit -m "feat(visual-story): cost model — mode ladder, estimates, budget gate"
```

---

### Task 3: Repository — story lifecycle and the sparse index

**Files:**
- Create: `src/infrastructure/database/VisualStoryRepository.ts`
- Test: `__tests__/infrastructure/VisualStoryRepository.test.ts`

**Interfaces:**
- Consumes: Task 1 types, Task 2 `DEFAULT_BUDGET_USD_CAP`.
- Produces: class `VisualStoryRepository` with `create(input): Promise<VisualStory>`, `findById(vsId): Promise<VisualStory | null>`, `list(): Promise<VisualStory[]>`, `listByContent(contentId): Promise<VisualStory[]>`, `patch(vsId, fields): Promise<VisualStory>`, `addSpend(vsId, usd): Promise<void>`; plus exported key builders `vsPk(vsId)`, `sceneSk(order)`, `shotSk(s, sh)`, `candSk(s, sh, candId)`, `charSk(charId)`, `jobSk(jobId)`, and `VSTORY_INDEX_PK`, `VSTORY_INFLIGHT_PK`.

- [ ] **Step 1: Write the failing test**

```ts
/** @jest-environment node */
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: {
    put: jest.fn(async () => ({})),
    get: jest.fn(async () => ({ Item: undefined })),
    query: jest.fn(async () => ({ Items: [] })),
    update: jest.fn(async () => ({})),
    delete: jest.fn(async () => ({})),
  },
  handleDynamoDBError: (e: unknown) => { throw e; },
}));

import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';
import {
  VisualStoryRepository, vsPk, sceneSk, shotSk, candSk, charSk, jobSk,
  VSTORY_INDEX_PK, VSTORY_INFLIGHT_PK,
} from '@/infrastructure/database/VisualStoryRepository';

const put = DynamoDBOperations.put as jest.Mock;
const query = DynamoDBOperations.query as jest.Mock;
beforeEach(() => { jest.clearAllMocks(); });

describe('key builders', () => {
  it('put every child under ONE partition so the studio loads in one Query', () => {
    expect(vsPk('vs_1_a')).toBe('VSTORY#vs_1_a');
  });
  it('zero-pads orders so begins_with sorts correctly', () => {
    expect(sceneSk(9)).toBe('SCENE#009');
    expect(sceneSk(10)).toBe('SCENE#010');
    expect(shotSk(1, 12)).toBe('SHOT#001#012');
    expect(candSk(1, 2, 'c9')).toBe('CAND#001#002#c9');
  });
  it('namespaces the other children', () => {
    expect(charSk('ch1')).toBe('CHAR#ch1');
    expect(jobSk('j1')).toBe('GENJOB#j1');
  });
});

describe('create', () => {
  it('writes the sparse GSI1 keys that make list-all possible without a new index', async () => {
    const repo = new VisualStoryRepository();
    const story = await repo.create({ contentId: 'cnt_9', title: 'T', aspectRatio: '16:9' });

    const item = put.mock.calls[0][0];
    expect(item.PK).toBe(`VSTORY#${story.vsId}`);
    expect(item.SK).toBe('METADATA');
    expect(item.entityType).toBe('VISUAL_STORY');
    expect(item.GSI1PK).toBe(VSTORY_INDEX_PK);
    // contentId first so listByContent can use begins_with on the same partition
    expect(item.GSI1SK.startsWith('cnt_9#')).toBe(true);
  });

  it('defaults the budget cap rather than leaving it undefined', async () => {
    await new VisualStoryRepository().create({ contentId: 'c', title: 'T', aspectRatio: '1:1' });
    expect(put.mock.calls[0][0].budgetUsdCap).toBeGreaterThan(0);
    expect(put.mock.calls[0][0].spentUsd).toBe(0);
  });

  it('honours an explicit cap of zero, which freezes the story', async () => {
    await new VisualStoryRepository().create({ contentId: 'c', title: 'T', aspectRatio: '1:1', budgetUsdCap: 0 });
    expect(put.mock.calls[0][0].budgetUsdCap).toBe(0);
  });

  it('starts in DRAFT', async () => {
    const s = await new VisualStoryRepository().create({ contentId: 'c', title: 'T', aspectRatio: '16:9' });
    expect(s.status).toBe('DRAFT');
  });
});

describe('list', () => {
  it('queries the sparse GSI1 partition, never a scan', async () => {
    await new VisualStoryRepository().list();
    const params = query.mock.calls[0][0];
    expect(params.indexName).toBe('GSI1');
    expect(params.expressionAttributeValues[':pk']).toBe(VSTORY_INDEX_PK);
  });

  it('narrows to one content record with begins_with on the same partition', async () => {
    await new VisualStoryRepository().listByContent('cnt_9');
    const params = query.mock.calls[0][0];
    expect(params.indexName).toBe('GSI1');
    expect(params.keyConditionExpression).toContain('begins_with');
    expect(params.expressionAttributeValues[':sk']).toBe('cnt_9#');
  });
});

describe('addSpend', () => {
  it('uses an atomic ADD so concurrent generations cannot lose spend', async () => {
    await new VisualStoryRepository().addSpend('vs_1_a', 0.25);
    const params = (DynamoDBOperations.update as jest.Mock).mock.calls[0][0];
    expect(params.updateExpression).toContain('ADD');
    expect(params.expressionAttributeValues[':usd']).toBe(0.25);
  });
});

describe('the in-flight partition', () => {
  it('is namespaced so it cannot collide with MASTERJOB_SAVED', () => {
    expect(VSTORY_INFLIGHT_PK).toBe('VSTORY_INFLIGHT');
    expect(VSTORY_INDEX_PK).toBe('VSTORY');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test npx jest __tests__/infrastructure/VisualStoryRepository.test.ts`
Expected: FAIL — `Cannot find module '@/infrastructure/database/VisualStoryRepository'`

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Persistence for Visual Story Studio.
 *
 * ONE partition holds an entire visual story — metadata, characters, scenes,
 * shots, candidates and generation jobs — so opening the studio is a single
 * Query against the base table with no index (spec §5.1).
 *
 * Two SPARSE GSI1 partitions do the rest, which is why this feature adds no
 * new index. The technique follows MasterJobRepository's MASTERJOB_SAVED:
 * write the GSI1PK attribute only on rows that belong in the index, and REMOVE
 * it when they no longer do.
 */
import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';
import { DEFAULT_BUDGET_USD_CAP } from '@/services/video/cost';
import {
  newVsId, padOrder,
  type VisualStory, type CreateVisualStoryInput, type VisualStoryStatus,
} from '@/types/visualStory';

/** Every visual story METADATA row. Small — an admin list, not a feed. */
export const VSTORY_INDEX_PK = 'VSTORY';
/** Non-terminal generation jobs only. The reconcile sweep's whole basis. */
export const VSTORY_INFLIGHT_PK = 'VSTORY_INFLIGHT';

export const vsPk = (vsId: string) => `VSTORY#${vsId}`;
export const sceneSk = (order: number) => `SCENE#${padOrder(order)}`;
export const shotSk = (sceneOrder: number, shotOrder: number) =>
  `SHOT#${padOrder(sceneOrder)}#${padOrder(shotOrder)}`;
export const candSk = (sceneOrder: number, shotOrder: number, candId: string) =>
  `CAND#${padOrder(sceneOrder)}#${padOrder(shotOrder)}#${candId}`;
export const charSk = (charId: string) => `CHAR#${charId}`;
export const jobSk = (jobId: string) => `GENJOB#${jobId}`;

/** `<contentId>#<createdAt>#<vsId>` — one partition serves list-all AND by-content. */
const indexSk = (contentId: string, createdAt: string, vsId: string) =>
  `${contentId}#${createdAt}#${vsId}`;

function toStory(item: Record<string, unknown>): VisualStory {
  return {
    vsId: String(item.vsId),
    contentId: String(item.contentId),
    title: String(item.title ?? ''),
    status: (item.status as VisualStoryStatus) ?? 'DRAFT',
    aspectRatio: (item.aspectRatio as VisualStory['aspectRatio']) ?? '16:9',
    providerId: String(item.providerId ?? 'fake'),
    budgetUsdCap: Number(item.budgetUsdCap ?? 0),
    spentUsd: Number(item.spentUsd ?? 0),
    createdAt: String(item.createdAt),
    updatedAt: String(item.updatedAt ?? item.createdAt),
  };
}

export class VisualStoryRepository {
  async create(input: CreateVisualStoryInput & { providerId?: string }): Promise<VisualStory> {
    try {
      const vsId = newVsId();
      const now = new Date().toISOString();
      const story: VisualStory = {
        vsId,
        contentId: input.contentId,
        title: input.title,
        status: 'DRAFT',
        aspectRatio: input.aspectRatio,
        providerId: input.providerId ?? 'fake',
        // `?? ` not `|| ` — an explicit cap of 0 is legal and freezes the story.
        budgetUsdCap: input.budgetUsdCap ?? DEFAULT_BUDGET_USD_CAP,
        spentUsd: 0,
        createdAt: now,
        updatedAt: now,
      };
      await DynamoDBOperations.put({
        PK: vsPk(vsId),
        SK: 'METADATA',
        entityType: 'VISUAL_STORY',
        ...story,
        GSI1PK: VSTORY_INDEX_PK,
        GSI1SK: indexSk(input.contentId, now, vsId),
      });
      return story;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async findById(vsId: string): Promise<VisualStory | null> {
    try {
      const r = await DynamoDBOperations.get({ PK: vsPk(vsId), SK: 'METADATA' });
      return r.Item ? toStory(r.Item as Record<string, unknown>) : null;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async list(): Promise<VisualStory[]> {
    try {
      const r = await DynamoDBOperations.query({
        indexName: 'GSI1',
        keyConditionExpression: 'GSI1PK = :pk',
        expressionAttributeValues: { ':pk': VSTORY_INDEX_PK },
        scanIndexForward: false,
      });
      return (r.Items ?? []).map((i) => toStory(i as Record<string, unknown>));
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async listByContent(contentId: string): Promise<VisualStory[]> {
    try {
      const r = await DynamoDBOperations.query({
        indexName: 'GSI1',
        keyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        expressionAttributeValues: { ':pk': VSTORY_INDEX_PK, ':sk': `${contentId}#` },
        scanIndexForward: false,
      });
      return (r.Items ?? []).map((i) => toStory(i as Record<string, unknown>));
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async patch(
    vsId: string,
    fields: Partial<Pick<VisualStory, 'title' | 'status' | 'budgetUsdCap'>>
  ): Promise<VisualStory> {
    try {
      const now = new Date().toISOString();
      const sets: string[] = ['updatedAt = :updatedAt'];
      const values: Record<string, unknown> = { ':updatedAt': now };
      const names: Record<string, string> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v === undefined) continue;
        sets.push(`#${k} = :${k}`);
        names[`#${k}`] = k;
        values[`:${k}`] = v;
      }
      const updated = await DynamoDBOperations.update({
        key: { PK: vsPk(vsId), SK: 'METADATA' },
        updateExpression: `SET ${sets.join(', ')}`,
        expressionAttributeValues: values,
        ...(Object.keys(names).length ? { expressionAttributeNames: names } : {}),
      });
      return toStory((updated ?? {}) as Record<string, unknown>);
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Atomic ADD, not read-modify-write. Two generations finishing at the same
   * moment must both count against the cap.
   */
  async addSpend(vsId: string, usd: number): Promise<void> {
    try {
      await DynamoDBOperations.update({
        key: { PK: vsPk(vsId), SK: 'METADATA' },
        updateExpression: 'ADD spentUsd :usd SET updatedAt = :now',
        expressionAttributeValues: { ':usd': usd, ':now': new Date().toISOString() },
      });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test npx jest __tests__/infrastructure/VisualStoryRepository.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/database/VisualStoryRepository.ts __tests__/infrastructure/VisualStoryRepository.test.ts
git commit -m "feat(visual-story): repository — one-partition layout, sparse GSI1, atomic spend"
```

---

### Task 4: Repository — scenes, shots and characters

**Files:**
- Modify: `src/infrastructure/database/VisualStoryRepository.ts`
- Test: `__tests__/infrastructure/VisualStoryRepository.children.test.ts`

**Interfaces:**
- Consumes: Task 3 key builders.
- Produces: `putScene(vsId, scene): Promise<void>`, `putShot(vsId, shot): Promise<void>`, `putCharacter(vsId, char): Promise<CharacterRef>`, `putCandidate(vsId, candidate): Promise<void>`, `loadTree(vsId): Promise<{ story, scenes, shots, characters, candidates, jobs }>`, `deleteChild(vsId, sk): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
/** @jest-environment node */
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: { put: jest.fn(async () => ({})), query: jest.fn(async () => ({ Items: [] })), delete: jest.fn(async () => ({})) },
  handleDynamoDBError: (e: unknown) => { throw e; },
}));
import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';

const query = DynamoDBOperations.query as jest.Mock;
beforeEach(() => jest.clearAllMocks());

describe('loadTree', () => {
  it('reads the whole story with ONE base-table Query and no index', async () => {
    query.mockResolvedValueOnce({ Items: [
      { PK: 'VSTORY#vs_1_a', SK: 'METADATA', vsId: 'vs_1_a', contentId: 'c', createdAt: 'now' },
      { PK: 'VSTORY#vs_1_a', SK: 'SCENE#000', order: 0, heading: 'Opening' },
      { PK: 'VSTORY#vs_1_a', SK: 'SHOT#000#001', sceneOrder: 0, shotOrder: 1, mode: 'STILL' },
      { PK: 'VSTORY#vs_1_a', SK: 'CHAR#ch1', charId: 'ch1', name: 'Mother' },
      { PK: 'VSTORY#vs_1_a', SK: 'CAND#000#001#cd1', candId: 'cd1' },
      { PK: 'VSTORY#vs_1_a', SK: 'GENJOB#j1', jobId: 'j1', status: 'running' },
    ] });

    const tree = await new VisualStoryRepository().loadTree('vs_1_a');

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0].indexName).toBeUndefined();
    expect(tree.story?.vsId).toBe('vs_1_a');
    expect(tree.scenes).toHaveLength(1);
    expect(tree.shots).toHaveLength(1);
    expect(tree.characters).toHaveLength(1);
    expect(tree.candidates).toHaveLength(1);
    expect(tree.jobs).toHaveLength(1);
  });

  it('returns a null story rather than throwing when the partition is empty', async () => {
    query.mockResolvedValueOnce({ Items: [] });
    const tree = await new VisualStoryRepository().loadTree('vs_missing_x');
    expect(tree.story).toBeNull();
    expect(tree.scenes).toEqual([]);
  });
});

describe('putShot', () => {
  it('keys the shot by padded scene+shot order', async () => {
    await new VisualStoryRepository().putShot('vs_1_a', {
      sceneOrder: 2, shotOrder: 10, mode: 'STILL', durationSec: 5,
      visualPrompt: 'p', negativePrompt: '', charIds: [], selectedCandidateId: null,
    });
    const item = (DynamoDBOperations.put as jest.Mock).mock.calls[0][0];
    expect(item.SK).toBe('SHOT#002#010');
    expect(item.entityType).toBe('VISUAL_SHOT');
  });
});

describe('putCandidate', () => {
  it('keys a candidate under its shot so one Query returns both', async () => {
    await new VisualStoryRepository().putCandidate('vs_1_a', {
      candId: 'cd1', sceneOrder: 0, shotOrder: 1, jobId: null,
      providerId: 'openai-image', providerTaskId: null,
      s3Key: 'k', posterKey: null, costUsd: 0.04, createdAt: 'now',
    });
    const item = (DynamoDBOperations.put as jest.Mock).mock.calls[0][0];
    expect(item.SK).toBe('CAND#000#001#cd1');
    expect(item.entityType).toBe('VISUAL_CANDIDATE');
  });
});

describe('putCharacter', () => {
  it('mints a charId when none is supplied', async () => {
    const c = await new VisualStoryRepository().putCharacter('vs_1_a', { name: 'Mother', description: 'd', refImageKeys: [] });
    expect(c.charId).toMatch(/^ch_/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test npx jest __tests__/infrastructure/VisualStoryRepository.children.test.ts`
Expected: FAIL — `repo.loadTree is not a function`

- [ ] **Step 3: Add the methods to `VisualStoryRepository`**

Append inside the class, and add these imports at the top of the file:
`import type { Scene, Shot, CharacterRef, Candidate, GenJob } from '@/types/visualStory';`

```ts
  async putScene(vsId: string, scene: Scene): Promise<void> {
    try {
      await DynamoDBOperations.put({
        PK: vsPk(vsId), SK: sceneSk(scene.order),
        entityType: 'VISUAL_SCENE', ...scene,
      });
    } catch (error) { handleDynamoDBError(error); }
  }

  async putShot(vsId: string, shot: Shot): Promise<void> {
    try {
      await DynamoDBOperations.put({
        PK: vsPk(vsId), SK: shotSk(shot.sceneOrder, shot.shotOrder),
        entityType: 'VISUAL_SHOT', ...shot,
      });
    } catch (error) { handleDynamoDBError(error); }
  }

  async putCharacter(
    vsId: string,
    input: { charId?: string; name: string; description: string; refImageKeys: string[] }
  ): Promise<CharacterRef> {
    try {
      const charId = input.charId ?? `ch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const char: CharacterRef = {
        charId, name: input.name, description: input.description,
        refImageKeys: input.refImageKeys, createdAt: new Date().toISOString(),
      };
      await DynamoDBOperations.put({
        PK: vsPk(vsId), SK: charSk(charId), entityType: 'VISUAL_CHARACTER', ...char,
      });
      return char;
    } catch (error) { handleDynamoDBError(error); }
  }

  async putCandidate(vsId: string, candidate: Candidate): Promise<void> {
    try {
      await DynamoDBOperations.put({
        PK: vsPk(vsId),
        SK: candSk(candidate.sceneOrder, candidate.shotOrder, candidate.candId),
        entityType: 'VISUAL_CANDIDATE', ...candidate,
      });
    } catch (error) { handleDynamoDBError(error); }
  }

  /**
   * The whole studio in one round trip. Splitting by SK prefix here — rather
   * than issuing five queries — is the point of the single-partition layout.
   */
  async loadTree(vsId: string): Promise<{
    story: VisualStory | null; scenes: Scene[]; shots: Shot[];
    characters: CharacterRef[]; candidates: Candidate[]; jobs: GenJob[];
  }> {
    try {
      const r = await DynamoDBOperations.query({
        keyConditionExpression: 'PK = :pk',
        expressionAttributeValues: { ':pk': vsPk(vsId) },
      });
      const items = (r.Items ?? []) as Array<Record<string, unknown>>;
      const of = (prefix: string) => items.filter((i) => String(i.SK).startsWith(prefix));
      const meta = items.find((i) => i.SK === 'METADATA');
      return {
        story: meta ? toStory(meta) : null,
        scenes: of('SCENE#') as unknown as Scene[],
        shots: of('SHOT#') as unknown as Shot[],
        characters: of('CHAR#') as unknown as CharacterRef[],
        candidates: of('CAND#') as unknown as Candidate[],
        jobs: of('GENJOB#') as unknown as GenJob[],
      };
    } catch (error) { handleDynamoDBError(error); }
  }

  async deleteChild(vsId: string, sk: string): Promise<void> {
    try {
      await DynamoDBOperations.delete({ PK: vsPk(vsId), SK: sk });
    } catch (error) { handleDynamoDBError(error); }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test npx jest __tests__/infrastructure/VisualStoryRepository.children.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/database/VisualStoryRepository.ts __tests__/infrastructure/VisualStoryRepository.children.test.ts
git commit -m "feat(visual-story): scenes, shots, characters and one-Query loadTree"
```

---

### Task 5: The provider port and the fake

**Files:**
- Create: `src/services/video/providers/types.ts`, `src/services/video/providers/fake.ts`, `src/services/video/providers/index.ts`
- Test: `__tests__/services/video/providers.test.ts`

**Interfaces:**
- Consumes: `ShotMode`, `AspectRatio` from Task 1; `estimateCostUsd` from Task 2.
- Produces: `VideoErrorCode`, `VideoGenRequest`, `ProviderAsset`, `SubmitResult`, `PollResult`, `VideoGenerationProvider`, `FakeVideoProvider`, `getVideoProvider(id?): VideoGenerationProvider`, `DEFAULT_PROVIDER_ID`.

- [ ] **Step 1: Write the failing test**

```ts
/** @jest-environment node */
import { getVideoProvider, DEFAULT_PROVIDER_ID } from '@/services/video/providers';
import type { VideoGenRequest } from '@/services/video/providers/types';

const req: VideoGenRequest = {
  prompt: 'a village path at dusk', mode: 'MOTION', durationSec: 5,
  aspectRatio: '16:9',
};

describe('registry', () => {
  it('resolves the fake provider by name', () => {
    expect(getVideoProvider('fake').id).toBe('fake');
  });
  it('throws on an unknown id rather than silently defaulting', () => {
    expect(() => getVideoProvider('veo')).toThrow(/unknown video provider/i);
  });
  it('has a declared default', () => {
    expect(DEFAULT_PROVIDER_ID).toBeTruthy();
  });
});

describe('FakeVideoProvider', () => {
  it('is always configured, so tests need no credential', async () => {
    expect(await getVideoProvider('fake').isConfigured()).toBe(true);
  });

  it('costs nothing', () => {
    expect(getVideoProvider('fake').estimateCostUsd(req)).toBe(0);
  });

  it('submit returns a task id', async () => {
    const r = await getVideoProvider('fake').submit(req);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.providerTaskId).toMatch(/^fake_/);
  });

  it('runs then succeeds, so the whole poll loop is exercisable', async () => {
    const p = getVideoProvider('fake');
    const s = await p.submit(req);
    if (!s.ok) throw new Error('submit failed');

    const first = await p.poll(s.providerTaskId);
    expect(first.ok && first.state === 'running').toBe(true);

    const second = await p.poll(s.providerTaskId);
    expect(second.ok && second.state === 'succeeded').toBe(true);
    if (second.ok && second.state === 'succeeded') {
      expect(second.assets[0].kind).toBe('video');
      expect(second.actualCostUsd).toBe(0);
    }
  });

  it('reports a classified failure for a prompt that asks for one', async () => {
    const p = getVideoProvider('fake');
    const s = await p.submit({ ...req, prompt: 'FAIL_POLICY' });
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.code).toBe('content_policy');
  });

  it('polling an unknown task is a classified error, not a crash', async () => {
    const r = await getVideoProvider('fake').poll('nope');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_response');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test npx jest __tests__/services/video/providers.test.ts`
Expected: FAIL — `Cannot find module '@/services/video/providers'`

- [ ] **Step 3: Write the three files**

`src/services/video/providers/types.ts`:

```ts
/**
 * Video generation port — the provider-agnostic seam.
 *
 * Modelled 1:1 on src/services/ai/engines/types.ts, which already proves the
 * pattern with two adapters. A provider's ONLY job is to submit a generation
 * and report its state. Cost policy, persistence and the budget gate live
 * above it, so every provider feeds the same pipeline.
 */
import type { ShotMode, AspectRatio } from '@/types/visualStory';

export type VideoErrorCode =
  | 'not_configured' | 'auth' | 'rate_limit'
  | 'upstream' | 'bad_response' | 'content_policy';

export interface VideoGenRequest {
  prompt: string;
  negativePrompt?: string;
  mode: ShotMode;
  durationSec: number;
  aspectRatio: AspectRatio;
  /** Short-lived signed S3 URLs — never a public object. */
  referenceImageUrls?: string[];
  seed?: number;
  signal?: AbortSignal;
}

export interface ProviderAsset { kind: 'video' | 'poster'; url: string; contentType: string }

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
  /** Async because real credentials come from SSM at request time. */
  isConfigured(): Promise<boolean>;
  estimateCostUsd(req: VideoGenRequest): number;
  submit(req: VideoGenRequest): Promise<SubmitResult>;
  poll(providerTaskId: string): Promise<PollResult>;
  cancel?(providerTaskId: string): Promise<void>;
}
```

`src/services/video/providers/fake.ts`:

```ts
/**
 * In-process provider used by tests and by VIDEO_PROVIDER=fake.
 *
 * It exists so Phases 2-4 can be built and verified with no BytePlus account:
 * it exercises submit → running → succeeded, the failure paths, and the cost
 * accounting. It stays as the permanent test double once Seedance lands.
 */
import { estimateCostUsd } from '@/services/video/cost';
import type {
  VideoGenerationProvider, VideoGenRequest, SubmitResult, PollResult,
} from './types';

export const FAKE_PROVIDER_ID = 'fake';

/** How many polls a task spends 'running' before it succeeds. */
const RUNNING_POLLS = 1;

export class FakeVideoProvider implements VideoGenerationProvider {
  readonly id = FAKE_PROVIDER_ID;
  readonly model = 'fake-1';
  private polls = new Map<string, number>();

  async isConfigured(): Promise<boolean> { return true; }

  estimateCostUsd(req: VideoGenRequest): number {
    return estimateCostUsd(this.id, req.mode, req.durationSec);
  }

  async submit(req: VideoGenRequest): Promise<SubmitResult> {
    // Deterministic hooks so route tests can drive the failure branches.
    if (req.prompt === 'FAIL_POLICY') return { ok: false, code: 'content_policy', error: 'Prompt refused' };
    if (req.prompt === 'FAIL_AUTH') return { ok: false, code: 'auth', error: 'Credential rejected' };
    const id = `fake_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.polls.set(id, 0);
    return { ok: true, providerTaskId: id, estimatedCostUsd: this.estimateCostUsd(req) };
  }

  async poll(providerTaskId: string): Promise<PollResult> {
    const n = this.polls.get(providerTaskId);
    if (n === undefined) return { ok: false, code: 'bad_response', error: 'Unknown task' };
    if (n < RUNNING_POLLS) {
      this.polls.set(providerTaskId, n + 1);
      return { ok: true, state: 'running' };
    }
    return {
      ok: true,
      state: 'succeeded',
      assets: [{ kind: 'video', url: `https://example.invalid/${providerTaskId}.mp4`, contentType: 'video/mp4' }],
      actualCostUsd: 0,
    };
  }

  async cancel(providerTaskId: string): Promise<void> { this.polls.delete(providerTaskId); }
}
```

`src/services/video/providers/index.ts`:

```ts
/**
 * Provider registry. Selection precedence: explicit id → VIDEO_PROVIDER env →
 * DEFAULT_PROVIDER_ID. Mirrors getEngine() in src/services/ai/engines/index.ts.
 *
 * Adding Veo later is one new file and one `case`.
 */
import { FakeVideoProvider, FAKE_PROVIDER_ID } from './fake';
import type { VideoGenerationProvider } from './types';

export const DEFAULT_PROVIDER_ID = FAKE_PROVIDER_ID;

/** Kept per-id so the fake's in-memory task state survives across calls. */
const cache = new Map<string, VideoGenerationProvider>();

export function getVideoProvider(id?: string): VideoGenerationProvider {
  const selected = (id || process.env.VIDEO_PROVIDER || DEFAULT_PROVIDER_ID).trim().toLowerCase();
  const hit = cache.get(selected);
  if (hit) return hit;

  let p: VideoGenerationProvider;
  switch (selected) {
    case FAKE_PROVIDER_ID: p = new FakeVideoProvider(); break;
    default: throw new Error(`Unknown video provider: "${selected}"`);
  }
  cache.set(selected, p);
  return p;
}

export { FAKE_PROVIDER_ID };
export type {
  VideoGenerationProvider, VideoGenRequest, SubmitResult, PollResult,
  VideoErrorCode, ProviderAsset,
} from './types';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test npx jest __tests__/services/video/providers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/video/providers __tests__/services/video/providers.test.ts
git commit -m "feat(visual-story): VideoGenerationProvider port, registry and fake"
```

---

### Task 6: Story routes — list, create, read, patch

**Files:**
- Create: `src/app/api/admin/visual-story/route.ts`, `src/app/api/admin/visual-story/[vsId]/route.ts`, `src/lib/visual-story-rate-limit.ts`
- Test: `__tests__/api/admin/visual-story.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas, Task 3 repository, `requireAdmin`/`requireBearer`/`authErrorResponse` from `@/lib/auth-helper`, `ContentRepository.findById`.
- Produces: `visualStoryLimiter` (a `RateLimiter`), and the HTTP contract `GET/POST /api/admin/visual-story`, `GET/PATCH /api/admin/visual-story/[vsId]`.

- [ ] **Step 1: Write the failing test**

```ts
/** @jest-environment node */
jest.mock('@/lib/auth-helper', () => ({
  requireAdmin: jest.fn(async () => ({ isAuthenticated: true, userId: 'u1', email: 'a@b.c' })),
  requireBearer: jest.fn(() => undefined),
  authErrorResponse: () => new Response(JSON.stringify({ success: false }), { status: 401 }),
}));
jest.mock('@/infrastructure/database/VisualStoryRepository', () => ({
  VisualStoryRepository: jest.fn().mockImplementation(() => ({
    list: jest.fn(async () => []),
    listByContent: jest.fn(async () => []),
    create: jest.fn(async (i: Record<string, unknown>) => ({ vsId: 'vs_1_a', ...i })),
  })),
}));
jest.mock('@/infrastructure/database/ContentRepository', () => ({
  ContentRepository: jest.fn().mockImplementation(() => ({
    findById: jest.fn(async (id: string) => (id === 'cnt_real' ? { id } : null)),
  })),
}));

import { NextRequest } from 'next/server';
import { requireAdmin, requireBearer } from '@/lib/auth-helper';
import { POST, GET } from '@/app/api/admin/visual-story/route';

const post = (body: unknown) =>
  new NextRequest('https://x.test/api/admin/visual-story', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  });

beforeEach(() => jest.clearAllMocks());

it('requires admin on the list', async () => {
  await GET(new NextRequest('https://x.test/api/admin/visual-story'));
  expect(requireAdmin).toHaveBeenCalled();
});

it('requires a bearer token on create — a cookie alone is CSRF-able', async () => {
  await POST(post({ contentId: 'cnt_real', title: 'T', aspectRatio: '16:9' }));
  expect(requireBearer).toHaveBeenCalled();
});

it('creates against a real content record', async () => {
  const res = await POST(post({ contentId: 'cnt_real', title: 'T', aspectRatio: '16:9' }));
  expect(res.status).toBe(201);
});

it('refuses a contentId that does not resolve, rather than orphaning the story', async () => {
  const res = await POST(post({ contentId: 'cnt_ghost', title: 'T', aspectRatio: '16:9' }));
  expect(res.status).toBe(404);
});

it('rejects a malformed body with 400', async () => {
  const res = await POST(post({ title: 'no content id' }));
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test npx jest __tests__/api/admin/visual-story.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/admin/visual-story/route'`

- [ ] **Step 3: Write the implementation**

`src/lib/visual-story-rate-limit.ts`:

```ts
/**
 * Per-admin limiter for the paid Visual Story routes. Its own module because
 * Next rejects unknown exports from a route file — same reason
 * src/lib/compose-rate-limit.ts exists.
 */
import { RateLimiter } from '@/lib/rate-limit';

export const visualStoryLimiter = new RateLimiter({ windowMs: 60_000, max: 20 });

export function __resetVisualStoryRateLimitForTests(): void {
  visualStoryLimiter.reset();
}
```

`src/app/api/admin/visual-story/route.ts`:

```ts
/**
 * GET  /api/admin/visual-story           — list, optional ?contentId=
 * POST /api/admin/visual-story           — create from { contentId, title, aspectRatio }
 *
 * A visual story anchors to a CONTENT record, never to /api/stories (the
 * fan-submission inbox). The contentId is verified to resolve before anything
 * is written, so a typo cannot orphan a story.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { createVisualStorySchema } from '@/types/visualStory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try { await requireAdmin(request); } catch (e) { return authErrorResponse(e); }

  const contentId = request.nextUrl.searchParams.get('contentId');
  const repo = new VisualStoryRepository();
  const stories = contentId ? await repo.listByContent(contentId) : await repo.list();
  return NextResponse.json({ success: true, stories });
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (e) { return authErrorResponse(e); }

  const body = await request.json().catch(() => null);
  const parsed = createVisualStorySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      { status: 400 }
    );
  }

  const content = await new ContentRepository().findById(parsed.data.contentId);
  if (!content) {
    return NextResponse.json(
      { success: false, error: `No content record ${parsed.data.contentId}` },
      { status: 404 }
    );
  }

  const story = await new VisualStoryRepository().create(parsed.data);
  return NextResponse.json({ success: true, story }, { status: 201 });
}
```

`src/app/api/admin/visual-story/[vsId]/route.ts`:

```ts
/**
 * GET   /api/admin/visual-story/[vsId] — the whole tree in one Query
 * PATCH /api/admin/visual-story/[vsId] — title / status / budgetUsdCap
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { updateVisualStorySchema, isVsId } from '@/types/visualStory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ vsId: string }> }) {
  try { await requireAdmin(request); } catch (e) { return authErrorResponse(e); }

  const { vsId } = await params;
  // Validated before it is used to build a DynamoDB key.
  if (!isVsId(vsId)) return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });

  const tree = await new VisualStoryRepository().loadTree(vsId);
  if (!tree.story) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true, ...tree });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ vsId: string }> }) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (e) { return authErrorResponse(e); }

  const { vsId } = await params;
  if (!isVsId(vsId)) return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });

  const parsed = updateVisualStorySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }

  const story = await new VisualStoryRepository().patch(vsId, parsed.data);
  return NextResponse.json({ success: true, story });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test npx jest __tests__/api/admin/visual-story.test.ts`
Expected: PASS

> If this is the first route test importing `@aws-sdk/client-ssm` transitively and it fails on a `browser`-condition resolution, extend `moduleNameMapper` in `jest.config.ts` by enumerating the new subpath. Do NOT add a wildcard and do NOT reach for transforms — the `@smithy/core` browser builds parse fine and then fail at runtime with `loadConfig is not a function`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/visual-story src/lib/visual-story-rate-limit.ts __tests__/api/admin/visual-story.test.ts
git commit -m "feat(visual-story): story routes with admin auth, CSRF gate and contentId validation"
```

---

### Task 7: Scene, shot and character routes

**Files:**
- Create: `src/app/api/admin/visual-story/[vsId]/scenes/route.ts`, `.../shots/route.ts`, `.../characters/route.ts`
- Test: `__tests__/api/admin/visual-story-children.test.ts`

**Interfaces:**
- Consumes: `sceneSchema`, `shotSchema` (Task 1); `putScene`, `putShot`, `putCharacter` (Task 4); `S3Operations.getSignedUploadPost(key, contentType, maxSize)` from `@/infrastructure/storage/s3-client`.
- Produces: `POST` handlers for the three child collections. The characters route returns `{ success, character, upload }` where `upload` is a presigned POST.

- [ ] **Step 1: Write the failing test**

```ts
/** @jest-environment node */
const putScene = jest.fn(async () => undefined);
const putShot = jest.fn(async () => undefined);
const putCharacter = jest.fn(async () => ({ charId: 'ch_1', name: 'Mother', description: '', refImageKeys: [], createdAt: 'now' }));

jest.mock('@/lib/auth-helper', () => ({
  requireAdmin: jest.fn(async () => ({ isAuthenticated: true, userId: 'u1' })),
  requireBearer: jest.fn(() => undefined),
  authErrorResponse: () => new Response('{}', { status: 401 }),
}));
jest.mock('@/infrastructure/database/VisualStoryRepository', () => ({
  VisualStoryRepository: jest.fn().mockImplementation(() => ({ putScene, putShot, putCharacter })),
}));
jest.mock('@/infrastructure/storage/s3-client', () => ({
  S3Operations: { getSignedUploadPost: jest.fn(async () => ({ url: 'https://s3.invalid', fields: {} })) },
}));

import { NextRequest } from 'next/server';
import { POST as postScene } from '@/app/api/admin/visual-story/[vsId]/scenes/route';
import { POST as postShot } from '@/app/api/admin/visual-story/[vsId]/shots/route';
import { POST as postChar } from '@/app/api/admin/visual-story/[vsId]/characters/route';

const ctx = { params: Promise.resolve({ vsId: 'vs_1_a' }) };
const req = (body: unknown) =>
  new NextRequest('https://x.test/', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

beforeEach(() => jest.clearAllMocks());

it('stores a scene', async () => {
  const res = await postScene(req({ order: 0, heading: 'Opening', summary: '', tamilText: '' }), ctx);
  expect(res.status).toBe(201);
  expect(putScene).toHaveBeenCalled();
});

it('rejects a shot whose mode is not one of the three tiers', async () => {
  const res = await postShot(req({ sceneOrder: 0, shotOrder: 0, mode: 'EPIC', durationSec: 5 }), ctx);
  expect(res.status).toBe(400);
  expect(putShot).not.toHaveBeenCalled();
});

it('stores a valid shot', async () => {
  const res = await postShot(req({ sceneOrder: 0, shotOrder: 0, mode: 'STILL', durationSec: 5 }), ctx);
  expect(res.status).toBe(201);
});

it('returns a presigned upload alongside the new character', async () => {
  const res = await postChar(req({ name: 'Mother', description: 'grey saree', contentType: 'image/png' }), ctx);
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.character.charId).toBe('ch_1');
  expect(body.upload.url).toContain('s3.invalid');
});

it('refuses a bad vsId before touching the database', async () => {
  const res = await postScene(req({ order: 0 }), { params: Promise.resolve({ vsId: '../evil' }) });
  expect(res.status).toBe(400);
  expect(putScene).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test npx jest __tests__/api/admin/visual-story-children.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the three routes**

`scenes/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { sceneSchema, isVsId } from '@/types/visualStory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ vsId: string }> }) {
  try { await requireAdmin(request); requireBearer(request); } catch (e) { return authErrorResponse(e); }

  const { vsId } = await params;
  if (!isVsId(vsId)) return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });

  const parsed = sceneSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid scene' }, { status: 400 });

  await new VisualStoryRepository().putScene(vsId, parsed.data);
  return NextResponse.json({ success: true, scene: parsed.data }, { status: 201 });
}
```

`shots/route.ts` — identical shape, with `shotSchema` and `putShot`, and `selectedCandidateId: null` added to the stored shot:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { shotSchema, isVsId } from '@/types/visualStory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ vsId: string }> }) {
  try { await requireAdmin(request); requireBearer(request); } catch (e) { return authErrorResponse(e); }

  const { vsId } = await params;
  if (!isVsId(vsId)) return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });

  const parsed = shotSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid shot' }, { status: 400 });

  const shot = { ...parsed.data, selectedCandidateId: null };
  await new VisualStoryRepository().putShot(vsId, shot);
  return NextResponse.json({ success: true, shot }, { status: 201 });
}
```

`characters/route.ts`:

```ts
/**
 * POST — create a character and hand back a presigned POST for its reference
 * image. Presigned POST (not PUT) because only POST can enforce a size cap
 * server-side; same reason /api/admin/upload uses it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { isVsId } from '@/types/visualStory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_REF_BYTES = 8 * 1024 * 1024;

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(''),
  contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']).default('image/png'),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ vsId: string }> }) {
  try { await requireAdmin(request); requireBearer(request); } catch (e) { return authErrorResponse(e); }

  const { vsId } = await params;
  if (!isVsId(vsId)) return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid character' }, { status: 400 });

  const character = await new VisualStoryRepository().putCharacter(vsId, {
    name: parsed.data.name, description: parsed.data.description, refImageKeys: [],
  });

  // Key is derived server-side from validated ids — a client never supplies one.
  const ext = parsed.data.contentType.split('/')[1];
  const key = `visual-story/${vsId}/refs/${character.charId}/${Date.now()}.${ext}`;
  const upload = await S3Operations.getSignedUploadPost(key, parsed.data.contentType, MAX_REF_BYTES);

  return NextResponse.json({ success: true, character, upload, key }, { status: 201 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test npx jest __tests__/api/admin/visual-story-children.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/visual-story __tests__/api/admin/visual-story-children.test.ts
git commit -m "feat(visual-story): scene, shot and character routes with presigned reference upload"
```

---

### Task 8: STILL mode

**Files:**
- Create: `src/services/video/image-shot.ts`, `src/app/api/admin/visual-story/[vsId]/still/route.ts`
- Test: `__tests__/services/video/image-shot.test.ts`

**Interfaces:**
- Consumes: `generateCoverArt` from `@/services/ai/cover-art`; `S3Operations` for the upload; `addSpend` from Task 3; `estimateCostUsd` from Task 2.
- Produces: `generateStill(opts: { vsId, sceneOrder, shotOrder, prompt }): Promise<{ ok: true; candidate: Candidate } | { ok: false; code: VideoErrorCode; error: string }>`.

- [ ] **Step 1: Write the failing test**

```ts
/** @jest-environment node */
const generateCoverArt = jest.fn(async () => ({ ok: true, base64: 'aGVsbG8=' }));
const uploadFile = jest.fn(async () => ({ key: 'k', url: 'u', bucket: 'b' }));
const addSpend = jest.fn(async () => undefined);
const putCandidate = jest.fn(async () => undefined);

jest.mock('@/services/ai/cover-art', () => ({ generateCoverArt: (...a: unknown[]) => generateCoverArt(...a) }));
jest.mock('@/infrastructure/storage/s3-client', () => ({ S3Operations: { uploadFile: (...a: unknown[]) => uploadFile(...a) } }));
jest.mock('@/infrastructure/database/VisualStoryRepository', () => ({
  VisualStoryRepository: jest.fn().mockImplementation(() => ({ addSpend, putCandidate })),
}));

import { generateStill } from '@/services/video/image-shot';

beforeEach(() => jest.clearAllMocks());

it('writes the image to the visual-story prefix and records a candidate', async () => {
  const r = await generateStill({ vsId: 'vs_1_a', sceneOrder: 0, shotOrder: 1, prompt: 'a village path' });
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.candidate.s3Key).toMatch(/^visual-story\/vs_1_a\/candidates\//);
    expect(r.candidate.providerId).toBe('openai-image');
    // A STILL is synchronous — it never creates a job or enters VSTORY_INFLIGHT.
    expect(r.candidate.providerTaskId).toBeNull();
    expect(r.candidate.jobId).toBeNull();
  }
});

it('counts the still against the story budget', async () => {
  await generateStill({ vsId: 'vs_1_a', sceneOrder: 0, shotOrder: 1, prompt: 'x' });
  expect(addSpend).toHaveBeenCalledWith('vs_1_a', expect.any(Number));
});

it('classifies an upstream image failure and spends nothing', async () => {
  generateCoverArt.mockResolvedValueOnce({ ok: false, error: 'model refused' } as never);
  const r = await generateStill({ vsId: 'vs_1_a', sceneOrder: 0, shotOrder: 1, prompt: 'x' });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe('upstream');
  expect(addSpend).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test npx jest __tests__/services/video/image-shot.test.ts`
Expected: FAIL — `Cannot find module '@/services/video/image-shot'`

- [ ] **Step 3: Write the implementation**

```ts
/**
 * STILL mode — a single frame, generated by the image path the app already has.
 *
 * Deliberately does NOT go through VideoGenerationProvider. A still is
 * synchronous and completes inside the request, so it creates no GENJOB row and
 * never enters the VSTORY_INFLIGHT partition. That is what lets Phase 3 be a
 * complete storyboarding tool with no video provider wired.
 */
import { generateCoverArt } from '@/services/ai/cover-art';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { estimateCostUsd } from '@/services/video/cost';
import type { Candidate } from '@/types/visualStory';
import type { VideoErrorCode } from '@/services/video/providers/types';

export const IMAGE_PROVIDER_ID = 'openai-image';

export async function generateStill(opts: {
  vsId: string; sceneOrder: number; shotOrder: number; prompt: string;
}): Promise<{ ok: true; candidate: Candidate } | { ok: false; code: VideoErrorCode; error: string }> {
  const art = await generateCoverArt(opts.prompt);
  if (!art.ok) return { ok: false, code: 'upstream', error: art.error };

  const candId = `cd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const s3Key = `visual-story/${opts.vsId}/candidates/${candId}.png`;
  await S3Operations.uploadFile({
    key: s3Key,
    file: Buffer.from(art.base64, 'base64'),
    contentType: 'image/png',
  });

  const costUsd = estimateCostUsd(IMAGE_PROVIDER_ID, 'STILL', 0);

  const candidate: Candidate = {
    candId,
    sceneOrder: opts.sceneOrder,
    shotOrder: opts.shotOrder,
    jobId: null,
    providerId: IMAGE_PROVIDER_ID,
    providerTaskId: null,
    s3Key,
    posterKey: null,
    costUsd,
    createdAt: new Date().toISOString(),
  };

  const repo = new VisualStoryRepository();
  await repo.putCandidate(opts.vsId, candidate);
  await repo.addSpend(opts.vsId, costUsd);

  return { ok: true, candidate };
}
```

> One extra edit belongs to this task: add an `openai-image` entry to `RATE_CARDS` in `src/services/video/cost.ts` with all three modes present (only STILL is reachable, but Task 2's test asserts every provider carries a full card):
>
> ```ts
>   'openai-image': {
>     STILL: { flatUsd: 0.04, perSecondUsd: 0 },
>     MOTION: { flatUsd: 0, perSecondUsd: 0 },
>     HERO: { flatUsd: 0, perSecondUsd: 0 },
>   },
> ```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test npx jest __tests__/services/video/image-shot.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/video/image-shot.ts src/services/video/cost.ts src/infrastructure/database/VisualStoryRepository.ts src/app/api/admin/visual-story __tests__/services/video/image-shot.test.ts
git commit -m "feat(visual-story): STILL mode via the existing cover-art image path"
```

---

### Task 9: Admin list page and navigation

**Files:**
- Create: `src/app/(admin)/admin/visual-story/page.tsx`, `src/components/admin/visual-story/VisualStoryList.tsx`
- Modify: `src/app/(admin)/AdminLayoutClient.tsx` (the `PAGE_TITLES` map)
- Test: `__tests__/components/admin/VisualStoryList.test.tsx`

**Interfaces:**
- Consumes: `adminFetch` from `@/lib/client-auth`; the `GET /api/admin/visual-story` contract from Task 6.
- Produces: `<VisualStoryList />`, a client component.

- [ ] **Step 1: Write the failing test**

```tsx
/** @jest-environment jsdom */
jest.mock('@/lib/client-auth', () => ({
  adminFetch: jest.fn(async () => new Response(JSON.stringify({
    success: true,
    stories: [
      { vsId: 'vs_1_a', contentId: 'cnt_9', title: 'Anjukame treatment', status: 'DRAFT', spentUsd: 0.25, budgetUsdCap: 5 },
    ],
  }), { status: 200 })),
}));

import { render, screen, waitFor } from '@testing-library/react';
import { VisualStoryList } from '@/components/admin/visual-story/VisualStoryList';

it('lists stories with their spend against cap', async () => {
  render(<VisualStoryList />);
  await waitFor(() => expect(screen.getByText('Anjukame treatment')).toBeInTheDocument());
  expect(screen.getByText(/\$0\.25/)).toBeInTheDocument();
  expect(screen.getByText(/\$5/)).toBeInTheDocument();
});

it('shows an empty state rather than a blank panel', async () => {
  const { adminFetch } = jest.requireMock('@/lib/client-auth');
  (adminFetch as jest.Mock).mockResolvedValueOnce(
    new Response(JSON.stringify({ success: true, stories: [] }), { status: 200 })
  );
  render(<VisualStoryList />);
  await waitFor(() => expect(screen.getByText(/no visual stories/i)).toBeInTheDocument());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test npx jest __tests__/components/admin/VisualStoryList.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the component, page and nav entry**

`src/components/admin/visual-story/VisualStoryList.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { adminFetch } from '@/lib/client-auth';

interface Row {
  vsId: string; contentId: string; title: string; status: string;
  spentUsd: number; budgetUsdCap: number;
}

export function VisualStoryList() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch('/api/admin/visual-story');
        const body = await res.json();
        if (!cancelled) setRows(body.stories ?? []);
      } catch {
        if (!cancelled) setError('Could not load visual stories.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (rows === null) return <p className="text-sm text-gray-500">Loading…</p>;
  if (rows.length === 0) {
    return <p className="text-sm text-gray-500">No visual stories yet. Start one from a content record.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
          <th className="py-2">Title</th><th>Status</th><th>Spend</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.vsId} className="border-t border-gray-100">
            <td className="py-2">
              <Link className="text-purple-700 hover:underline" href={`/admin/visual-story/${r.vsId}`}>
                {r.title}
              </Link>
            </td>
            <td>{r.status}</td>
            <td>${r.spentUsd.toFixed(2)} / ${r.budgetUsdCap}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

`src/app/(admin)/admin/visual-story/page.tsx`:

```tsx
import { VisualStoryList } from '@/components/admin/visual-story/VisualStoryList';

export default function VisualStoryPage() {
  return (
    <div className="space-y-6">
      <VisualStoryList />
    </div>
  );
}
```

In `src/app/(admin)/AdminLayoutClient.tsx`, add to `PAGE_TITLES`, grouped with the creative tools:

```ts
  "/admin/visual-story": {
    title: "Visual Story",
    subtitle: "Storyboard a song or story into scenes, shots and generated visuals",
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test npx jest __tests__/components/admin/VisualStoryList.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/\(admin\)/admin/visual-story src/components/admin/visual-story src/app/\(admin\)/AdminLayoutClient.tsx __tests__/components/admin/VisualStoryList.test.tsx
git commit -m "feat(visual-story): admin list page and nav entry"
```

---

### Task 10: The studio page

**Files:**
- Create: `src/app/(admin)/admin/visual-story/[vsId]/page.tsx`, `src/components/admin/visual-story/StudioBoard.tsx`
- Modify: `src/app/(admin)/AdminLayoutClient.tsx` (`PAGE_TITLES` entry for the detail route)
- Test: `__tests__/components/admin/StudioBoard.test.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/visual-story/[vsId]` (Task 6), the child POST routes (Task 7), `generateStill` via `POST .../still` (Task 8).
- Produces: `<StudioBoard vsId={string} />`.

- [ ] **Step 1: Write the failing test**

```tsx
/** @jest-environment jsdom */
const tree = {
  success: true,
  story: { vsId: 'vs_1_a', title: 'T', status: 'DRAFT', spentUsd: 0, budgetUsdCap: 5, aspectRatio: '16:9' },
  scenes: [{ order: 0, heading: 'Opening', summary: '', tamilText: '' }],
  shots: [{ sceneOrder: 0, shotOrder: 0, mode: 'STILL', durationSec: 5, visualPrompt: 'village path', negativePrompt: '', charIds: [], selectedCandidateId: null }],
  characters: [{ charId: 'ch1', name: 'Mother', description: '', refImageKeys: [], createdAt: 'now' }],
  candidates: [], jobs: [],
};

jest.mock('@/lib/client-auth', () => ({
  adminFetch: jest.fn(async () => new Response(JSON.stringify(tree), { status: 200 })),
}));

import { render, screen, waitFor } from '@testing-library/react';
import { StudioBoard } from '@/components/admin/visual-story/StudioBoard';

it('renders the scene rail, the shot grid and the character panel', async () => {
  render(<StudioBoard vsId="vs_1_a" />);
  await waitFor(() => expect(screen.getByText('Opening')).toBeInTheDocument());
  expect(screen.getByText('village path')).toBeInTheDocument();
  expect(screen.getByText('Mother')).toBeInTheDocument();
});

it('shows the mode badge so the cost tier of every shot is visible at a glance', async () => {
  render(<StudioBoard vsId="vs_1_a" />);
  await waitFor(() => expect(screen.getByText('STILL')).toBeInTheDocument());
});

it('shows running spend against the cap', async () => {
  render(<StudioBoard vsId="vs_1_a" />);
  await waitFor(() => expect(screen.getByText(/\$0\.00 \/ \$5/)).toBeInTheDocument());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test npx jest __tests__/components/admin/StudioBoard.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the component and page**

`src/components/admin/visual-story/StudioBoard.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import type { VisualStory, Scene, Shot, CharacterRef, Candidate } from '@/types/visualStory';

interface Tree {
  story: VisualStory | null; scenes: Scene[]; shots: Shot[];
  characters: CharacterRef[]; candidates: Candidate[];
}

export function StudioBoard({ vsId }: { vsId: string }) {
  const [tree, setTree] = useState<Tree | null>(null);
  const [sceneOrder, setSceneOrder] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await adminFetch(`/api/admin/visual-story/${vsId}`);
      const body = await res.json();
      if (!cancelled) setTree(body);
    })();
    return () => { cancelled = true; };
  }, [vsId]);

  if (!tree?.story) return <p className="text-sm text-gray-500">Loading…</p>;
  const shots = tree.shots.filter((s) => s.sceneOrder === sceneOrder);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[12rem_1fr_16rem]">
      {/* Scene rail */}
      <nav className="space-y-1">
        {tree.scenes.map((s) => (
          <button
            key={s.order}
            onClick={() => setSceneOrder(s.order)}
            className={`block w-full rounded px-2 py-1 text-left text-sm ${
              s.order === sceneOrder ? 'bg-purple-50 text-purple-800' : 'text-gray-700'
            }`}
          >
            {s.heading || `Scene ${s.order}`}
          </button>
        ))}
      </nav>

      {/* Shot grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {shots.map((sh) => (
          <article key={`${sh.sceneOrder}-${sh.shotOrder}`} className="rounded-lg border border-gray-200 p-3">
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-semibold">{sh.mode}</span>
            <p className="mt-2 text-sm text-gray-800">{sh.visualPrompt}</p>
          </article>
        ))}
      </div>

      {/* Characters + spend */}
      <aside className="space-y-4">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Characters</h2>
          <ul className="mt-1 space-y-1 text-sm">
            {tree.characters.map((c) => <li key={c.charId}>{c.name}</li>)}
          </ul>
        </div>
        <p className="text-sm text-gray-600">
          ${tree.story.spentUsd.toFixed(2)} / ${tree.story.budgetUsdCap}
        </p>
      </aside>
    </div>
  );
}
```

`src/app/(admin)/admin/visual-story/[vsId]/page.tsx`:

```tsx
import { StudioBoard } from '@/components/admin/visual-story/StudioBoard';

export default async function VisualStoryDetailPage({ params }: { params: Promise<{ vsId: string }> }) {
  const { vsId } = await params;
  return <StudioBoard vsId={vsId} />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test npx jest __tests__/components/admin/StudioBoard.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the FULL suite — it is the deploy gate**

Run: `NODE_ENV=test npx jest --ci`
Expected: all suites pass. Also run `npx tsc --noEmit` and `npx eslint src/ __tests__/`.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(admin\)/admin/visual-story src/components/admin/visual-story __tests__/components/admin/StudioBoard.test.tsx
git commit -m "feat(visual-story): the studio board — scene rail, shot grid, characters, spend"
```

---

## What Phases 2–3 deliberately leave out

These belong to the Phase 4–6 plan, written once the BytePlus API reference arrives:

- `SeedanceProvider`, `src/services/video/credentials.ts` (runtime SSM), MOTION and HERO modes
- `POST .../generate`, `GET .../jobs/[jobId]`, `POST .../jobs/[jobId]/cancel`, `POST .../reconcile`
- The `VSTORY_INFLIGHT` sparse-partition sweep (button-only — never on page load, per the 2026-09-12 decision)
- Candidate review UI and `POST .../select`
- `GET .../timeline` export
- `DELETE /api/admin/visual-story/[vsId]`, scene/shot reordering, and the "New from content" picker
