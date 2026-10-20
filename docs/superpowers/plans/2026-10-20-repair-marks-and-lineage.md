# Repair Marks and Version Lineage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the saved-master player's marks (moments and spans, with Open/Fixed/Won't-fix status) and record which master a new master was derived from.

**Architecture:** Marks are one DynamoDB item each at `PK=MARKS#<masterJobId>`, `SK=MARK#<markId>`, behind four admin routes, with optimistic `version` checks. Lineage is an optional `derivedFrom` field written once on `MASTERJOB#` at creation, verified by the master route against the parent job and its stem set. The player gains a persisted marks panel and a "From the previous version" panel. Web app only; the worker is untouched.

**Tech Stack:** Next.js 15 route handlers, TypeScript, zod-free hand validation (pure module), DynamoDB via `DynamoDBOperations`, React client components with `adminFetch`, jest (+ @testing-library/react for components).

**Spec:** `docs/superpowers/specs/2026-10-20-repair-marks-and-lineage-design.md`

## Global Constraints

- No worker change; no worker deploy. The worker never reads or writes `derivedFrom`.
- No migration. `derivedFrom` is optional on `MasterJob`; old rows hydrate to `null`.
- Writing a mark never touches the `MASTERJOB#` item (its `updatedAt` feeds the YouTube upload guard).
- Marks attach to **saved** masters only (`savedAt` set).
- `reason` uses the existing `FAILURE_REASONS` vocabulary unchanged.
- Limits: 500 marks per master; `note` ≤ 500 characters.
- Status values exactly: `'open' | 'fixed' | 'wont-fix'`.
- Lineage `via` values exactly: `'re-master' | 'stem-remix'`.
- Every admin mutation route calls `requireAdmin` AND `requireBearer` (enforced by `__tests__/api/admin-auth-coverage.test.ts`).
- A save that fails renders its error **in that mark's row**.
- When the master route gets no `derivedFrom`, the `create()` input and the worker payload stay byte-identical to today.
- No FastAPI, always-on servers, GPU, compression or exportable EQ.
- Run locally with `NODE_OPTIONS=--no-experimental-strip-types` (Node 22 on the dev box; CI uses Node 20 and needs nothing).

## Review Focus

1. **Several marks dropped in quick succession (M, M, M)** — each gets its own pending row and its own saved item; none overwrites another. Pinned in Task 6.
2. **The same mark edited in two tabs** — the second save gets 409, the list reloads and says so; nothing is silently overwritten. Pinned in Tasks 2, 3 and 6.
3. **A child version trimmed differently from its parent** — parent marks show the PARENT's times in their own list and are never drawn on the child's waveform; "Still there" copies the time as-is for Raj to adjust. Pinned in Task 7.
4. **A `?source=…&parent=…` link followed while a recovered job is in progress** — the recovered job wins and no parent is attached to it. Pinned in Task 5.
5. **A master whose duration is unknown (`source` null, no `editedDurationSec`)** — marks are still accepted; only the duration bound is skipped. Pinned in Task 1.

---

### Task 1: Pure mark rules (`repair-marks.ts`)

**Files:**
- Create: `src/lib/repair-marks.ts`
- Test: `__tests__/lib/repair-marks.test.ts`

**Interfaces:**
- Consumes: `FAILURE_REASONS` from `@/types/generation`; `formatMarkTime`, `reasonLabel`, `type MarkReason` from `@/lib/audition-marks`.
- Produces:
  - `MARK_STATUSES`, `type MarkStatus`, `MAX_MARKS_PER_MASTER = 500`, `MAX_NOTE_CHARS = 500`
  - `interface RepairMark { markId; masterJobId; start: number; end: number | null; reason: MarkReason; note: string; status: MarkStatus; fixedIn: string | null; version: number; createdAt: string; updatedAt: string }`
  - `interface NewMarkInput { start: number; end: number | null; reason: MarkReason; note: string }`
  - `type MarkPatch = Partial<{ start: number; end: number | null; reason: MarkReason; note: string; status: MarkStatus; fixedIn: string | null }>`
  - `parseNewMark(body: unknown, durationSec: number | null): { ok: true; value: NewMarkInput } | { ok: false; error: string }`
  - `parseMarkPatch(body: unknown, current: RepairMark, durationSec: number | null): { ok: true; version: number; patch: MarkPatch } | { ok: false; error: string }`
  - `sortMarks(marks: RepairMark[]): RepairMark[]`
  - `parentMarksView(marks: RepairMark[]): RepairMark[]`
  - `markTimeLabel(m: Pick<RepairMark, 'start' | 'end'>): string`
  - `statusLabel(s: MarkStatus): string`
  - `repairMarksToText(marks: RepairMark[], title?: string): string`
  - `masterDurationSec(job: { editedDurationSec?: number | null; source?: { durationSec?: number | null } | null }): number | null`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/repair-marks.test.ts
import {
  parseNewMark, parseMarkPatch, sortMarks, parentMarksView, markTimeLabel,
  repairMarksToText, masterDurationSec, MAX_NOTE_CHARS, type RepairMark,
} from '@/lib/repair-marks';

const mark = (over: Partial<RepairMark> = {}): RepairMark => ({
  markId: 'm1', masterJobId: 'job1', start: 102, end: null, reason: 'pronunciation',
  note: '', status: 'open', fixedIn: null, version: 1,
  createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z', ...over,
});

describe('parseNewMark', () => {
  it('accepts a moment and defaults note to empty', () => {
    expect(parseNewMark({ start: 102, reason: 'pronunciation' }, 300))
      .toEqual({ ok: true, value: { start: 102, end: null, reason: 'pronunciation', note: '' } });
  });
  it('accepts a span', () => {
    const r = parseNewMark({ start: 102, end: 109.5, reason: 'melody', note: 'ழ sung as ல' }, 300);
    expect(r).toEqual({ ok: true, value: { start: 102, end: 109.5, reason: 'melody', note: 'ழ sung as ல' } });
  });
  it.each([
    [{ start: -1, reason: 'melody' }],
    [{ start: 'x', reason: 'melody' }],
    [{ start: 10, end: 10, reason: 'melody' }],
    [{ start: 10, end: 5, reason: 'melody' }],
    [{ start: 10, reason: 'not-a-reason' }],
    [{ start: 10, reason: 'melody', note: 'x'.repeat(MAX_NOTE_CHARS + 1) }],
    [null],
  ])('refuses %j', (body) => {
    expect(parseNewMark(body, 300).ok).toBe(false);
  });
  it('refuses a mark past the end of a master whose duration is known', () => {
    expect(parseNewMark({ start: 301, reason: 'melody' }, 300).ok).toBe(false);
    expect(parseNewMark({ start: 290, end: 302, reason: 'melody' }, 300).ok).toBe(false);
  });
  it('allows half a second of slack at the end (the player and the probe round differently)', () => {
    expect(parseNewMark({ start: 300.3, reason: 'melody' }, 300).ok).toBe(true);
  });
  it('skips only the duration bound when the duration is unknown', () => {
    expect(parseNewMark({ start: 9999, reason: 'melody' }, null).ok).toBe(true);
    expect(parseNewMark({ start: 10, end: 5, reason: 'melody' }, null).ok).toBe(false);
  });
});

describe('parseMarkPatch', () => {
  it('needs the version the client last saw', () => {
    expect(parseMarkPatch({ status: 'fixed' }, mark(), 300).ok).toBe(false);
  });
  it('accepts status, note and fixedIn', () => {
    expect(parseMarkPatch({ version: 1, status: 'fixed', fixedIn: 'child1', note: 'ok now' }, mark(), 300))
      .toEqual({ ok: true, version: 1, patch: { status: 'fixed', fixedIn: 'child1', note: 'ok now' } });
  });
  it('validates the merged span, not the patch alone', () => {
    // current is a moment at 102; setting end 100 makes end < start
    expect(parseMarkPatch({ version: 1, end: 100 }, mark(), 300).ok).toBe(false);
    expect(parseMarkPatch({ version: 1, end: 110 }, mark(), 300).ok).toBe(true);
  });
  it('refuses an unknown status and a bad fixedIn', () => {
    expect(parseMarkPatch({ version: 1, status: 'done' }, mark(), 300).ok).toBe(false);
    expect(parseMarkPatch({ version: 1, fixedIn: '../x' }, mark(), 300).ok).toBe(false);
  });
  it('refuses an empty patch', () => {
    expect(parseMarkPatch({ version: 1 }, mark(), 300).ok).toBe(false);
  });
});

describe('ordering and views', () => {
  it('sorts by start, then by creation', () => {
    const a = mark({ markId: 'a', start: 50, createdAt: '2026-10-20T00:00:02.000Z' });
    const b = mark({ markId: 'b', start: 50, createdAt: '2026-10-20T00:00:01.000Z' });
    const c = mark({ markId: 'c', start: 10 });
    expect(sortMarks([a, b, c]).map((m) => m.markId)).toEqual(['c', 'b', 'a']);
  });
  it('puts open parent marks first', () => {
    const fixed = mark({ markId: 'f', start: 1, status: 'fixed' });
    const open = mark({ markId: 'o', start: 99 });
    expect(parentMarksView([fixed, open]).map((m) => m.markId)).toEqual(['o', 'f']);
  });
});

describe('labels and text', () => {
  it('labels a moment and a span', () => {
    expect(markTimeLabel({ start: 102, end: null })).toBe('1:42');
    expect(markTimeLabel({ start: 102, end: 109 })).toBe('1:42–1:49');
  });
  it('writes status only when not open', () => {
    const text = repairMarksToText([
      mark({ start: 102, note: 'ழ' }),
      mark({ markId: 'm2', start: 120, end: 125, reason: 'melody', status: 'fixed' }),
    ], 'பாடல்');
    expect(text).toBe('பாடல்\n1:42 — pronunciation: ழ\n2:00–2:05 — melody [Fixed]');
  });
});

describe('masterDurationSec', () => {
  it('prefers the edited duration, then the source, else null', () => {
    expect(masterDurationSec({ editedDurationSec: 200, source: { durationSec: 300 } })).toBe(200);
    expect(masterDurationSec({ editedDurationSec: null, source: { durationSec: 300 } })).toBe(300);
    expect(masterDurationSec({ editedDurationSec: null, source: null })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--no-experimental-strip-types npx jest __tests__/lib/repair-marks.test.ts`
Expected: FAIL — `Cannot find module '@/lib/repair-marks'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/repair-marks.ts
/**
 * Repair marks — the persisted form of the player's audition marks.
 *
 * A mark belongs to ONE saved master (a version): its times are seconds into
 * that master, which a re-master with a different trim or a remix would move.
 * See docs/superpowers/specs/2026-10-20-repair-marks-and-lineage-design.md.
 *
 * Pure: validation, ordering and text. Persistence is MarkRepository.
 */
import { FAILURE_REASONS } from '@/types/generation';
import { formatMarkTime, reasonLabel, type MarkReason } from '@/lib/audition-marks';

export const MARK_STATUSES = ['open', 'fixed', 'wont-fix'] as const;
export type MarkStatus = (typeof MARK_STATUSES)[number];
export const MAX_MARKS_PER_MASTER = 500;
export const MAX_NOTE_CHARS = 500;
/** The player's duration and the probe's round differently; a mark at the very end must not be refused. */
const END_SLACK_SEC = 0.5;

export interface RepairMark {
  markId: string;
  masterJobId: string;
  start: number;
  end: number | null;
  reason: MarkReason;
  note: string;
  status: MarkStatus;
  fixedIn: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface NewMarkInput {
  start: number;
  end: number | null;
  reason: MarkReason;
  note: string;
}

export type MarkPatch = Partial<{
  start: number;
  end: number | null;
  reason: MarkReason;
  note: string;
  status: MarkStatus;
  fixedIn: string | null;
}>;

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });

const isReason = (r: unknown): r is MarkReason =>
  typeof r === 'string' && (FAILURE_REASONS as readonly string[]).includes(r);
const isStatus = (s: unknown): s is MarkStatus =>
  typeof s === 'string' && (MARK_STATUSES as readonly string[]).includes(s);
const isId = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(s);

function checkSpan(start: unknown, end: unknown, durationSec: number | null): string | null {
  if (typeof start !== 'number' || !Number.isFinite(start) || start < 0) return 'start must be a time in seconds';
  if (end !== null && (typeof end !== 'number' || !Number.isFinite(end) || end <= start)) {
    return 'end must be after start';
  }
  if (durationSec !== null) {
    const limit = durationSec + END_SLACK_SEC;
    if (start > limit || (end !== null && (end as number) > limit)) return 'that time is past the end of this master';
  }
  return null;
}

function checkNote(note: unknown): string | null {
  if (typeof note !== 'string') return 'note must be text';
  if (note.length > MAX_NOTE_CHARS) return `note is limited to ${MAX_NOTE_CHARS} characters`;
  return null;
}

export function parseNewMark(
  body: unknown,
  durationSec: number | null
): { ok: true; value: NewMarkInput } | Fail {
  if (!body || typeof body !== 'object') return fail('a mark is required');
  const b = body as Record<string, unknown>;
  const end = b.end === undefined ? null : b.end;
  const spanError = checkSpan(b.start, end, durationSec);
  if (spanError) return fail(spanError);
  if (!isReason(b.reason)) return fail('unknown reason');
  const note = b.note === undefined ? '' : b.note;
  const noteError = checkNote(note);
  if (noteError) return fail(noteError);
  return { ok: true, value: { start: b.start as number, end: end as number | null, reason: b.reason, note: note as string } };
}

export function parseMarkPatch(
  body: unknown,
  current: RepairMark,
  durationSec: number | null
): { ok: true; version: number; patch: MarkPatch } | Fail {
  if (!body || typeof body !== 'object') return fail('a change is required');
  const b = body as Record<string, unknown>;
  if (typeof b.version !== 'number' || !Number.isInteger(b.version)) return fail('version is required');
  const patch: MarkPatch = {};
  if (b.start !== undefined) patch.start = b.start as number;
  if (b.end !== undefined) patch.end = b.end as number | null;
  if (b.reason !== undefined) {
    if (!isReason(b.reason)) return fail('unknown reason');
    patch.reason = b.reason;
  }
  if (b.note !== undefined) {
    const noteError = checkNote(b.note);
    if (noteError) return fail(noteError);
    patch.note = b.note as string;
  }
  if (b.status !== undefined) {
    if (!isStatus(b.status)) return fail('unknown status');
    patch.status = b.status;
  }
  if (b.fixedIn !== undefined) {
    if (b.fixedIn !== null && !isId(b.fixedIn)) return fail('fixedIn must be a master id');
    patch.fixedIn = b.fixedIn as string | null;
  }
  if (Object.keys(patch).length === 0) return fail('nothing to change');
  const start = patch.start ?? current.start;
  const end = patch.end !== undefined ? patch.end : current.end;
  const spanError = checkSpan(start, end, durationSec);
  if (spanError) return fail(spanError);
  return { ok: true, version: b.version, patch };
}

export function sortMarks(marks: RepairMark[]): RepairMark[] {
  return [...marks].sort((a, b) => a.start - b.start || a.createdAt.localeCompare(b.createdAt));
}

/** A child version reads its parent's list to tick off fixes: open ones first. */
export function parentMarksView(marks: RepairMark[]): RepairMark[] {
  const sorted = sortMarks(marks);
  return [...sorted.filter((m) => m.status === 'open'), ...sorted.filter((m) => m.status !== 'open')];
}

export function markTimeLabel(m: Pick<RepairMark, 'start' | 'end'>): string {
  return m.end === null ? formatMarkTime(m.start) : `${formatMarkTime(m.start)}–${formatMarkTime(m.end)}`;
}

export function statusLabel(s: MarkStatus): string {
  return s === 'open' ? 'Open' : s === 'fixed' ? 'Fixed' : "Won't fix";
}

export function repairMarksToText(marks: RepairMark[], title?: string): string {
  if (!marks.length) return '';
  const head = title ? `${title}\n` : '';
  return (
    head +
    sortMarks(marks)
      .map((m) =>
        `${markTimeLabel(m)} — ${reasonLabel(m.reason)}` +
        (m.status !== 'open' ? ` [${statusLabel(m.status)}]` : '') +
        (m.note ? `: ${m.note}` : '')
      )
      .join('\n')
  );
}

/** What a mark's times are bounded by: the edited length if the master was trimmed, else the source's. */
export function masterDurationSec(job: {
  editedDurationSec?: number | null;
  source?: { durationSec?: number | null } | null;
}): number | null {
  if (typeof job.editedDurationSec === 'number') return job.editedDurationSec;
  if (typeof job.source?.durationSec === 'number') return job.source.durationSec;
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--no-experimental-strip-types npx jest __tests__/lib/repair-marks.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/lib/repair-marks.ts __tests__/lib/repair-marks.test.ts
git commit -m "feat(marks): pure rules for repair marks — moments, spans, status, text"
```

---

### Task 2: `MarkRepository`

**Files:**
- Create: `src/infrastructure/database/MarkRepository.ts`
- Test: `__tests__/infrastructure/MarkRepository.test.ts`

**Interfaces:**
- Consumes: `RepairMark`, `NewMarkInput`, `MarkPatch`, `sortMarks`, `MARK_STATUSES` from Task 1; `DynamoDBOperations.{query,get,update,delete}`, `handleDynamoDBError` from `./dynamodb-client`.
- Produces:
  - `class StaleMarkError extends Error` (`name === 'StaleMarkError'`)
  - `class MarkRepository { list(masterJobId): Promise<RepairMark[]>; get(masterJobId, markId): Promise<RepairMark | null>; create(masterJobId, input: NewMarkInput): Promise<RepairMark>; update(masterJobId, markId, expectedVersion: number, patch: MarkPatch): Promise<RepairMark>; delete(masterJobId, markId): Promise<void> }`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/infrastructure/MarkRepository.test.ts
const mockQuery = jest.fn();
const mockGet = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: {
    query: (...a: unknown[]) => mockQuery(...a),
    get: (...a: unknown[]) => mockGet(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
    delete: (...a: unknown[]) => mockDelete(...a),
  },
  handleDynamoDBError: (e: unknown) => { throw e; },
}));

import { MarkRepository, StaleMarkError } from '@/infrastructure/database/MarkRepository';

const JOB = '0b5e2c1a-1111-4222-8333-444455556666';
const repo = new MarkRepository();
const item = (over: Record<string, unknown> = {}) => ({
  PK: `MARKS#${JOB}`, SK: 'MARK#m1', Type: 'MASTERMARK', markId: 'm1', masterJobId: JOB,
  start: 102, end: null, reason: 'pronunciation', note: '', status: 'open', fixedIn: null,
  version: 1, createdAt: 't1', updatedAt: 't1', ...over,
});

beforeEach(() => { mockQuery.mockReset(); mockGet.mockReset(); mockUpdate.mockReset(); mockDelete.mockReset(); });

it('lists one master\'s marks, sorted, across pages', async () => {
  mockQuery
    .mockResolvedValueOnce({ Items: [item({ markId: 'b', start: 50 })], LastEvaluatedKey: { k: 1 } })
    .mockResolvedValueOnce({ Items: [item({ markId: 'a', start: 10 })] });
  const marks = await repo.list(JOB);
  expect(marks.map((m) => m.markId)).toEqual(['a', 'b']);
  expect(mockQuery.mock.calls[0][0]).toMatchObject({
    keyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    expressionAttributeValues: { ':pk': `MARKS#${JOB}`, ':sk': 'MARK#' },
  });
  expect(mockQuery.mock.calls[1][0].exclusiveStartKey).toEqual({ k: 1 });
});

it('drops a malformed row rather than hand the page a mark with no time', async () => {
  mockQuery.mockResolvedValueOnce({ Items: [item(), item({ markId: 'bad', start: 'x' })] });
  expect((await repo.list(JOB)).map((m) => m.markId)).toEqual(['m1']);
});

it('creates with a condition so an id collision can never overwrite', async () => {
  mockUpdate.mockImplementation(async (p: { expressionAttributeValues: Record<string, unknown> }) => ({
    ...item(), markId: p.expressionAttributeValues[':markId'],
  }));
  const m = await repo.create(JOB, { start: 102, end: null, reason: 'pronunciation', note: '' });
  const call = mockUpdate.mock.calls[0][0];
  expect(call.key.PK).toBe(`MARKS#${JOB}`);
  expect(call.key.SK).toMatch(/^MARK#[0-9a-f-]{36}$/);
  expect(call.conditionExpression).toBe('attribute_not_exists(PK)');
  expect(call.expressionAttributeValues).toMatchObject({ ':status': 'open', ':version': 1, ':type': 'MASTERMARK' });
  expect(m.status).toBe('open');
});

it('two creates at once write two different items', async () => {
  mockUpdate.mockImplementation(async (p: { expressionAttributeValues: Record<string, unknown> }) => ({
    ...item(), markId: p.expressionAttributeValues[':markId'],
  }));
  const [a, b] = await Promise.all([
    repo.create(JOB, { start: 1, end: null, reason: 'melody', note: '' }),
    repo.create(JOB, { start: 1, end: null, reason: 'melody', note: '' }),
  ]);
  expect(a.markId).not.toBe(b.markId);
  expect(mockUpdate.mock.calls[0][0].key.SK).not.toBe(mockUpdate.mock.calls[1][0].key.SK);
});

it('updates only when the stored version matches, and bumps it', async () => {
  mockUpdate.mockResolvedValueOnce(item({ status: 'fixed', version: 2 }));
  const m = await repo.update(JOB, 'm1', 1, { status: 'fixed' });
  const call = mockUpdate.mock.calls[0][0];
  expect(call.conditionExpression).toBe('attribute_exists(PK) AND #version = :expected');
  expect(call.expressionAttributeValues).toMatchObject({ ':expected': 1, ':one': 1, ':status': 'fixed' });
  expect(call.updateExpression).toMatch(/#version = #version \+ :one/);
  expect(m.version).toBe(2);
});

it('turns a failed version check into StaleMarkError', async () => {
  mockUpdate.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'ConditionalCheckFailedException' }));
  await expect(repo.update(JOB, 'm1', 1, { note: 'x' })).rejects.toBeInstanceOf(StaleMarkError);
});

it('two edits carrying the same version: exactly one wins', async () => {
  mockUpdate
    .mockResolvedValueOnce(item({ version: 2, note: 'first' }))
    .mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'ConditionalCheckFailedException' }));
  const results = await Promise.allSettled([
    repo.update(JOB, 'm1', 1, { note: 'first' }),
    repo.update(JOB, 'm1', 1, { note: 'second' }),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  expect(rejected.reason).toBeInstanceOf(StaleMarkError);
});

it('never touches the MASTERJOB item', async () => {
  mockUpdate.mockResolvedValue(item());
  mockQuery.mockResolvedValue({ Items: [] });
  await repo.create(JOB, { start: 1, end: null, reason: 'melody', note: '' });
  await repo.update(JOB, 'm1', 1, { note: 'x' });
  await repo.list(JOB);
  for (const c of [...mockUpdate.mock.calls, ...mockQuery.mock.calls]) {
    expect(JSON.stringify(c[0])).not.toContain('MASTERJOB#');
  }
});

it('deletes by key', async () => {
  mockDelete.mockResolvedValueOnce({});
  await repo.delete(JOB, 'm1');
  expect(mockDelete).toHaveBeenCalledWith({ PK: `MARKS#${JOB}`, SK: 'MARK#m1' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--no-experimental-strip-types npx jest __tests__/infrastructure/MarkRepository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/infrastructure/database/MarkRepository.ts
/**
 * Repair marks: PK=MARKS#<masterJobId>, SK=MARK#<markId>, one item per mark.
 *
 * A SIBLING of the master's record, like STEMSET#: nothing here writes
 * MASTERJOB#, so a mark never moves the master's updatedAt (the YouTube upload
 * guard reads it). One item per mark means two tabs adding marks at once write
 * two items, and an edit carries the version it was based on, so a stale tab
 * is refused (StaleMarkError) instead of overwriting a newer edit.
 */
import { randomUUID } from 'node:crypto';
import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';
import {
  sortMarks, MARK_STATUSES, type RepairMark, type NewMarkInput, type MarkPatch, type MarkStatus,
} from '@/lib/repair-marks';
import type { MarkReason } from '@/lib/audition-marks';

export class StaleMarkError extends Error {
  constructor() {
    super('That mark was changed somewhere else.');
    this.name = 'StaleMarkError';
  }
}

const pk = (masterJobId: string) => `MARKS#${masterJobId}`;
const keyFor = (masterJobId: string, markId: string) => ({ PK: pk(masterJobId), SK: `MARK#${markId}` });

function hydrate(item: Record<string, unknown>): RepairMark | null {
  if (typeof item.markId !== 'string' || typeof item.start !== 'number' || !Number.isFinite(item.start)) return null;
  const status = (MARK_STATUSES as readonly string[]).includes(item.status as string)
    ? (item.status as MarkStatus)
    : 'open';
  return {
    markId: item.markId,
    masterJobId: String(item.masterJobId ?? ''),
    start: item.start,
    end: typeof item.end === 'number' ? item.end : null,
    reason: item.reason as MarkReason,
    note: typeof item.note === 'string' ? item.note : '',
    status,
    fixedIn: typeof item.fixedIn === 'string' ? item.fixedIn : null,
    version: typeof item.version === 'number' ? item.version : 1,
    createdAt: String(item.createdAt ?? ''),
    updatedAt: String(item.updatedAt ?? ''),
  };
}

const isConditionFailure = (e: unknown) =>
  (e as { name?: string } | null)?.name === 'ConditionalCheckFailedException';

export class MarkRepository {
  async list(masterJobId: string): Promise<RepairMark[]> {
    try {
      const out: RepairMark[] = [];
      let start: Record<string, unknown> | undefined;
      do {
        const res = await DynamoDBOperations.query({
          keyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          expressionAttributeValues: { ':pk': pk(masterJobId), ':sk': 'MARK#' },
          exclusiveStartKey: start,
        });
        for (const it of res.Items ?? []) {
          const m = hydrate(it as Record<string, unknown>);
          if (m) out.push(m);
        }
        start = res.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (start);
      return sortMarks(out);
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async get(masterJobId: string, markId: string): Promise<RepairMark | null> {
    try {
      const item = await DynamoDBOperations.get(keyFor(masterJobId, markId));
      return item ? hydrate(item as Record<string, unknown>) : null;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async create(masterJobId: string, input: NewMarkInput): Promise<RepairMark> {
    try {
      const markId = randomUUID();
      const now = new Date().toISOString();
      const attrs = await DynamoDBOperations.update({
        key: keyFor(masterJobId, markId),
        // An UpdateItem rather than a Put because DynamoDBOperations.put takes
        // no condition, and a create must never overwrite.
        updateExpression:
          'SET #type = :type, #markId = :markId, #masterJobId = :masterJobId, #start = :start, #end = :end, ' +
          '#reason = :reason, #note = :note, #status = :status, #fixedIn = :fixedIn, #version = :version, ' +
          '#createdAt = :now, #updatedAt = :now',
        conditionExpression: 'attribute_not_exists(PK)',
        expressionAttributeNames: {
          '#type': 'Type', '#markId': 'markId', '#masterJobId': 'masterJobId', '#start': 'start', '#end': 'end',
          '#reason': 'reason', '#note': 'note', '#status': 'status', '#fixedIn': 'fixedIn', '#version': 'version',
          '#createdAt': 'createdAt', '#updatedAt': 'updatedAt',
        },
        expressionAttributeValues: {
          ':type': 'MASTERMARK', ':markId': markId, ':masterJobId': masterJobId, ':start': input.start,
          ':end': input.end, ':reason': input.reason, ':note': input.note, ':status': 'open', ':fixedIn': null,
          ':version': 1, ':now': now,
        },
      });
      return hydrate((attrs ?? {}) as Record<string, unknown>) as RepairMark;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async update(masterJobId: string, markId: string, expectedVersion: number, patch: MarkPatch): Promise<RepairMark> {
    const names: Record<string, string> = { '#version': 'version', '#updatedAt': 'updatedAt' };
    const values: Record<string, unknown> = {
      ':expected': expectedVersion, ':one': 1, ':now': new Date().toISOString(),
    };
    const sets = ['#version = #version + :one', '#updatedAt = :now'];
    for (const [k, v] of Object.entries(patch)) {
      names[`#${k}`] = k;
      values[`:${k}`] = v;
      sets.push(`#${k} = :${k}`);
    }
    try {
      const attrs = await DynamoDBOperations.update({
        key: keyFor(masterJobId, markId),
        updateExpression: `SET ${sets.join(', ')}`,
        conditionExpression: 'attribute_exists(PK) AND #version = :expected',
        expressionAttributeNames: names,
        expressionAttributeValues: values,
      });
      return hydrate((attrs ?? {}) as Record<string, unknown>) as RepairMark;
    } catch (error) {
      if (isConditionFailure(error)) throw new StaleMarkError();
      handleDynamoDBError(error);
    }
  }

  async delete(masterJobId: string, markId: string): Promise<void> {
    try {
      await DynamoDBOperations.delete(keyFor(masterJobId, markId));
    } catch (error) {
      handleDynamoDBError(error);
    }
  }
}
```

Note: if `handleDynamoDBError` is typed as returning `void` rather than `never`, TypeScript will flag "not all code paths return a value". Check its signature (`grep -n "export function handleDynamoDBError" src/infrastructure/database/dynamodb-client.ts`); `StemSetRepository` uses the same `try { return … } catch (e) { handleDynamoDBError(e); }` shape, so it is `never` and this compiles.

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--no-experimental-strip-types npx jest __tests__/infrastructure/MarkRepository.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/database/MarkRepository.ts __tests__/infrastructure/MarkRepository.test.ts
git commit -m "feat(marks): MarkRepository — one item per mark, versioned updates"
```

---

### Task 3: `derivedFrom` on master jobs + lineage rules

**Files:**
- Modify: `src/types/masterJob.ts` (add `MasterLineage`, add `derivedFrom?` after `uploadError` at line ~321)
- Modify: `src/infrastructure/database/MasterJobRepository.ts` (`create` input + item; `hydrate`)
- Create: `src/lib/master-lineage.ts`
- Test: `__tests__/lib/master-lineage.test.ts`, `__tests__/infrastructure/MasterJobRepository.test.ts` (add cases)

**Interfaces:**
- Consumes: `StemMixEntry`, `StemSet` from `@/types/stemSet`; `MasterJob`.
- Produces:
  - in `src/types/masterJob.ts`: `export type LineageVia = 're-master' | 'stem-remix'; export interface MasterLineage { jobId: string; via: LineageVia; mixUsed?: Record<string, StemMixEntry> }` and `MasterJob.derivedFrom?: MasterLineage | null`
  - `MasterJobRepository.create(id, { …, derivedFrom?: MasterLineage })`
  - in `src/lib/master-lineage.ts`: `resolveLineage(parent, stemSet, s3Key): { ok: true; derivedFrom: MasterLineage } | { ok: false; code: 'bad-parent' | 'parent-mismatch'; error: string }`, `parseDerivedFrom(raw: unknown): MasterLineage | null`, `lineageLabel(d: MasterLineage, parentTitle: string | null): string`

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/lib/master-lineage.test.ts
import { resolveLineage, parseDerivedFrom, lineageLabel } from '@/lib/master-lineage';

const PARENT = { id: 'p1', savedAt: '2026-10-01T00:00:00.000Z', s3Key: 'audio/mastering/1_a_song.wav' };
const REMIX = 'audio/mastering/stems/p1/remix-1.wav';
const SET = { remix: { key: REMIX, renderedAt: 't', mixUsed: { s1: { gainDb: -3, muted: false } }, notes: [], error: null, requestedAt: null } };

describe('resolveLineage', () => {
  it('is a stem remix when the source is the parent\'s remix, and copies the mix it was made with', () => {
    expect(resolveLineage(PARENT, SET, REMIX)).toEqual({
      ok: true, derivedFrom: { jobId: 'p1', via: 'stem-remix', mixUsed: { s1: { gainDb: -3, muted: false } } },
    });
  });
  it('is a re-master when the source is the parent\'s own source', () => {
    expect(resolveLineage(PARENT, null, PARENT.s3Key)).toEqual({ ok: true, derivedFrom: { jobId: 'p1', via: 're-master' } });
  });
  it('refuses a missing or unsaved parent', () => {
    expect(resolveLineage(null, null, PARENT.s3Key)).toMatchObject({ ok: false, code: 'bad-parent' });
    expect(resolveLineage({ ...PARENT, savedAt: null }, null, PARENT.s3Key)).toMatchObject({ ok: false, code: 'bad-parent' });
  });
  it('refuses a source that is neither', () => {
    expect(resolveLineage(PARENT, SET, 'audio/mastering/9_other.wav')).toMatchObject({ ok: false, code: 'parent-mismatch' });
  });
});

describe('parseDerivedFrom', () => {
  it('reads a stored lineage and degrades anything else to null', () => {
    expect(parseDerivedFrom({ jobId: 'p1', via: 're-master' })).toEqual({ jobId: 'p1', via: 're-master' });
    expect(parseDerivedFrom({ jobId: 'p1', via: 'stem-remix', mixUsed: { s1: { gainDb: 0, muted: true } } }))
      .toEqual({ jobId: 'p1', via: 'stem-remix', mixUsed: { s1: { gainDb: 0, muted: true } } });
    expect(parseDerivedFrom(undefined)).toBeNull();
    expect(parseDerivedFrom({ jobId: 'p1', via: 'copy' })).toBeNull();
    expect(parseDerivedFrom({ via: 're-master' })).toBeNull();
  });
});

describe('lineageLabel', () => {
  it('names the parent, or says an earlier master when it is not loaded', () => {
    expect(lineageLabel({ jobId: 'p1', via: 'stem-remix' }, 'பாடல்')).toBe('Remix of பாடல்');
    expect(lineageLabel({ jobId: 'p1', via: 're-master' }, null)).toBe('Re-master of an earlier master');
  });
});
```

Add to `__tests__/infrastructure/MasterJobRepository.test.ts` (it already mocks `DynamoDBOperations.put`/`get` as `mockPut`/`mockGet` and has `repo`):

```ts
describe('lineage', () => {
  const lastPut = () => mockPut.mock.calls[mockPut.mock.calls.length - 1][0] as Record<string, unknown>;
  beforeEach(() => { mockPut.mockReset().mockResolvedValue({}); mockGet.mockReset(); });

  it('stores derivedFrom only when given, so ordinary jobs are unchanged', async () => {
    await repo.create('j1', { s3Key: 'audio/mastering/a.wav', target: -14 });
    expect(lastPut()).not.toHaveProperty('derivedFrom');
    await repo.create('j2', { s3Key: 'audio/mastering/a.wav', target: -14, derivedFrom: { jobId: 'p1', via: 're-master' } });
    expect(lastPut().derivedFrom).toEqual({ jobId: 'p1', via: 're-master' });
  });

  it('hydrates derivedFrom, null on an old row', async () => {
    mockGet.mockResolvedValueOnce({ id: 'j1', status: 'done', s3Key: 'audio/mastering/a.wav', target: -14 });
    expect((await repo.get('j1'))!.derivedFrom).toBeNull();
    mockGet.mockResolvedValueOnce({
      id: 'j2', status: 'done', s3Key: 'audio/mastering/a.wav', target: -14, derivedFrom: { jobId: 'p1', via: 'stem-remix' },
    });
    expect((await repo.get('j2'))!.derivedFrom).toEqual({ jobId: 'p1', via: 'stem-remix' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `NODE_OPTIONS=--no-experimental-strip-types npx jest __tests__/lib/master-lineage.test.ts __tests__/infrastructure/MasterJobRepository.test.ts`
Expected: FAIL — module not found; `derivedFrom` undefined.

- [ ] **Step 3: Implement**

In `src/types/masterJob.ts`, after the imports, add exactly:

```ts
import type { StemMixEntry } from '@/types/stemSet';

/** How a master came from another. See the 2026-10-20 repair-marks spec. */
export type LineageVia = 're-master' | 'stem-remix';

export interface MasterLineage {
  /** The parent saved master. */
  jobId: string;
  via: LineageVia;
  /** stem-remix only: the stem volumes the remix was rendered with, copied at job creation. */
  mixUsed?: Record<string, StemMixEntry>;
}
```

and in `interface MasterJob`, after `uploadError: string | null;`:

```ts
  /**
   * Which saved master this one was made from, written once at creation and
   * verified by the master route. Absent/null on every job written before
   * 2026-10-20, so every reader treats it as optional.
   */
  derivedFrom?: MasterLineage | null;
```

(If `src/types/stemSet.ts` imports from `masterJob.ts`, the type-only import is still safe; confirm with `grep -n "import" src/types/stemSet.ts`.)

```ts
// src/lib/master-lineage.ts
/**
 * Lineage: which saved master a new master was made from.
 *
 * The client CLAIMS a parent; this decides whether the claim is true and how
 * the child came from it. A master recorded against the wrong parent would
 * show the wrong marks forever, so an unverifiable claim is refused rather
 * than stored.
 */
import type { MasterJob, MasterLineage } from '@/types/masterJob';
import type { StemSet, StemMixEntry } from '@/types/stemSet';

type Parent = Pick<MasterJob, 'id' | 'savedAt' | 's3Key'>;

export function resolveLineage(
  parent: Parent | null,
  stemSet: Pick<StemSet, 'remix'> | null,
  s3Key: string
):
  | { ok: true; derivedFrom: MasterLineage }
  | { ok: false; code: 'bad-parent' | 'parent-mismatch'; error: string } {
  if (!parent || !parent.savedAt) {
    return { ok: false, code: 'bad-parent', error: 'The master this came from is not a saved master.' };
  }
  const remix = stemSet?.remix;
  if (remix?.key && remix.key === s3Key) {
    return {
      ok: true,
      derivedFrom: { jobId: parent.id, via: 'stem-remix', ...(remix.mixUsed ? { mixUsed: remix.mixUsed } : {}) },
    };
  }
  if (parent.s3Key === s3Key) return { ok: true, derivedFrom: { jobId: parent.id, via: 're-master' } };
  return {
    ok: false,
    code: 'parent-mismatch',
    error: "This file is neither that master's source nor its stem remix.",
  };
}

function isMix(raw: unknown): raw is Record<string, StemMixEntry> {
  if (!raw || typeof raw !== 'object') return false;
  return Object.values(raw as Record<string, unknown>).every(
    (e) =>
      !!e && typeof e === 'object' &&
      typeof (e as StemMixEntry).gainDb === 'number' && typeof (e as StemMixEntry).muted === 'boolean'
  );
}

export function parseDerivedFrom(raw: unknown): MasterLineage | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.jobId !== 'string' || (r.via !== 're-master' && r.via !== 'stem-remix')) return null;
  return { jobId: r.jobId, via: r.via, ...(isMix(r.mixUsed) ? { mixUsed: r.mixUsed } : {}) };
}

export function lineageLabel(d: MasterLineage, parentTitle: string | null): string {
  return `${d.via === 'stem-remix' ? 'Remix' : 'Re-master'} of ${parentTitle || 'an earlier master'}`;
}
```

In `MasterJobRepository.create`, add to the `input` type:

```ts
      /** Verified by the master route before it gets here. Absent → no lineage (every pre-2026-10-20 caller). */
      derivedFrom?: MasterLineage;
```

import `MasterLineage` from `@/types/masterJob`, and change the put to:

```ts
      await DynamoDBOperations.put({
        PK: `MASTERJOB#${id}`,
        SK: 'METADATA',
        Type: 'MASTERJOB',
        ttl: Math.floor(Date.now() / 1000) + TTL_SECONDS,
        ...job,
        // Only when given: an ordinary job's item stays exactly as before.
        ...(input.derivedFrom ? { derivedFrom: input.derivedFrom } : {}),
      });
      return input.derivedFrom ? { ...job, derivedFrom: input.derivedFrom } : job;
```

In `hydrate`, after the `uploadError` line add:

```ts
      derivedFrom: parseDerivedFrom(item.derivedFrom),
```

with `import { parseDerivedFrom } from '@/lib/master-lineage';`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `NODE_OPTIONS=--no-experimental-strip-types npx jest __tests__/lib/master-lineage.test.ts __tests__/infrastructure/MasterJobRepository.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/types/masterJob.ts src/lib/master-lineage.ts src/infrastructure/database/MasterJobRepository.ts __tests__/lib/master-lineage.test.ts __tests__/infrastructure/MasterJobRepository.test.ts
git commit -m "feat(lineage): derivedFrom on master jobs, verified lineage rules"
```

---

### Task 4: Routes — marks API and lineage on the master route

**Files:**
- Create: `src/app/api/admin/music-lab/master/[jobId]/marks/route.ts` (GET, POST)
- Create: `src/app/api/admin/music-lab/master/[jobId]/marks/[markId]/route.ts` (PATCH, DELETE)
- Modify: `src/app/api/admin/music-lab/master/route.ts` (accept + verify `derivedFrom`, lines ~205-215)
- Test: `__tests__/api/admin-master-marks.test.ts` (new), `__tests__/api/admin-music-lab-master-route.test.ts` (add `derivedFrom` cases)

**Interfaces:**
- Consumes: Task 1 (`parseNewMark`, `parseMarkPatch`, `masterDurationSec`, `MAX_MARKS_PER_MASTER`), Task 2 (`MarkRepository`, `StaleMarkError`), Task 3 (`resolveLineage`), `MasterJobRepository.get`, `StemSetRepository.get`, `isValidMasterJobId` from `@/lib/stems`, `requireAdmin`/`requireBearer`/`authErrorResponse`.
- Produces (HTTP):
  - `GET …/marks` → `{ success: true, marks: RepairMark[] }`
  - `POST …/marks` → 201 `{ success: true, mark }` | 400 | 404 | 409 `{ code: 'not-saved' | 'too-many' }`
  - `PATCH …/marks/[markId]` body `{ version, …patch }` → `{ success: true, mark }` | 400 (`code: 'bad-fixed-in'` for a non-child) | 404 | 409 `{ code: 'stale' }`
  - `DELETE …/marks/[markId]` → `{ success: true }` | 404
  - `POST /api/admin/music-lab/master` accepts `derivedFrom: { jobId }` → 400 `{ code: 'bad-parent' | 'parent-mismatch' }` or a job created with verified lineage.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/api/admin-master-marks.test.ts
/** @jest-environment node */
jest.mock('@/lib/auth-helper', () => ({
  requireAdmin: jest.fn().mockResolvedValue({}), requireBearer: jest.fn(),
  authErrorResponse: jest.fn(() => new Response('no', { status: 401 })),
}));
const masterGet = jest.fn();
jest.mock('@/infrastructure/database/MasterJobRepository', () => ({
  MasterJobRepository: jest.fn().mockImplementation(() => ({ get: masterGet })),
}));
const list = jest.fn(); const get = jest.fn(); const create = jest.fn(); const update = jest.fn(); const del = jest.fn();
jest.mock('@/infrastructure/database/MarkRepository', () => {
  class StaleMarkError extends Error { constructor() { super('stale'); this.name = 'StaleMarkError'; } }
  return {
    StaleMarkError,
    MarkRepository: jest.fn().mockImplementation(() => ({ list, get, create, update, delete: del })),
  };
});

import { GET, POST } from '@/app/api/admin/music-lab/master/[jobId]/marks/route';
import { PATCH, DELETE } from '@/app/api/admin/music-lab/master/[jobId]/marks/[markId]/route';
import { StaleMarkError } from '@/infrastructure/database/MarkRepository';
import { requireAdmin } from '@/lib/auth-helper';

const JOB = '0b5e2c1a-1111-4222-8333-444455556666';
const SAVED = { id: JOB, status: 'done', savedAt: '2026-10-01T00:00:00.000Z', editedDurationSec: null, source: { durationSec: 300 } };
const MARK = { markId: 'm1', masterJobId: JOB, start: 102, end: null, reason: 'pronunciation', note: '', status: 'open', fixedIn: null, version: 1, createdAt: 't', updatedAt: 't' };
const req = (method: string, body?: unknown) =>
  new Request('http://x', { method, ...(body ? { body: JSON.stringify(body) } : {}) }) as never;
const p = (markId?: string) => ({ params: Promise.resolve({ jobId: JOB, ...(markId ? { markId } : {}) }) });

beforeEach(() => {
  jest.clearAllMocks();
  masterGet.mockResolvedValue(SAVED);
  list.mockResolvedValue([MARK]);
  get.mockResolvedValue(MARK);
  create.mockResolvedValue(MARK);
  update.mockResolvedValue({ ...MARK, version: 2 });
  del.mockResolvedValue(undefined);
});

it('is admin-only', async () => {
  (requireAdmin as jest.Mock).mockRejectedValueOnce(new Error('no'));
  expect((await GET(req('GET'), p())).status).toBe(401);
});

it('lists a saved master\'s marks', async () => {
  const res = await GET(req('GET'), p());
  expect(await res.json()).toEqual({ success: true, marks: [MARK] });
});

it('404s an unknown master and 409s an unsaved one', async () => {
  masterGet.mockResolvedValueOnce(null);
  expect((await POST(req('POST', { start: 1, reason: 'melody' }), p())).status).toBe(404);
  masterGet.mockResolvedValueOnce({ ...SAVED, savedAt: null });
  const res = await POST(req('POST', { start: 1, reason: 'melody' }), p());
  expect(res.status).toBe(409);
  expect((await res.json()).code).toBe('not-saved');
  expect(create).not.toHaveBeenCalled();
});

it('creates a mark bounded by the master\'s duration', async () => {
  expect((await POST(req('POST', { start: 102, reason: 'pronunciation' }), p())).status).toBe(201);
  expect(create).toHaveBeenCalledWith(JOB, { start: 102, end: null, reason: 'pronunciation', note: '' });
  expect((await POST(req('POST', { start: 400, reason: 'melody' }), p())).status).toBe(400);
});

it('refuses the 501st mark', async () => {
  list.mockResolvedValueOnce(Array.from({ length: 500 }, (_, i) => ({ ...MARK, markId: `m${i}` })));
  const res = await POST(req('POST', { start: 1, reason: 'melody' }), p());
  expect(res.status).toBe(409);
  expect((await res.json()).code).toBe('too-many');
});

it('updates with the version the client saw', async () => {
  const res = await PATCH(req('PATCH', { version: 1, status: 'wont-fix' }), p('m1'));
  expect(res.status).toBe(200);
  expect(update).toHaveBeenCalledWith(JOB, 'm1', 1, { status: 'wont-fix' });
});

it('409s a stale edit, and of two edits on the same version one wins', async () => {
  update.mockResolvedValueOnce({ ...MARK, version: 2 }).mockRejectedValueOnce(new StaleMarkError());
  const [a, b] = await Promise.all([
    PATCH(req('PATCH', { version: 1, note: 'one' }), p('m1')),
    PATCH(req('PATCH', { version: 1, note: 'two' }), p('m1')),
  ]);
  expect([a.status, b.status].sort()).toEqual([200, 409]);
  const loser = a.status === 409 ? a : b;
  expect((await loser.json()).code).toBe('stale');
});

it('credits a fix only to a saved child of this master', async () => {
  masterGet.mockImplementation(async (id: string) =>
    id === JOB ? SAVED
    : id === 'child1' ? { id, savedAt: 't', derivedFrom: { jobId: JOB, via: 're-master' } }
    : id === 'stranger' ? { id, savedAt: 't', derivedFrom: { jobId: 'someone-else', via: 're-master' } }
    : null);
  expect((await PATCH(req('PATCH', { version: 1, status: 'fixed', fixedIn: 'child1' }), p('m1'))).status).toBe(200);
  const res = await PATCH(req('PATCH', { version: 1, status: 'fixed', fixedIn: 'stranger' }), p('m1'));
  expect(res.status).toBe(400);
  expect((await res.json()).code).toBe('bad-fixed-in');
});

it('404s a missing mark on PATCH and DELETE', async () => {
  get.mockResolvedValue(null);
  expect((await PATCH(req('PATCH', { version: 1, note: 'x' }), p('nope'))).status).toBe(404);
  expect((await DELETE(req('DELETE'), p('nope'))).status).toBe(404);
  expect(del).not.toHaveBeenCalled();
});

it('deletes a mark', async () => {
  expect((await DELETE(req('DELETE'), p('m1'))).status).toBe(200);
  expect(del).toHaveBeenCalledWith(JOB, 'm1');
});
```

Add to `__tests__/api/admin-music-lab-master-route.test.ts`: change the repository mock to `MasterJobRepository: jest.fn().mockImplementation(() => ({ create: createMock, get: parentGet }))` with `const parentGet = jest.fn();` declared above it, add a `StemSetRepository` mock with `const setGet = jest.fn().mockResolvedValue(null);`, then:

```ts
describe('lineage', () => {
  const PARENT = { id: 'p1', savedAt: '2026-10-01T00:00:00.000Z', s3Key: 'audio/mastering/song.wav' };
  beforeEach(() => { parentGet.mockReset(); setGet.mockReset().mockResolvedValue(null); });

  it('sends nothing new when no parent is claimed', async () => {
    await invoke({ s3Key: 'audio/mastering/song.wav' });
    expect(createMock.mock.calls[0][1]).not.toHaveProperty('derivedFrom');
    expect(parentGet).not.toHaveBeenCalled();
  });

  it('records a verified re-master', async () => {
    parentGet.mockResolvedValue(PARENT);
    const res = await invoke({ s3Key: 'audio/mastering/song.wav', derivedFrom: { jobId: 'p1' } });
    expect(res.status).toBe(202);
    expect(createMock.mock.calls[0][1].derivedFrom).toEqual({ jobId: 'p1', via: 're-master' });
    // The worker never sees it.
    const payload = JSON.parse(Buffer.from(lambdaSend.mock.calls[0][0].args.Payload).toString());
    expect(payload).not.toHaveProperty('derivedFrom');
  });

  it('records a stem remix with the mix it was made from', async () => {
    const REMIX = 'audio/mastering/stems/p1/remix.wav';
    parentGet.mockResolvedValue(PARENT);
    setGet.mockResolvedValue({ remix: { key: REMIX, mixUsed: { s1: { gainDb: -2, muted: false } } } });
    await invoke({ s3Key: REMIX, derivedFrom: { jobId: 'p1' } });
    expect(createMock.mock.calls[0][1].derivedFrom)
      .toEqual({ jobId: 'p1', via: 'stem-remix', mixUsed: { s1: { gainDb: -2, muted: false } } });
  });

  it('refuses a claim it cannot verify, and creates no job', async () => {
    parentGet.mockResolvedValue(PARENT);
    const res = await invoke({ s3Key: 'audio/mastering/other.wav', derivedFrom: { jobId: 'p1' } });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('parent-mismatch');
    parentGet.mockResolvedValue(null);
    const res2 = await invoke({ s3Key: 'audio/mastering/song.wav', derivedFrom: { jobId: 'p1' } });
    expect((await res2.json()).code).toBe('bad-parent');
    expect(createMock).not.toHaveBeenCalled();
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('two re-masters of one parent at once are two jobs with the same parent', async () => {
    parentGet.mockResolvedValue(PARENT);
    await Promise.all([
      invoke({ s3Key: 'audio/mastering/song.wav', derivedFrom: { jobId: 'p1' } }),
      invoke({ s3Key: 'audio/mastering/song.wav', derivedFrom: { jobId: 'p1' } }),
    ]);
    const [a, b] = createMock.mock.calls;
    expect(a[0]).not.toBe(b[0]);
    expect(a[1].derivedFrom).toEqual(b[1].derivedFrom);
  });
});
```

The StemSetRepository mock (top of file, beside the MasterJobRepository mock):

```ts
const setGet = jest.fn().mockResolvedValue(null);
jest.mock('@/infrastructure/database/StemSetRepository', () => ({
  StemSetRepository: jest.fn().mockImplementation(() => ({ get: setGet })),
}));
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `NODE_OPTIONS=--no-experimental-strip-types npx jest __tests__/api/admin-master-marks.test.ts __tests__/api/admin-music-lab-master-route.test.ts`
Expected: FAIL — route modules missing; lineage cases fail.

- [ ] **Step 3: Implement the marks routes**

```ts
// src/app/api/admin/music-lab/master/[jobId]/marks/route.ts
/**
 * GET/POST /api/admin/music-lab/master/[jobId]/marks — a saved master's
 * repair marks. Marks belong to ONE version (this master); see the 2026-10-20
 * repair-marks spec. Unsaved jobs expire after 24h, so they take no marks.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';
import { MarkRepository } from '@/infrastructure/database/MarkRepository';
import { isValidMasterJobId } from '@/lib/stems';
import { parseNewMark, masterDurationSec, MAX_MARKS_PER_MASTER } from '@/lib/repair-marks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ jobId: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { jobId } = await params;
  if (!isValidMasterJobId(jobId)) return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });
  try {
    const job = await new MasterJobRepository().get(jobId);
    if (!job) return NextResponse.json({ success: false, error: 'No master with that id.' }, { status: 404 });
    const marks = await new MarkRepository().list(jobId);
    return NextResponse.json({ success: true, marks });
  } catch (err) {
    console.error('[api/marks] list failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not load the marks.' }, { status: 502 });
  }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { jobId } = await params;
  if (!isValidMasterJobId(jobId)) return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });
  const body = await request.json().catch(() => null);
  try {
    const job = await new MasterJobRepository().get(jobId);
    if (!job) return NextResponse.json({ success: false, error: 'No master with that id.' }, { status: 404 });
    if (!job.savedAt) {
      return NextResponse.json(
        { success: false, code: 'not-saved', error: 'Save this master before marking it.' },
        { status: 409 }
      );
    }
    const parsed = parseNewMark(body, masterDurationSec(job));
    if (!parsed.ok) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
    const repo = new MarkRepository();
    // A soft cap: two creates racing at 499 can land 501. The limit exists to
    // stop a runaway, not to be exact.
    if ((await repo.list(jobId)).length >= MAX_MARKS_PER_MASTER) {
      return NextResponse.json(
        { success: false, code: 'too-many', error: `A master holds at most ${MAX_MARKS_PER_MASTER} marks.` },
        { status: 409 }
      );
    }
    const mark = await repo.create(jobId, parsed.value);
    return NextResponse.json({ success: true, mark }, { status: 201 });
  } catch (err) {
    console.error('[api/marks] create failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not save the mark.' }, { status: 502 });
  }
}
```

```ts
// src/app/api/admin/music-lab/master/[jobId]/marks/[markId]/route.ts
/**
 * PATCH/DELETE one repair mark. PATCH carries the `version` the client last
 * saw; a mismatch is 409 `stale` (another tab saved first) and writes nothing.
 * `fixedIn` may only name a saved master derived from this one.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';
import { MarkRepository, StaleMarkError } from '@/infrastructure/database/MarkRepository';
import { isValidMasterJobId } from '@/lib/stems';
import { parseMarkPatch, masterDurationSec } from '@/lib/repair-marks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ jobId: string; markId: string }> };

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { jobId, markId } = await params;
  if (!isValidMasterJobId(jobId) || !isValidMasterJobId(markId)) {
    return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });
  }
  const body = await request.json().catch(() => null);
  try {
    const jobs = new MasterJobRepository();
    const repo = new MarkRepository();
    const [job, current] = await Promise.all([jobs.get(jobId), repo.get(jobId, markId)]);
    if (!job || !current) return NextResponse.json({ success: false, error: 'No such mark.' }, { status: 404 });
    const parsed = parseMarkPatch(body, current, masterDurationSec(job));
    if (!parsed.ok) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
    if (parsed.patch.fixedIn) {
      const child = await jobs.get(parsed.patch.fixedIn);
      if (!child?.savedAt || child.derivedFrom?.jobId !== jobId) {
        return NextResponse.json(
          { success: false, code: 'bad-fixed-in', error: 'A fix can only be credited to a saved version made from this master.' },
          { status: 400 }
        );
      }
    }
    const mark = await repo.update(jobId, markId, parsed.version, parsed.patch);
    return NextResponse.json({ success: true, mark });
  } catch (err) {
    if (err instanceof StaleMarkError || (err as { name?: string })?.name === 'StaleMarkError') {
      return NextResponse.json(
        { success: false, code: 'stale', error: 'Changed in another tab — reload to see it.' },
        { status: 409 }
      );
    }
    console.error('[api/marks] update failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not save the mark.' }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { jobId, markId } = await params;
  if (!isValidMasterJobId(jobId) || !isValidMasterJobId(markId)) {
    return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });
  }
  try {
    const repo = new MarkRepository();
    if (!(await repo.get(jobId, markId))) {
      return NextResponse.json({ success: false, error: 'No such mark.' }, { status: 404 });
    }
    await repo.delete(jobId, markId);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/marks] delete failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not delete the mark.' }, { status: 502 });
  }
}
```

- [ ] **Step 4: Implement lineage in the master route**

In `src/app/api/admin/music-lab/master/route.ts`, add imports:

```ts
import { StemSetRepository } from '@/infrastructure/database/StemSetRepository';
import { isValidMasterJobId } from '@/lib/stems';
import { resolveLineage } from '@/lib/master-lineage';
import type { MasterLineage } from '@/types/masterJob';
```

Immediately before `const jobId = randomUUID();` insert:

```ts
  // Lineage: the client claims a parent; the route verifies it against the
  // parent's own source and its stem set's remix before storing anything. A
  // claim it cannot verify is a client bug — refuse it loudly, because a
  // master recorded against the wrong parent shows the wrong marks forever.
  let derivedFrom: MasterLineage | null = null;
  if (body?.derivedFrom !== undefined && body?.derivedFrom !== null) {
    const parentId = body.derivedFrom?.jobId;
    if (!isValidMasterJobId(parentId)) {
      return NextResponse.json(
        { success: false, code: 'bad-parent', error: 'The master this came from is not a saved master.' },
        { status: 400 }
      );
    }
    try {
      const [parent, set] = await Promise.all([
        new MasterJobRepository().get(parentId),
        new StemSetRepository().get(parentId),
      ]);
      const lineage = resolveLineage(parent, set, s3Key);
      if (!lineage.ok) {
        return NextResponse.json({ success: false, code: lineage.code, error: lineage.error }, { status: 400 });
      }
      derivedFrom = lineage.derivedFrom;
    } catch (err) {
      console.error('[api/music-lab/master] lineage check failed:', err instanceof Error ? err.message : String(err));
      return NextResponse.json({ success: false, error: 'Could not check the master this came from.' }, { status: 502 });
    }
  }
```

and in the `create(jobId, { … })` call add, after the `normalizationMode` spread:

```ts
      // Only when verified above: an ordinary job's create() input is unchanged.
      ...(derivedFrom ? { derivedFrom } : {}),
```

Do NOT add it to the Lambda payload.

- [ ] **Step 5: Run tests to verify they pass**

Run: `NODE_OPTIONS=--no-experimental-strip-types npx jest __tests__/api/admin-master-marks.test.ts __tests__/api/admin-music-lab-master-route.test.ts __tests__/api/admin-auth-coverage.test.ts && npx tsc --noEmit`
Expected: PASS (auth-coverage included: it scans the new routes); tsc clean.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/admin/music-lab/master/[jobId]/marks" src/app/api/admin/music-lab/master/route.ts __tests__/api/admin-master-marks.test.ts __tests__/api/admin-music-lab-master-route.test.ts
git commit -m "feat(marks): marks API and verified lineage on the master route"
```

---

### Task 5: Studio — send the parent, show lineage on library rows

**Files:**
- Modify: `src/components/admin/MasteringStudio.tsx` (new `pendingParent` state; `?source=` effect ~line 771; `reopenMaster` ~line 2264; `onPick` ~line 1007; `reset` ~line 860; POST body ~line 1111; library row title ~line 3961)
- Modify: `src/components/admin/stems/StemsStudio.tsx` (`remixMasterHref` ~line 517)
- Test: `__tests__/components/mastering-lineage.test.tsx` (new), `__tests__/components/stems/StemsStudio.test.tsx:346` (update expected href)

**Interfaces:**
- Consumes: `lineageLabel` (Task 3), `isValidMasterJobId` from `@/lib/stems`, `MasterJob.derivedFrom`.
- Produces: the POST body carries `derivedFrom: { jobId }` after a reopen or a `?parent=` link; the Master-this-remix link carries `&parent=<masterJobId>`.

- [ ] **Step 1: Write the failing tests**

Update the expectation in `__tests__/components/stems/StemsStudio.test.tsx` (around line 346):

```ts
      const expectedHref = `/admin/mastering?source=${encodeURIComponent(REMIX_KEY)}&title=${encodeURIComponent('பாடல் — remix')}&target=-14&parent=${encodeURIComponent(JOB)}`;
```

(`JOB` is that file's master id constant; check its name at the top of the file.)

```tsx
// __tests__/components/mastering-lineage.test.tsx
/** @jest-environment jsdom */
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
jest.mock('@/components/admin/MasteringComparePlayer', () => ({ MasteringComparePlayer: () => null }));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MasteringStudio } from '@/components/admin/MasteringStudio';
import { adminFetch } from '@/lib/client-auth';

const mockedFetch = adminFetch as jest.Mock;
const base = {
  status: 'done', createdAt: '2026-07-30T00:00:00.000Z', updatedAt: '2026-07-30T00:00:00.000Z',
  target: -14, beforeLufs: -17.9, beforeTp: -1.2, afterLufs: -14, afterTp: -1,
  beforeLra: 3, afterLra: 3, normalizationType: 'linear', source: null, error: null,
};
const parent = { ...base, id: 'p1', s3Key: 'audio/mastering/in.wav', masterKey: 'audio/mastering/in_p1-master-14LUFS.wav', savedAt: '2026-07-30T16:00:00.000Z', title: 'ஈழத்து மண்ணே' };
const child = { ...base, id: 'c1', s3Key: 'audio/mastering/stems/p1/remix.wav', masterKey: 'audio/mastering/stems/p1/remix_c1-master-14LUFS.wav', savedAt: '2026-07-31T16:00:00.000Z', title: 'ஈழத்து மண்ணே — remix', derivedFrom: { jobId: 'p1', via: 'stem-remix' } };

function routeFetch() {
  mockedFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (url.includes('/masters')) {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, masters: [child, parent] }) } as Response);
    }
    if (url === '/api/admin/music-lab/master' && init?.method === 'POST') {
      return Promise.resolve({ ok: true, status: 202, json: async () => ({ success: true, jobId: 'new1', status: 'queued' }) } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
}

beforeEach(() => {
  mockedFetch.mockReset();
  window.history.replaceState({}, '', '/admin/mastering');
  window.localStorage.clear();
  window.sessionStorage.clear();
});

it('labels a derived master with its parent', async () => {
  routeFetch();
  render(<MasteringStudio />);
  fireEvent.click(screen.getByRole('button', { name: /Saved masters/i }));
  expect(await screen.findByText('Remix of ஈழத்து மண்ணே')).toBeTruthy();
});

it('sends the reopened master as the parent of the new job', async () => {
  routeFetch();
  render(<MasteringStudio />);
  fireEvent.click(screen.getByRole('button', { name: /Saved masters/i }));
  await screen.findByText('Remix of ஈழத்து மண்ணே');
  // Rows render newest first: [child, parent]. The reopen button reads "Edit & re-master".
  fireEvent.click(screen.getAllByRole('button', { name: /Edit & re-master/ })[1]);
  fireEvent.click(await screen.findByRole('button', { name: /Master to -14 LUFS/ }));
  await waitFor(() => {
    const post = mockedFetch.mock.calls.find(([u, i]) => u === '/api/admin/music-lab/master' && i?.method === 'POST');
    expect(post).toBeTruthy();
    expect(JSON.parse(post![1].body).derivedFrom).toEqual({ jobId: 'p1' });
  });
});

it('reads ?parent= from a Master-this-remix link', async () => {
  routeFetch();
  window.history.replaceState({}, '', `/admin/mastering?source=${encodeURIComponent('audio/mastering/stems/p1/remix.wav')}&title=x&target=-14&parent=p1`);
  render(<MasteringStudio />);
  fireEvent.click(await screen.findByRole('button', { name: /Master to -14 LUFS/ }));
  await waitFor(() => {
    const post = mockedFetch.mock.calls.find(([u, i]) => u === '/api/admin/music-lab/master' && i?.method === 'POST');
    expect(JSON.parse(post![1].body).derivedFrom).toEqual({ jobId: 'p1' });
  });
});

it('a recovered job in progress wins over a ?parent= link, and gets no parent', async () => {
  routeFetch();
  // readStored() reads sessionStorage['mastering-studio-job'] (a StoredJob).
  window.sessionStorage.setItem('mastering-studio-job', JSON.stringify({
    jobId: 'running1', sourceKey: 'audio/mastering/other.wav', name: 'other.wav', size: 1, target: -14,
  }));
  window.history.replaceState({}, '', `/admin/mastering?source=${encodeURIComponent('audio/mastering/in.wav')}&parent=p1`);
  render(<MasteringStudio />);
  expect(await screen.findByText(/A job already in progress was reopened instead of the link/)).toBeTruthy();
  const posts = mockedFetch.mock.calls.filter(([u, i]) => u === '/api/admin/music-lab/master' && i?.method === 'POST');
  expect(posts).toHaveLength(0);
});

it('re-opening another master replaces the pending parent', async () => {
  routeFetch();
  render(<MasteringStudio />);
  fireEvent.click(screen.getByRole('button', { name: /Saved masters/i }));
  await screen.findByText('Remix of ஈழத்து மண்ணே');
  const reopen = screen.getAllByRole('button', { name: /Edit & re-master/ });
  fireEvent.click(reopen[1]); // parent
  fireEvent.click(reopen[0]); // then the child
  fireEvent.click(await screen.findByRole('button', { name: /Master to -14 LUFS/ }));
  await waitFor(() => {
    const post = mockedFetch.mock.calls.find(([u, i]) => u === '/api/admin/music-lab/master' && i?.method === 'POST');
    expect(JSON.parse(post![1].body).derivedFrom).toEqual({ jobId: 'c1' });
  });
});
```

Also clear `window.sessionStorage` in `beforeEach` (add `window.sessionStorage.clear();`) so the recovery test cannot leak into the others.

- [ ] **Step 2: Run tests to verify they fail**

Run: `NODE_OPTIONS=--no-experimental-strip-types npx jest __tests__/components/mastering-lineage.test.tsx __tests__/components/stems/StemsStudio.test.tsx`
Expected: FAIL — no "Remix of" label; no `derivedFrom` in the body; href lacks `&parent=`.

- [ ] **Step 3: Implement**

`StemsStudio.tsx`, in `remixMasterHref`:

```ts
      ? `/admin/mastering?source=${encodeURIComponent(remixKey)}&title=${encodeURIComponent(
          `${master.title || 'Untitled'} — remix`
        )}&target=${encodeURIComponent(targetIdFor(master))}&parent=${encodeURIComponent(master.id)}`
```

`MasteringStudio.tsx`:

1. Imports: `import { lineageLabel } from '@/lib/master-lineage';` and `isValidMasterJobId` from `@/lib/stems` (add to an existing `@/lib/stems` import if there is one).
2. State, beside `sourceKey`:

```ts
  /**
   * The saved master the next job is made from, if any — set by a library
   * re-open or a Master-this-remix link, cleared by picking a file or reset.
   * The server verifies it before recording lineage.
   */
  const [pendingParent, setPendingParent] = useState<string | null>(null);
```

3. In the `?source=` effect, after `setStage('ready');` (i.e. only on the path where the link is honoured — NOT after the `readStored()` early return):

```ts
    const parent = q.get('parent');
    if (parent && isValidMasterJobId(parent)) setPendingParent(parent);
```

4. In `reopenMaster`, after `setSourceKey(m.s3Key);`: `setPendingParent(m.id);`
5. In `onPick` (start of the callback body) and in `reset`: `setPendingParent(null);`
6. In the POST body, after the `edit` spread:

```ts
          // Only after a re-open or a remix link; a plain run sends the exact body it always did.
          ...(pendingParent ? { derivedFrom: { jobId: pendingParent } } : {}),
```

and add `pendingParent` to that callback's dependency array.

7. In the library row, directly after the title `<span>` (the one rendering `{m.title || …}`), still inside the flex container:

```tsx
                        {m.derivedFrom && (
                          <span className="shrink-0 text-[11px] text-gray-500 dark:text-gray-400">
                            {lineageLabel(m.derivedFrom, library?.find((x) => x.id === m.derivedFrom!.jobId)?.title ?? null)}
                          </span>
                        )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `NODE_OPTIONS=--no-experimental-strip-types npx jest __tests__/components/mastering-lineage.test.tsx __tests__/components/stems/StemsStudio.test.tsx __tests__/components/mastering-library.test.tsx && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/MasteringStudio.tsx src/components/admin/stems/StemsStudio.tsx __tests__/components/mastering-lineage.test.tsx __tests__/components/stems/StemsStudio.test.tsx
git commit -m "feat(lineage): studio sends the parent; rows say Remix of / Re-master of"
```

---

### Task 6: Persisted marks in the player

**Files:**
- Create: `src/components/admin/useRepairMarks.ts`
- Create: `src/components/admin/RepairMarksPanel.tsx`
- Modify: `src/components/admin/MasteringWaveform.tsx` (new optional `spans` prop, painted under the marks at ~line 161)
- Modify: `src/components/admin/MasteringPlayer.tsx` (new optional `masterJobId` prop; `dropMark` ~line 342; marks UI ~lines 670-755)
- Test: `__tests__/components/repair-marks-player.test.tsx`

**Interfaces:**
- Consumes: Task 1 types/helpers; HTTP from Task 4; `adminFetch` from `@/lib/client-auth`; `LoopRegion` from `@/lib/waveform`.
- Produces:
  - `useRepairMarks(masterJobId: string | null): { marks: RepairMark[] | null; pending: PendingMark[]; loadError: string | null; notice: string | null; rowErrors: Record<string, string>; create(input: NewMarkInput): Promise<void>; update(markId: string, patch: MarkPatch): Promise<boolean>; remove(markId: string): Promise<void>; discardPending(tempId: string): void; reload(): Promise<void> }` where `interface PendingMark { tempId: string; input: NewMarkInput; error: string | null }`
  - `<RepairMarksPanel hook={…} onSeek={(t: number) => void} />`
  - `MasteringWaveform` prop `spans?: readonly LoopRegion[]`
  - `MasteringPlayer` prop `masterJobId?: string`

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/repair-marks-player.test.tsx
/** @jest-environment jsdom */
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MasteringPlayer } from '@/components/admin/MasteringPlayer';
import { adminFetch } from '@/lib/client-auth';

const mockedFetch = adminFetch as jest.Mock;
const JOB = 'job1';
const mark = (over: Record<string, unknown> = {}) => ({
  markId: 'm1', masterJobId: JOB, start: 102, end: null, reason: 'pronunciation', note: '', status: 'open',
  fixedIn: null, version: 1, createdAt: 't', updatedAt: 't', ...over,
});

function installAudioContext() {
  class Fake {
    destination = {};
    createMediaElementSource() { return { connect: () => {} }; }
    createBiquadFilter() { return { type: '', frequency: { value: 0 }, Q: { value: 0 }, gain: { value: 0 }, connect: () => {} }; }
    createAnalyser() { return { fftSize: 2048, connect: () => {}, getFloatTimeDomainData: (b: Float32Array) => b.fill(0.1) }; }
    close() {}
    resume() {}
  }
  (window as unknown as { AudioContext: unknown }).AudioContext = Fake;
}

const json = (status: number, body: unknown) => Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);

beforeEach(() => {
  installAudioContext();
  global.fetch = jest.fn().mockResolvedValue({ headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(8) }) as unknown as typeof fetch;
  mockedFetch.mockReset();
});

const setup = (marks: unknown[] = []) => {
  let created = 0;
  mockedFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith(`/master/${JOB}/marks`) && (!init || !init.method || init.method === 'GET')) {
      return json(200, { success: true, marks });
    }
    if (url.endsWith(`/master/${JOB}/marks`) && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      created += 1;
      return json(201, { success: true, mark: mark({ markId: `new${created}`, ...body }) });
    }
    return json(200, { success: true });
  });
  return render(<MasteringPlayer masterUrl="https://s3/m.wav?sig=1" title="பாடல்" masterJobId={JOB} />);
};

it('loads the saved marks of this master', async () => {
  setup([mark({ note: 'ழ sung as ல' })]);
  expect(await screen.findByText('ழ sung as ல')).toBeTruthy();
});

it('M saves a moment through the API', async () => {
  setup();
  await waitFor(() => expect(mockedFetch).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: /Mark here/ }));
  await waitFor(() => {
    const post = mockedFetch.mock.calls.find(([, i]) => i?.method === 'POST');
    expect(JSON.parse(post![1].body)).toMatchObject({ start: 0, end: null, reason: 'pronunciation' });
  });
});

it('three quick marks are three saves, each with its own row', async () => {
  setup();
  await waitFor(() => expect(mockedFetch).toHaveBeenCalled());
  const btn = screen.getByRole('button', { name: /Mark here/ });
  fireEvent.click(btn); fireEvent.click(btn); fireEvent.click(btn);
  await waitFor(() => expect(mockedFetch.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(3));
  expect(await screen.findAllByRole('listitem')).toHaveLength(3);
});

it('a failed save shows its error in that row', async () => {
  setup();
  await waitFor(() => expect(mockedFetch).toHaveBeenCalled());
  mockedFetch.mockImplementationOnce(() => json(502, { success: false, error: 'Could not save the mark.' }));
  fireEvent.click(screen.getByRole('button', { name: /Mark here/ }));
  const row = (await screen.findByText('Could not save the mark.')).closest('li')!;
  expect(within(row).getByRole('button', { name: /Discard/ })).toBeTruthy();
});

it('a stale edit reloads the list and says so', async () => {
  setup([mark()]);
  await screen.findByRole('combobox', { name: /Status for 1:42/ });
  mockedFetch.mockImplementationOnce(() => json(409, { success: false, code: 'stale', error: 'Changed in another tab — reload to see it.' }));
  fireEvent.change(screen.getByRole('combobox', { name: /Status for 1:42/ }), { target: { value: 'fixed' } });
  expect(await screen.findByText(/Changed in another tab — reloaded/)).toBeTruthy();
  const gets = mockedFetch.mock.calls.filter(([u, i]) => String(u).endsWith('/marks') && (!i || !i.method || i.method === 'GET'));
  expect(gets.length).toBeGreaterThanOrEqual(2);
});

it('without masterJobId, marks stay in the page as before (no API calls)', async () => {
  render(<MasteringPlayer masterUrl="https://s3/m.wav?sig=1" title="x" />);
  fireEvent.click(screen.getByRole('button', { name: /Mark here/ }));
  expect(mockedFetch).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--no-experimental-strip-types npx jest __tests__/components/repair-marks-player.test.tsx`
Expected: FAIL — `masterJobId` unused; no API calls.

- [ ] **Step 3: Implement the hook**

```ts
// src/components/admin/useRepairMarks.ts
'use client';
/**
 * Client state for one saved master's repair marks.
 *
 * A create shows a PENDING row at once, so pressing M three times is three
 * rows even before the saves return, and a failed save keeps its row with the
 * error in it (row errors must render in the row). An edit sends the version
 * it was based on; a 409 means another tab saved first, so the list reloads
 * and says so rather than overwriting.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { sortMarks, type RepairMark, type NewMarkInput, type MarkPatch } from '@/lib/repair-marks';

export interface PendingMark {
  tempId: string;
  input: NewMarkInput;
  error: string | null;
}

export function useRepairMarks(masterJobId: string | null) {
  const [marks, setMarks] = useState<RepairMark[] | null>(null);
  const [pending, setPending] = useState<PendingMark[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const seq = useRef(0);
  const base = masterJobId ? `/api/admin/music-lab/master/${encodeURIComponent(masterJobId)}/marks` : null;

  const reload = useCallback(async () => {
    if (!base) return;
    try {
      const res = await adminFetch(base);
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not load the marks.');
      setMarks(sortMarks(body.marks as RepairMark[]));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load the marks.');
    }
  }, [base]);

  useEffect(() => {
    setMarks(null);
    setPending([]);
    setRowErrors({});
    setNotice(null);
    void reload();
  }, [reload]);

  const create = useCallback(async (input: NewMarkInput) => {
    if (!base) return;
    const tempId = `pending-${seq.current++}`;
    setPending((p) => [...p, { tempId, input, error: null }]);
    try {
      const res = await adminFetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not save the mark.');
      setPending((p) => p.filter((x) => x.tempId !== tempId));
      setMarks((m) => sortMarks([...(m ?? []), body.mark as RepairMark]));
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Could not save the mark.';
      setPending((p) => p.map((x) => (x.tempId === tempId ? { ...x, error } : x)));
    }
  }, [base]);

  const update = useCallback(async (markId: string, patch: MarkPatch): Promise<boolean> => {
    if (!base) return false;
    const current = marks?.find((m) => m.markId === markId);
    if (!current) return false;
    setRowErrors((r) => { const { [markId]: _gone, ...rest } = r; return rest; });
    try {
      const res = await adminFetch(`${base}/${encodeURIComponent(markId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: current.version, ...patch }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.code === 'stale') {
        setNotice('Changed in another tab — reloaded.');
        await reload();
        return false;
      }
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not save the mark.');
      setMarks((m) => sortMarks((m ?? []).map((x) => (x.markId === markId ? (body.mark as RepairMark) : x))));
      return true;
    } catch (e) {
      setRowErrors((r) => ({ ...r, [markId]: e instanceof Error ? e.message : 'Could not save the mark.' }));
      return false;
    }
  }, [base, marks, reload]);

  const remove = useCallback(async (markId: string) => {
    if (!base) return;
    try {
      const res = await adminFetch(`${base}/${encodeURIComponent(markId)}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not delete the mark.');
      setMarks((m) => (m ?? []).filter((x) => x.markId !== markId));
    } catch (e) {
      setRowErrors((r) => ({ ...r, [markId]: e instanceof Error ? e.message : 'Could not delete the mark.' }));
    }
  }, [base]);

  const discardPending = useCallback((tempId: string) => {
    setPending((p) => p.filter((x) => x.tempId !== tempId));
  }, []);

  return { marks, pending, loadError, notice, rowErrors, create, update, remove, discardPending, reload };
}

export type RepairMarksState = ReturnType<typeof useRepairMarks>;
```

- [ ] **Step 4: Implement the panel**

```tsx
// src/components/admin/RepairMarksPanel.tsx
'use client';
import { X } from 'lucide-react';
import { FAILURE_REASONS } from '@/types/generation';
import { reasonLabel, type MarkReason } from '@/lib/audition-marks';
import { MARK_STATUSES, markTimeLabel, statusLabel, type MarkStatus } from '@/lib/repair-marks';
import type { RepairMarksState } from './useRepairMarks';

export function RepairMarksPanel({ hook, onSeek }: { hook: RepairMarksState; onSeek: (t: number) => void }) {
  const { marks, pending, loadError, notice, rowErrors, update, remove, discardPending } = hook;
  if (loadError) return <p className="mt-1 text-[11px] text-rose-600">{loadError}</p>;
  if (marks === null) return <p className="mt-1 text-[11px] text-gray-500">Loading marks…</p>;
  const empty = marks.length === 0 && pending.length === 0;
  return (
    <>
      {notice && <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">{notice}</p>}
      {empty ? (
        <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
          Press <kbd>M</kbd> to mark a moment, or drag the waveform and press Save span. Marks are saved with this master.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-800">
          {marks.map((m) => {
            const label = markTimeLabel(m);
            return (
              <li key={m.markId} className="py-1 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => onSeek(m.start)} className="tabular-nums font-medium text-purple-700 hover:underline dark:text-purple-300">
                    {label}
                  </button>
                  <select
                    aria-label={`Reason for ${label}`}
                    value={m.reason}
                    onChange={(e) => void update(m.markId, { reason: e.target.value as MarkReason })}
                    className="rounded border border-gray-300 px-1 py-0.5 text-xs dark:border-gray-700 dark:bg-gray-900"
                  >
                    {FAILURE_REASONS.map((r) => <option key={r} value={r}>{reasonLabel(r)}</option>)}
                  </select>
                  <select
                    aria-label={`Status for ${label}`}
                    value={m.status}
                    onChange={(e) => void update(m.markId, { status: e.target.value as MarkStatus })}
                    className="rounded border border-gray-300 px-1 py-0.5 text-xs dark:border-gray-700 dark:bg-gray-900"
                  >
                    {MARK_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                  </select>
                  <input
                    aria-label={`Note for ${label}`}
                    defaultValue={m.note}
                    maxLength={500}
                    placeholder="note"
                    onBlur={(e) => { if (e.target.value !== m.note) void update(m.markId, { note: e.target.value }); }}
                    className="min-w-0 grow rounded border border-gray-300 px-1 py-0.5 text-xs dark:border-gray-700 dark:bg-gray-900"
                  />
                  {m.note && <span className="sr-only">{m.note}</span>}
                  <button type="button" onClick={() => void remove(m.markId)} aria-label={`Remove mark at ${label}`} className="text-gray-400 hover:text-rose-600">
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
                {rowErrors[m.markId] && <p className="mt-0.5 text-[11px] text-rose-600">{rowErrors[m.markId]}</p>}
              </li>
            );
          })}
          {pending.map((p) => (
            <li key={p.tempId} className="py-1 text-xs">
              <div className="flex items-center gap-2 text-gray-500">
                <span className="tabular-nums">{markTimeLabel(p.input)}</span>
                <span>{reasonLabel(p.input.reason)}</span>
                {p.error ? (
                  <>
                    <span className="text-rose-600">{p.error}</span>
                    <button type="button" onClick={() => discardPending(p.tempId)} className="ml-auto underline">Discard</button>
                  </>
                ) : (
                  <span>saving…</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
```

Note: the `findByText('ழ sung as ல')` test relies on the `sr-only` span, because an input's value is not text content. Keep that span.

- [ ] **Step 5: Waveform spans**

In `MasteringWaveform.tsx` add to the props interface:

```ts
  /** Saved spans (repair marks with an end), drawn as faint bands under the marks. */
  spans?: readonly LoopRegion[];
```

destructure `spans = []`, and immediately BEFORE the `// Marks first` block paint:

```ts
    if (duration > 0 && spans.length) {
      g.fillStyle = SPAN_FILL;
      for (const s of spans) {
        const x0 = Math.round((Math.min(Math.max(s.start, 0), duration) / duration) * w);
        const x1 = Math.round((Math.min(Math.max(s.end, 0), duration) / duration) * w);
        g.fillRect(x0, 0, Math.max(2, x1 - x0), h);
      }
    }
```

with `const SPAN_FILL = 'rgba(147, 51, 234, 0.15)';` beside `MARK_LINE`, and add `spans` to that callback's dependency array. Import `LoopRegion` if the file does not already.

- [ ] **Step 6: Wire the player**

In `MasteringPlayer.tsx`:

1. Props: add

```ts
  /**
   * The saved master being played. When present, marks are saved with it
   * (repair marks); when absent, marks stay in the page as before.
   */
  masterJobId?: string;
```

and destructure `masterJobId`.
2. Imports: `useRepairMarks` from `./useRepairMarks`, `RepairMarksPanel` from `./RepairMarksPanel`, `repairMarksToText` from `@/lib/repair-marks`.
3. After the existing `marks` state: `const repair = useRepairMarks(masterJobId ?? null);`
4. Replace `markTimes` and add spans:

```ts
  const markTimes = useMemo(
    () => (masterJobId ? (repair.marks ?? []).filter((m) => m.end === null).map((m) => m.start) : marks.map((m) => m.time)),
    [masterJobId, repair.marks, marks]
  );
  const spanRegions = useMemo(
    () => (masterJobId ? (repair.marks ?? []).filter((m) => m.end !== null).map((m) => ({ start: m.start, end: m.end as number })) : []),
    [masterJobId, repair.marks]
  );
```

5. `dropMark`: at the top, after `if (!a) return;`:

```ts
    if (masterJobId) {
      void repair.create({ start: a.currentTime, end: null, reason: markReason, note: '' });
      return;
    }
```

and add `masterJobId, repair.create` to its dependencies.
6. Pass `spans={spanRegions}` to `<MasteringWaveform …>`.
7. In the marks toolbar, after the reason `<label>`, add:

```tsx
          {masterJobId && loop && (
            <button
              type="button"
              onClick={() => void repair.create({ start: loop.start, end: loop.end, reason: markReason, note: '' })}
              className="rounded border border-purple-300 px-2 py-1 text-xs text-purple-700 dark:border-purple-700 dark:text-purple-300"
            >
              Save span
            </button>
          )}
```

8. Copy button: when `masterJobId`, show it if `(repair.marks?.length ?? 0) > 0` and copy `repairMarksToText(repair.marks ?? [], title)`; otherwise unchanged.
9. Marks body: wrap the existing `{marks.length === 0 ? (…) : (…)}` block as the `else` branch of:

```tsx
        {masterJobId ? (
          <RepairMarksPanel hook={repair} onSeek={seekTo} />
        ) : (
          /* existing session-local block, unchanged */
        )}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `NODE_OPTIONS=--no-experimental-strip-types npx jest __tests__/components/repair-marks-player.test.tsx __tests__/components/mastering-player.test.tsx __tests__/components/mastering-player-stops.test.tsx __tests__/components/mastering-player-resources.test.tsx && npx tsc --noEmit`
Expected: PASS — new tests pass and the existing player tests (no `masterJobId`) are unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/components/admin/useRepairMarks.ts src/components/admin/RepairMarksPanel.tsx src/components/admin/MasteringWaveform.tsx src/components/admin/MasteringPlayer.tsx __tests__/components/repair-marks-player.test.tsx
git commit -m "feat(marks): the player saves marks and spans with the master"
```

---

### Task 7: "From the previous version" + wiring in the library

**Files:**
- Create: `src/components/admin/ParentMarksPanel.tsx`
- Modify: `src/components/admin/MasteringPlayer.tsx` (new optional `parent` prop; render the panel under the marks panel)
- Modify: `src/components/admin/MasteringStudio.tsx` (~line 4348: pass `masterJobId` and `parent`)
- Test: `__tests__/components/parent-marks.test.tsx`

**Interfaces:**
- Consumes: `useRepairMarks` (Task 6), `parentMarksView`, `markTimeLabel` (Task 1), `lineageLabel` (Task 3), `MasterLineage`.
- Produces: `MasteringPlayer` prop `parent?: { jobId: string; via: LineageVia; title: string | null } | null`; `<ParentMarksPanel parent={…} masterJobId={string} onStillThere={(input: NewMarkInput) => void} />`.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/parent-marks.test.tsx
/** @jest-environment jsdom */
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ParentMarksPanel } from '@/components/admin/ParentMarksPanel';
import { adminFetch } from '@/lib/client-auth';

const mockedFetch = adminFetch as jest.Mock;
const pm = (over: Record<string, unknown>) => ({
  markId: 'x', masterJobId: 'p1', start: 0, end: null, reason: 'pronunciation', note: '', status: 'open',
  fixedIn: null, version: 1, createdAt: 't', updatedAt: 't', ...over,
});
const json = (status: number, body: unknown) => Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);

beforeEach(() => mockedFetch.mockReset());

function setup(onStillThere = jest.fn()) {
  mockedFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith('/master/p1/marks') && !init?.method) {
      return json(200, { success: true, marks: [
        pm({ markId: 'done', start: 10, status: 'fixed', note: 'old fix' }),
        pm({ markId: 'open1', start: 102, note: 'ழ sung as ல' }),
      ] });
    }
    if (init?.method === 'PATCH') return json(200, { success: true, mark: pm({ markId: 'open1', start: 102, status: 'fixed', fixedIn: 'c1', version: 2 }) });
    return json(200, { success: true });
  });
  render(<ParentMarksPanel parent={{ jobId: 'p1', via: 're-master', title: 'பாடல்' }} masterJobId="c1" onStillThere={onStillThere} />);
  return onStillThere;
}

it('lists the parent\'s marks at the PARENT\'s times, open first, under a lineage heading', async () => {
  setup();
  expect(await screen.findByText(/Re-master of பாடல்/)).toBeTruthy();
  const items = await screen.findAllByRole('listitem');
  expect(items[0].textContent).toContain('1:42');
  expect(items[1].textContent).toContain('0:10');
});

it('Fixed here marks the parent mark fixed, crediting this version', async () => {
  setup();
  fireEvent.click(await screen.findByRole('button', { name: /Fixed here.*1:42/ }));
  await waitFor(() => {
    const patch = mockedFetch.mock.calls.find(([, i]) => i?.method === 'PATCH');
    expect(patch![0]).toContain('/master/p1/marks/open1');
    expect(JSON.parse(patch![1].body)).toEqual({ version: 1, status: 'fixed', fixedIn: 'c1' });
  });
});

it('Still there hands the mark to this version unchanged, for Raj to re-time', async () => {
  const onStillThere = setup();
  fireEvent.click(await screen.findByRole('button', { name: /Still there.*1:42/ }));
  expect(onStillThere).toHaveBeenCalledWith({ start: 102, end: null, reason: 'pronunciation', note: 'ழ sung as ல' });
});

it('offers no buttons on marks that are already closed', async () => {
  setup();
  await screen.findAllByRole('listitem');
  expect(screen.queryByRole('button', { name: /Fixed here.*0:10/ })).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--no-experimental-strip-types npx jest __tests__/components/parent-marks.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the panel**

```tsx
// src/components/admin/ParentMarksPanel.tsx
'use client';
/**
 * The parent version's marks, shown on a child so a repair can be checked
 * off. Times are the PARENT's: a re-master with a different trim or a remix
 * moves every word, so these are listed, never drawn on this waveform.
 */
import { reasonLabel } from '@/lib/audition-marks';
import { parentMarksView, markTimeLabel, statusLabel, type NewMarkInput } from '@/lib/repair-marks';
import { lineageLabel } from '@/lib/master-lineage';
import type { LineageVia } from '@/types/masterJob';
import { useRepairMarks } from './useRepairMarks';

export function ParentMarksPanel({
  parent, masterJobId, onStillThere,
}: {
  parent: { jobId: string; via: LineageVia; title: string | null };
  masterJobId: string;
  onStillThere: (input: NewMarkInput) => void;
}) {
  const hook = useRepairMarks(parent.jobId);
  const heading = lineageLabel({ jobId: parent.jobId, via: parent.via }, parent.title);
  return (
    <div className="mt-2 rounded-lg border border-dashed border-gray-300 p-2 text-gray-500 dark:border-gray-700">
      <p className="text-[11px] font-medium">From the previous version — {heading}</p>
      <p className="text-[11px]">Times are the previous version&rsquo;s; a different trim or a remix moves them.</p>
      {hook.loadError && <p className="text-[11px] text-rose-600">{hook.loadError}</p>}
      {hook.notice && <p className="text-[11px] text-amber-700">{hook.notice}</p>}
      {hook.marks && hook.marks.length === 0 && <p className="text-[11px]">No marks on the previous version.</p>}
      {hook.marks && hook.marks.length > 0 && (
        <ul className="mt-1 divide-y divide-gray-100 dark:divide-gray-800">
          {parentMarksView(hook.marks).map((m) => {
            const label = markTimeLabel(m);
            return (
              <li key={m.markId} className="py-1 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums">{label}</span>
                  <span>{reasonLabel(m.reason)}</span>
                  {m.note && <span className="text-gray-600 dark:text-gray-300">{m.note}</span>}
                  {m.status === 'open' ? (
                    <span className="ml-auto flex gap-2">
                      <button
                        type="button"
                        aria-label={`Fixed here — ${label}`}
                        onClick={() => void hook.update(m.markId, { status: 'fixed', fixedIn: masterJobId })}
                        className="rounded border border-emerald-400 px-1.5 py-0.5 text-emerald-700"
                      >
                        Fixed here
                      </button>
                      <button
                        type="button"
                        aria-label={`Still there — ${label}`}
                        onClick={() => onStillThere({ start: m.start, end: m.end, reason: m.reason, note: m.note })}
                        className="rounded border border-gray-300 px-1.5 py-0.5"
                      >
                        Still there
                      </button>
                    </span>
                  ) : (
                    <span className="ml-auto">{statusLabel(m.status)}</span>
                  )}
                </div>
                {hook.rowErrors[m.markId] && <p className="text-[11px] text-rose-600">{hook.rowErrors[m.markId]}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire the player and the studio**

`MasteringPlayer.tsx` — add the prop:

```ts
  /** The version this master was made from, when known; shows its marks to tick off. */
  parent?: { jobId: string; via: LineageVia; title: string | null } | null;
```

(import `type LineageVia` from `@/types/masterJob`; import `ParentMarksPanel`), destructure `parent`, and directly after `<RepairMarksPanel … />` render:

```tsx
            {parent && masterJobId && (
              <ParentMarksPanel parent={parent} masterJobId={masterJobId} onStillThere={(input) => void repair.create(input)} />
            )}
```

`MasteringStudio.tsx` — in the library `<MasteringPlayer …>` (~line 4348) add:

```tsx
              masterJobId={playing.id}
              parent={(() => {
                const d = library?.find((x) => x.id === playing.id)?.derivedFrom;
                return d ? { jobId: d.jobId, via: d.via, title: library?.find((x) => x.id === d.jobId)?.title ?? null } : null;
              })()}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `NODE_OPTIONS=--no-experimental-strip-types npx jest __tests__/components/parent-marks.test.tsx __tests__/components/repair-marks-player.test.tsx __tests__/components/mastering-library.test.tsx && npx tsc --noEmit`
Expected: PASS; tsc clean. (`mastering-library.test.tsx` now sees GET `/marks` calls from the player; its `routeFetch` default branch returns `{}`, which the hook treats as a load error and shows inline — the existing assertions do not look there. If any existing assertion breaks because of the extra fetch, add a `/marks` branch returning `{ success: true, marks: [] }` to that file's `routeFetch`.)

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/ParentMarksPanel.tsx src/components/admin/MasteringPlayer.tsx src/components/admin/MasteringStudio.tsx __tests__/components/parent-marks.test.tsx __tests__/components/mastering-library.test.tsx
git commit -m "feat(marks): a new version lists its parent's marks to tick off"
```

---

### Task 8: Verify like CI, update the admin doc, open the PR

**Files:**
- Modify: `src/content/admin-docs.ts` (the Sound Engineering / mastering section: add a short "Marks and versions" paragraph)

- [ ] **Step 1: Admin doc paragraph**

Find the mastering doc section (`grep -n "Saved masters" src/content/admin-docs.ts | head`) and add, in that section's existing Markdown style:

```md
### Marks and versions

Marks made in a saved master's player are saved with that master: **M** marks a moment, **Save span** keeps the looped region. Each has a reason, a note and a status (Open, Fixed, Won't fix). A master made by re-opening a saved one, or by **Master this remix**, records where it came from ("Re-master of …", "Remix of …") and lists the previous version's marks so each can be ticked **Fixed here** or carried over with **Still there**. Times belong to each version: a different trim or a remix moves them. Nothing here changes any audio.
```

- [ ] **Step 2: Run the three CI steps**

```bash
export NODE_OPTIONS=--no-experimental-strip-types
npx tsc --noEmit
npm run lint
npm test -- --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB
```

Expected: tsc exit 0; lint 0 errors (warnings no more than master's 15); jest all suites pass.

- [ ] **Step 3: Commit and open the PR**

```bash
git add src/content/admin-docs.ts
git commit -m "docs(admin): marks and versions"
git push -u origin feat/repair-marks-lineage
gh pr create --repo rajeswaran140/poo-vaasam --head feat/repair-marks-lineage --base master \
  --title "Repair marks and version lineage (Repair Studio track 2)" \
  --body "Implements docs/superpowers/specs/2026-10-20-repair-marks-and-lineage-design.md. Web app only — no worker deploy, no migration. Rollback: revert; MARKS# items are inert."
```

---

## Deploy, migration and rollback (from the spec)

- **Migration:** none.
- **Deploy:** merge → Amplify build. No worker deploy.
- **Rollback:** revert the PR; Amplify rebuilds. `MARKS#` items stay unread; `derivedFrom` on jobs created in between is ignored by the old code.
- **After deploy (verify on the live admin):** open a saved master, press M, reload the page, and confirm the mark is still there; re-open that master, master it, save, and confirm the new row says "Re-master of …" and lists the parent's mark.
