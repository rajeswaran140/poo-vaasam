# Stem Library and Remix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every saved master a stem set that can be uploaded, organised and heard in the admin, and a remix that re-balances the stems into a new WAV which opens in Sound Engineering as a new master.

**Architecture:**
- One DynamoDB item per saved master holds the stem set.
- Stems keyed by a stable `stemId` in a map, so the worker can update one stem atomically.
- Files live under `audio/mastering/stems/<masterJobId>/`.
- The existing master worker gains two passes: `stemPreview` makes a small AAC listening copy and `stemMix` renders the remix.
- The browser mixes the listening copies live with Web Audio. The worker renders the real mix from the full WAVs.

**Tech Stack:** Next.js 15 (app router), TypeScript, zod, DynamoDB single table `TamilWebContent`, S3 bucket `tamil-web-media`, AWS Lambda `tamilagaval-master-worker` (Node 20 + ffmpeg 7.0.2 layer), jest + Testing Library (jsdom), Web Audio API.

**Spec:** `docs/superpowers/specs/2026-10-03-stem-library-and-remix-design.md`

## Global Constraints

- **Repo:** `rajeswaran140/poo-vaasam`, local checkout `~/projects/poo-vaasam-audit`, default branch `master`. Always pass `--repo rajeswaran140/poo-vaasam --head <branch>` to `gh`.
- **Node 20** for tests: `source ~/.nvm/nvm.sh && nvm use 20`.
- **CI is exactly:** `npx tsc --noEmit`, `npm run lint` (errors fail, there are ~15 standing warnings; add none), `npm test -- --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`. `tsc` excludes `__tests__`; only `npm run lint` sees test files.
- **Every admin API route** calls `await requireAdmin(request); requireBearer(request);` in a try/catch returning `authErrorResponse(err)`, before anything else.
- **Every S3 key** the server or worker touches must pass `isMasteringKey` (prefix `audio/mastering/`), and stem keys must be under that master's own folder `audio/mastering/stems/<masterJobId>/`.
- **Uploads:** WAV only (`ACCEPTED_UPLOAD_TYPES`), `MAX_UPLOAD_BYTES` = 500 MB, enforced by S3 `content-length-range` via `S3Operations.getSignedUploadPost`.
- **Worker events are Event-invoked:** validate every field inside the worker; never trust the route.
- **Errors render next to the control that caused them**, never only in the page banner. Tests assert the alert is a descendant of the relevant section.
- **Copy:** the song source is called **TamilAgaval Music** in anything visible; never "Suno"/"SUNO" in visible text.
- **The mixer note reads exactly:** *"A mix of the stems is a new version — it will not sound exactly like the original release."*
- **Fader range:** `gainDb` from **−60 to +6**. −60 plays as silence and renders as a muted stem.
- **Remix render:** `amix=inputs=N:normalize=0:duration=longest`, output **32-bit float WAV at 48 kHz** (`-c:a pcm_f32le -ar 48000`), muted stems excluded, `aresample=48000` only on a rate mismatch, `volume=<g>dB` only when `gainDb !== 0`, `apad` to the longest stem.
- **The remix key must never match `isMasterKey` or `isKaraokeMasterKey`.**
- **Saving a stem set must not touch the master's `updatedAt`.** The YouTube upload guard reads it.
- **Worker deploys are manual** (`npm run deploy:master-worker`) and only on Raj's explicit yes, after backing up the live zip to `~/lambda-backups/`.
- **Two PRs:** PR 1 = Tasks 1–8 (library), PR 2 = Tasks 9–14 (mixer and remix). Branch each from a fresh `master`.

## Review Focus

These inputs are implied by the spec but are not the main path of any task. Each one has a pinning test in the task named.

1. **Two stems finishing their listening copies at the same moment** must both be recorded. Neither may overwrite the other (a nested-map update per stem, not read-modify-write of a list). *Task 5*
2. **A stem removed while its listening copy is still being made:** the worker's late write must not recreate it (conditional update, `ConditionalCheckFailedException` ignored). *Task 5*
3. **Uploading the same file name twice** gives two distinct stems, not one overwritten stem (the key carries timestamp + nonce). *Task 1*
4. **Every stem muted, or at −60 dB:** Render remix is refused with a clear message, not a silent file. *Task 9*
5. **Sound Engineering opened with a `source` that is a mastering output, or outside the workspace:** it is ignored with a visible note, not loaded. *Task 13*

---

## File Structure

**Created**
- `src/lib/stems.ts`: pure helpers (ids, names, keys, validation, mix planning, ffmpeg args)
- `src/types/stemSet.ts`: the `StemSet` / `StemEntry` / `StemMix` / `StemRemix` types
- `src/infrastructure/database/StemSetRepository.ts`: the stem-set item, and `stemCount` on the master
- `src/app/api/admin/stems/[masterJobId]/route.ts`: GET the set
- `src/app/api/admin/stems/[masterJobId]/stems/route.ts`: POST add a stem
- `src/app/api/admin/stems/[masterJobId]/stems/[stemId]/route.ts`: PATCH rename, DELETE remove
- `src/app/api/admin/stems/[masterJobId]/mix/route.ts`: PUT save mix (Task 10)
- `src/app/api/admin/stems/[masterJobId]/remix/route.ts`: POST render remix (Task 10)
- `src/app/(admin)/admin/mastering/stems/[masterJobId]/page.tsx`: the page
- `src/components/admin/stems/StemsStudio.tsx`: page body (upload, list, mixer, remix)
- `src/components/admin/stems/StemUpload.tsx`: multi-file stem upload
- `src/components/admin/stems/useStemMixer.ts`: Web Audio mixer hook (Task 12)
- Tests beside each, under `__tests__/…` mirroring the path

**Modified**
- `src/lib/mastering-storage.ts`: nothing (reused)
- `src/lib/mastering-upload-client.ts`: `UploadKind` gains `'stem'`, plus an optional `masterJobId`
- `src/app/api/admin/mastering/upload/route.ts`: `kind: 'stem'` + `masterJobId`
- `src/types/masterJob.ts`, `src/infrastructure/database/MasterJobRepository.ts`: `stemCount`
- `worker/master-worker.ts`: `stemPreview` and `stemMix` events
- `src/components/admin/MasteringStudio.tsx`: the row's **Stems** link (Task 6); reading `?source=&title=&target=` (Task 13)
- `src/app/(admin)/AdminLayoutClient.tsx`: the title for `/admin/mastering/stems/*`
- `src/content/admin-docs.ts`: an Operations/Music Lab doc section

---

# PR 1 — Library (Tasks 1–8)

Branch: `git checkout master && git pull --ff-only && git checkout -b feat/stems-library`

### Task 1: Stem helpers — ids, names and keys

**Files:**
- Create: `src/lib/stems.ts`
- Test: `__tests__/lib/stems.test.ts`

**Interfaces:**
- Produces:
  - `STEMS_PREFIX = 'audio/mastering/stems/'`
  - `isValidMasterJobId(id: unknown): id is string`
  - `stemFolderFor(masterJobId: string): string`
  - `stemUploadKey(masterJobId: string, filename: string, now: number, nonce: string): string`
  - `stemIdFromKey(key: string): string`
  - `isStemKeyFor(masterJobId: string, key: string): boolean`
  - `stemPreviewKey(stemKey: string): string`
  - `stemRemixKey(masterJobId: string, now: number): string`
  - `guessStemName(filename: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/stems.test.ts
import {
  STEMS_PREFIX, isValidMasterJobId, stemFolderFor, stemUploadKey, stemIdFromKey,
  isStemKeyFor, stemPreviewKey, stemRemixKey, guessStemName,
} from '@/lib/stems';
import { isMasteringKey } from '@/lib/mastering-storage';
import { isMasterKey } from '@/lib/loudness-measure';
import { isKaraokeMasterKey } from '@/lib/master-peak';

const JOB = '0b5e2c1a-1111-4222-8333-444455556666';

describe('master job ids', () => {
  it('accepts the ids the master route mints, and nothing path-like', () => {
    expect(isValidMasterJobId(JOB)).toBe(true);
    for (const bad of ['', '../x', 'a/b', 'a'.repeat(65), 7, null]) expect(isValidMasterJobId(bad)).toBe(false);
  });
});

describe('stem keys', () => {
  it('lives in the master\'s own folder inside the mastering workspace', () => {
    expect(stemFolderFor(JOB)).toBe(`${STEMS_PREFIX}${JOB}/`);
    const k = stemUploadKey(JOB, '2_Drums.wav', 1696000000000, 'ab12cd34');
    expect(k).toBe(`audio/mastering/stems/${JOB}/1696000000000_ab12cd34_2_Drums.wav`);
    expect(isMasteringKey(k)).toBe(true);
    expect(isStemKeyFor(JOB, k)).toBe(true);
  });

  it('gives the same file name uploaded twice two different keys and ids', () => {
    const a = stemUploadKey(JOB, 'Vocals.wav', 1, 'aaaaaaaa');
    const b = stemUploadKey(JOB, 'Vocals.wav', 2, 'bbbbbbbb');
    expect(a).not.toBe(b);
    expect(stemIdFromKey(a)).not.toBe(stemIdFromKey(b));
  });

  it('refuses a key in another master\'s folder, outside the workspace, or escaping it', () => {
    const other = stemUploadKey('ffffffff-1111-4222-8333-444455556666', 'x.wav', 1, 'n');
    expect(isStemKeyFor(JOB, other)).toBe(false);
    expect(isStemKeyFor(JOB, 'audio/mastering/x.wav')).toBe(false);
    expect(isStemKeyFor(JOB, `audio/mastering/stems/${JOB}/../../x.wav`)).toBe(false);
    expect(isStemKeyFor(JOB, `audio/mastering/stems/${JOB}/preview/x.m4a`)).toBe(false);
  });

  it('derives a stable id, a preview key and a remix key', () => {
    const k = stemUploadKey(JOB, '2_Drums.wav', 1696000000000, 'ab12cd34');
    expect(stemIdFromKey(k)).toBe('1696000000000_ab12cd34_2_Drums');
    expect(stemPreviewKey(k)).toBe(`audio/mastering/stems/${JOB}/preview/1696000000000_ab12cd34_2_Drums.m4a`);
    const r = stemRemixKey(JOB, 1696000000000);
    expect(r).toBe(`audio/mastering/stems/${JOB}/remix/1696000000000-remix.wav`);
  });

  it('never makes a remix key the master route would refuse as a mastering output', () => {
    const r = stemRemixKey(JOB, 1696000000000);
    expect(isMasterKey(r)).toBe(false);
    expect(isKaraokeMasterKey(r)).toBe(false);
    expect(isMasteringKey(r)).toBe(true);
  });
});

describe('stem names', () => {
  it.each([
    ['2_Drums.wav', 'Drums'],
    ['01 - Lead Vocals.WAV', 'Lead Vocals'],
    ['Bass.wav', 'Bass'],
    ['12_Synth_Pad.wav', 'Synth Pad'],
    ['.wav', 'Stem'],
  ])('%s → %s', (file, name) => {
    expect(guessStemName(file)).toBe(name);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/stems.test.ts`
Expected: FAIL. `Cannot find module '@/lib/stems'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/stems.ts
/**
 * Stems — the separate parts (vocals, drums, bass…) TamilAgaval Music exports
 * for a song. One set per saved master, kept under that master's own folder in
 * the mastering workspace so every existing guard (isMasteringKey, the upload
 * policy, the worker's role) applies unchanged.
 *
 * ⚠️ The stems are resynthesised approximations, not extractions (measured
 * 2026-09-19): their sum is NOT the original record. A remix is a new version.
 */
import { MASTERING_PREFIX } from '@/lib/mastering-storage';

export const STEMS_PREFIX = `${MASTERING_PREFIX}stems/`;

/** The master route mints UUIDs. Anything path-like is refused. */
export function isValidMasterJobId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(id);
}

export function stemFolderFor(masterJobId: string): string {
  return `${STEMS_PREFIX}${masterJobId}/`;
}

function safeBase(filename: string): string {
  return (
    filename
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^a-zA-Z0-9-]/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 80) || 'stem'
  );
}

/** Timestamp + nonce: the same file name uploaded twice is two stems, never one overwritten. */
export function stemUploadKey(masterJobId: string, filename: string, now: number, nonce: string): string {
  return `${stemFolderFor(masterJobId)}${now}_${nonce}_${safeBase(filename)}.wav`;
}

/** The key's base name — unique per upload, and a valid DynamoDB map key. */
export function stemIdFromKey(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1).replace(/\.wav$/i, '');
}

/** A full-quality stem WAV directly in THIS master's folder — not a preview, not a remix, not elsewhere. */
export function isStemKeyFor(masterJobId: string, key: string): boolean {
  if (!isValidMasterJobId(masterJobId) || typeof key !== 'string' || key.includes('..')) return false;
  const folder = stemFolderFor(masterJobId);
  if (!key.startsWith(folder)) return false;
  const rest = key.slice(folder.length);
  return /^[^/]+\.wav$/i.test(rest);
}

export function stemPreviewKey(stemKey: string): string {
  const slash = stemKey.lastIndexOf('/');
  return `${stemKey.slice(0, slash)}/preview/${stemIdFromKey(stemKey)}.m4a`;
}

/** Never contains "-master": the master route refuses mastering outputs as sources. */
export function stemRemixKey(masterJobId: string, now: number): string {
  return `${stemFolderFor(masterJobId)}remix/${now}-remix.wav`;
}

/** "2_Drums.wav" → "Drums"; "01 - Lead Vocals.WAV" → "Lead Vocals". */
export function guessStemName(filename: string): string {
  const name = filename
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/^\s*\d+\s*[-_.)\s]+\s*/, '')
    .replace(/_/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return name || 'Stem';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/stems.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/stems.ts __tests__/lib/stems.test.ts
git commit -m "feat(stems): ids, names and keys for a master's stem folder"
```

---

### Task 2: The stem-set record and its repository

**Files:**
- Create: `src/types/stemSet.ts`, `src/infrastructure/database/StemSetRepository.ts`
- Modify: `src/types/masterJob.ts` (add `stemCount?: number | null`), `src/infrastructure/database/MasterJobRepository.ts` (`fromDBItem` reads `stemCount`)
- Test: `__tests__/infrastructure/StemSetRepository.test.ts`

**Interfaces:**
- Consumes: `stemIdFromKey`, `guessStemName` (Task 1).
- Produces:

```ts
// src/types/stemSet.ts
export interface StemEntry {
  key: string;
  name: string;
  previewKey: string | null;
  previewError: string | null;
  durationSec: number | null;
  sampleRate: number | null;
  channels: number | null;
}
export interface StemMixEntry { gainDb: number; muted: boolean }
export interface StemRemix {
  key: string | null;
  renderedAt: string | null;
  mixUsed: Record<string, StemMixEntry> | null;
  notes: string[];
  error: string | null;
  requestedAt: string | null;
}
export interface StemSet {
  masterJobId: string;
  order: string[];                       // stemIds in display order
  stems: Record<string, StemEntry>;      // keyed by stemId — atomic per-stem updates
  mix: Record<string, StemMixEntry>;
  remix: StemRemix | null;
  createdAt: string;
  updatedAt: string;
}
```

`StemSetRepository` methods:
- `get(masterJobId): Promise<StemSet | null>`
- `addStem(masterJobId, key, filename): Promise<StemSet>`
- `renameStem(masterJobId, stemId, name): Promise<void>`
- `removeStem(masterJobId, stemId): Promise<void>`

(`saveMix` and `markRemixRequested` arrive in Task 10.)

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/infrastructure/StemSetRepository.test.ts
const mockGet = jest.fn();
const mockUpdate = jest.fn();
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: {
    get: (...a: unknown[]) => mockGet(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
  },
  handleDynamoDBError: (e: unknown) => { throw e; },
}));

import { StemSetRepository } from '@/infrastructure/database/StemSetRepository';

const JOB = '0b5e2c1a-1111-4222-8333-444455556666';
const KEY = `audio/mastering/stems/${JOB}/1696000000000_ab12cd34_2_Drums.wav`;
const ID = '1696000000000_ab12cd34_2_Drums';
const repo = new StemSetRepository();

beforeEach(() => { mockGet.mockReset(); mockUpdate.mockReset().mockResolvedValue({}); });

describe('reading a set', () => {
  it('returns null when the master has no stems yet', async () => {
    mockGet.mockResolvedValue(null);
    expect(await repo.get(JOB)).toBeNull();
    expect(mockGet).toHaveBeenCalledWith({ PK: `STEMSET#${JOB}`, SK: 'METADATA' });
  });

  it('drops a malformed stem rather than handing the page an image with no key', async () => {
    mockGet.mockResolvedValue({
      PK: `STEMSET#${JOB}`, SK: 'METADATA', masterJobId: JOB,
      order: [ID, 'ghost'], stems: { [ID]: { key: KEY, name: 'Drums' }, ghost: { name: 'no key' } },
      mix: {}, remix: null, createdAt: 't', updatedAt: 't',
    });
    const set = await repo.get(JOB);
    expect(set!.order).toEqual([ID]);
    expect(set!.stems[ID]).toMatchObject({ key: KEY, name: 'Drums', previewKey: null, durationSec: null });
  });
});

describe('adding a stem', () => {
  it('creates the set on first use and appends in order, with a name guessed from the file', async () => {
    mockUpdate.mockResolvedValueOnce({
      masterJobId: JOB, order: [ID], stems: { [ID]: { key: KEY, name: 'Drums' } }, mix: {}, createdAt: 't', updatedAt: 't',
    });
    await repo.addStem(JOB, KEY, '2_Drums.wav');
    const calls = mockUpdate.mock.calls.map((c) => c[0]);
    const append = calls.find((c) => /list_append/.test(c.updateExpression))!;
    expect(append.key).toEqual({ PK: `STEMSET#${JOB}`, SK: 'METADATA' });
    expect(append.updateExpression).toMatch(/list_append\(if_not_exists\(#order, :empty\), :id\)/);
    const entry = calls.find((c) => /#stems\.#sid = :stem/.test(c.updateExpression))!;
    expect(entry.expressionAttributeNames['#sid']).toBe(ID);
    expect(entry.expressionAttributeValues[':stem']).toMatchObject({ key: KEY, name: 'Drums', previewKey: null });
  });

  it('keeps the master row\'s stem count in step, without touching its updatedAt', async () => {
    mockUpdate.mockResolvedValueOnce({ masterJobId: JOB, order: [ID, 'b'], stems: {}, mix: {}, createdAt: 't', updatedAt: 't' });
    await repo.addStem(JOB, KEY, '2_Drums.wav');
    const masterCall = mockUpdate.mock.calls.find((c) => c[0].key.PK === `MASTERJOB#${JOB}`)![0];
    expect(masterCall.updateExpression).toBe('SET #stemCount = :n');
    expect(masterCall.expressionAttributeValues[':n']).toBe(2);
    expect(JSON.stringify(masterCall)).not.toMatch(/updatedAt/);
  });
});

describe('renaming and removing', () => {
  it('renames one stem only if it still exists', async () => {
    await repo.renameStem(JOB, ID, '  Lead drums  ');
    const call = mockUpdate.mock.calls[0][0];
    expect(call.updateExpression).toBe('SET #stems.#sid.#name = :name, #updatedAt = :now');
    expect(call.conditionExpression).toBe('attribute_exists(#stems.#sid)');
    expect(call.expressionAttributeValues[':name']).toBe('Lead drums');
  });

  it('removes the stem, its mix entry and its place in the order', async () => {
    mockGet.mockResolvedValue({ masterJobId: JOB, order: ['a', ID, 'c'], stems: { a: { key: 'k' }, [ID]: { key: KEY }, c: { key: 'k2' } }, mix: {} });
    await repo.removeStem(JOB, ID);
    const call = mockUpdate.mock.calls[0][0];
    expect(call.updateExpression).toMatch(/REMOVE #stems\.#sid, #mix\.#sid/);
    expect(call.updateExpression).toMatch(/SET #order = :order/);
    expect(call.expressionAttributeValues[':order']).toEqual(['a', 'c']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/infrastructure/StemSetRepository.test.ts`
Expected: FAIL. Cannot find module `StemSetRepository`.

- [ ] **Step 3: Write minimal implementation**

Create `src/types/stemSet.ts` with the interfaces shown under **Interfaces** above. Then:

```ts
// src/infrastructure/database/StemSetRepository.ts
/**
 * A saved master's stem set: PK=STEMSET#<masterJobId>, SK=METADATA.
 *
 * ⚠️ STEMS ARE A MAP KEYED BY stemId, NOT A LIST. The worker records each
 * stem's listening copy as it finishes, and several finish at once; a list
 * would need read-modify-write and the second writer would erase the first.
 * A nested-map SET is atomic per stem. `order` carries display order.
 *
 * Writing a set also writes `stemCount` on the master, so the library row can
 * show "Stems (N)" without loading sets — and never touches the master's
 * `updatedAt`, which the YouTube upload guard reads.
 */
import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';
import type { StemSet, StemEntry, StemMixEntry, StemRemix } from '@/types/stemSet';
import { stemIdFromKey, guessStemName } from '@/lib/stems';

const keyFor = (masterJobId: string) => ({ PK: `STEMSET#${masterJobId}`, SK: 'METADATA' });

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function stemSetFromItem(i: Record<string, unknown>): StemSet {
  const rawStems = (i.stems ?? {}) as Record<string, Record<string, unknown>>;
  const stems: Record<string, StemEntry> = {};
  for (const [id, s] of Object.entries(rawStems)) {
    if (!s || typeof s.key !== 'string') continue;
    stems[id] = {
      key: s.key,
      name: typeof s.name === 'string' ? s.name : 'Stem',
      previewKey: typeof s.previewKey === 'string' ? s.previewKey : null,
      previewError: typeof s.previewError === 'string' ? s.previewError : null,
      durationSec: num(s.durationSec),
      sampleRate: num(s.sampleRate),
      channels: num(s.channels),
    };
  }
  const order = (Array.isArray(i.order) ? i.order : []).filter((id): id is string => typeof id === 'string' && id in stems);
  const mix: Record<string, StemMixEntry> = {};
  for (const [id, m] of Object.entries((i.mix ?? {}) as Record<string, Record<string, unknown>>)) {
    if (id in stems && m && typeof m.gainDb === 'number') mix[id] = { gainDb: m.gainDb, muted: m.muted === true };
  }
  const r = i.remix as Record<string, unknown> | null | undefined;
  const remix: StemRemix | null = r
    ? {
        key: typeof r.key === 'string' ? r.key : null,
        renderedAt: typeof r.renderedAt === 'string' ? r.renderedAt : null,
        mixUsed: (r.mixUsed as StemRemix['mixUsed']) ?? null,
        notes: Array.isArray(r.notes) ? (r.notes as unknown[]).filter((n): n is string => typeof n === 'string') : [],
        error: typeof r.error === 'string' ? r.error : null,
        requestedAt: typeof r.requestedAt === 'string' ? r.requestedAt : null,
      }
    : null;
  return {
    masterJobId: String(i.masterJobId ?? ''),
    order, stems, mix, remix,
    createdAt: String(i.createdAt ?? ''),
    updatedAt: String(i.updatedAt ?? ''),
  };
}

export class StemSetRepository {
  async get(masterJobId: string): Promise<StemSet | null> {
    try {
      const item = await DynamoDBOperations.get(keyFor(masterJobId));
      return item ? stemSetFromItem(item as Record<string, unknown>) : null;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async addStem(masterJobId: string, key: string, filename: string): Promise<StemSet> {
    try {
      const id = stemIdFromKey(key);
      const now = new Date().toISOString();
      const stem: StemEntry = {
        key, name: guessStemName(filename), previewKey: null, previewError: null,
        durationSec: null, sampleRate: null, channels: null,
      };
      const attrs = await DynamoDBOperations.update({
        key: keyFor(masterJobId),
        updateExpression:
          'SET #order = list_append(if_not_exists(#order, :empty), :id), #stems = if_not_exists(#stems, :emptyMap), ' +
          '#mix = if_not_exists(#mix, :emptyMap), #masterJobId = :job, #type = :type, ' +
          '#createdAt = if_not_exists(#createdAt, :now), #updatedAt = :now',
        expressionAttributeNames: {
          '#order': 'order', '#stems': 'stems', '#mix': 'mix', '#masterJobId': 'masterJobId',
          '#type': 'Type', '#createdAt': 'createdAt', '#updatedAt': 'updatedAt',
        },
        expressionAttributeValues: {
          ':empty': [], ':id': [id], ':emptyMap': {}, ':job': masterJobId, ':type': 'STEMSET', ':now': now,
        },
      });
      // A second, separate update: a map entry cannot be SET in the same
      // expression that might be creating the map with if_not_exists.
      const after = await DynamoDBOperations.update({
        key: keyFor(masterJobId),
        updateExpression: 'SET #stems.#sid = :stem',
        expressionAttributeNames: { '#stems': 'stems', '#sid': id },
        expressionAttributeValues: { ':stem': stem },
      });
      const set = stemSetFromItem((after ?? attrs ?? {}) as Record<string, unknown>);
      await this.writeCount(masterJobId, set.order.length);
      return set;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async renameStem(masterJobId: string, stemId: string, name: string): Promise<void> {
    try {
      await DynamoDBOperations.update({
        key: keyFor(masterJobId),
        updateExpression: 'SET #stems.#sid.#name = :name, #updatedAt = :now',
        conditionExpression: 'attribute_exists(#stems.#sid)',
        expressionAttributeNames: { '#stems': 'stems', '#sid': stemId, '#name': 'name', '#updatedAt': 'updatedAt' },
        expressionAttributeValues: { ':name': name.trim().slice(0, 80) || 'Stem', ':now': new Date().toISOString() },
      });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async removeStem(masterJobId: string, stemId: string): Promise<void> {
    try {
      const current = await this.get(masterJobId);
      if (!current) return;
      const order = current.order.filter((id) => id !== stemId);
      await DynamoDBOperations.update({
        key: keyFor(masterJobId),
        updateExpression: 'REMOVE #stems.#sid, #mix.#sid SET #order = :order, #updatedAt = :now',
        expressionAttributeNames: { '#stems': 'stems', '#mix': 'mix', '#sid': stemId, '#order': 'order', '#updatedAt': 'updatedAt' },
        expressionAttributeValues: { ':order': order, ':now': new Date().toISOString() },
      });
      await this.writeCount(masterJobId, order.length);
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /** `stemCount` on the master — and nothing else; never its updatedAt. */
  private async writeCount(masterJobId: string, n: number): Promise<void> {
    await DynamoDBOperations.update({
      key: { PK: `MASTERJOB#${masterJobId}`, SK: 'METADATA' },
      updateExpression: 'SET #stemCount = :n',
      expressionAttributeNames: { '#stemCount': 'stemCount' },
      expressionAttributeValues: { ':n': n },
    });
  }
}
```

**Note on `removeStem`:** the implementation writes `REMOVE #stems.#sid, #mix.#sid SET #order = :order, #updatedAt = :now`, which matches both regexes in the test. **Note on `addStem`:** it makes three updates (append + create, the stem entry, the master's count), so the test finds each call by its expression, never by position.

In `src/types/masterJob.ts` add, beside `videoMotion`:

```ts
  /** How many stems this master's stem set holds; null/absent ⇒ none. Written by StemSetRepository. */
  stemCount?: number | null;
```

In `MasterJobRepository.fromDBItem`, beside `videoMotion`:

```ts
      stemCount: typeof item.stemCount === 'number' ? item.stemCount : null,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/infrastructure/StemSetRepository.test.ts && npx tsc --noEmit`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/types/stemSet.ts src/infrastructure/database/StemSetRepository.ts src/types/masterJob.ts src/infrastructure/database/MasterJobRepository.ts __tests__/infrastructure/StemSetRepository.test.ts
git commit -m "feat(stems): the stem-set record — a map per stem, stemCount on the master"
```

---

### Task 3: Upload kind `stem`

**Files:**
- Modify: `src/app/api/admin/mastering/upload/route.ts`, `src/lib/mastering-upload-client.ts`
- Test: `__tests__/api/admin-mastering-upload-stem.test.ts`

**Interfaces:**
- Consumes: `stemUploadKey`, `isValidMasterJobId` (Task 1).
- Produces: `uploadToWorkspace(file, onProgress, signal, kind: UploadKind = 'audio', opts?: { masterJobId?: string }): Promise<string>`, where `UploadKind = 'audio' | 'cover' | 'stem'`. A `stem` upload returns a key from `stemUploadKey`.

- [ ] **Step 1: Write the failing test**

```ts
/** @jest-environment node */
// __tests__/api/admin-mastering-upload-stem.test.ts
jest.mock('@/lib/auth-helper', () => ({
  requireAdmin: jest.fn().mockResolvedValue({}), requireBearer: jest.fn(),
  authErrorResponse: jest.fn(() => new Response('no', { status: 401 })),
}));
const presign = jest.fn().mockResolvedValue({ url: 'https://s3/u', fields: { key: 'k' } });
jest.mock('@/infrastructure/storage/s3-client', () => ({ S3Operations: { getSignedUploadPost: (...a: unknown[]) => presign(...a) } }));

import { POST } from '@/app/api/admin/mastering/upload/route';
import { MAX_UPLOAD_BYTES } from '@/lib/mastering-storage';

const JOB = '0b5e2c1a-1111-4222-8333-444455556666';
const post = (body: unknown) =>
  POST(new Request('http://x/api/admin/mastering/upload', { method: 'POST', body: JSON.stringify(body) }) as never);

beforeEach(() => presign.mockClear());

it('puts a stem in its master\'s own folder, WAV only, with the WAV cap', async () => {
  const res = await post({ filename: '2_Drums.wav', contentType: 'audio/wav', size: 1000, kind: 'stem', masterJobId: JOB });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.key).toMatch(new RegExp(`^audio/mastering/stems/${JOB}/\\d+_[0-9a-f]{8}_2_Drums\\.wav$`));
  expect(presign).toHaveBeenCalledWith(body.key, 'audio/wav', MAX_UPLOAD_BYTES, expect.any(Number));
});

it('refuses a stem with no master, or a path-like one', async () => {
  for (const masterJobId of [undefined, '../x', 'a/b']) {
    const res = await post({ filename: 'x.wav', contentType: 'audio/wav', kind: 'stem', masterJobId });
    expect(res.status).toBe(400);
  }
  expect(presign).not.toHaveBeenCalled();
});

it('refuses a stem that is not a WAV', async () => {
  const res = await post({ filename: 'x.mp3', contentType: 'audio/mpeg', kind: 'stem', masterJobId: JOB });
  expect(res.status).toBe(400);
});

it('leaves ordinary audio uploads exactly as they were', async () => {
  const res = await post({ filename: 'take.wav', contentType: 'audio/wav' });
  const body = await res.json();
  expect(body.key).toMatch(/^audio\/mastering\/\d+_[0-9a-f]{8}_take\.wav$/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api/admin-mastering-upload-stem.test.ts`
Expected: FAIL. `kind` `'stem'` is rejected by the zod enum (400).

- [ ] **Step 3: Write minimal implementation**

In `upload/route.ts`:
- `kind: z.enum(['audio', 'cover', 'stem']).optional(), masterJobId: z.string().optional(),`
- after parsing: `const isStem = kind === 'stem'; if (isStem && !isValidMasterJobId(parsed.data.masterJobId)) return NextResponse.json({ success: false, error: 'A stem must belong to a saved master.' }, { status: 400 });`
- key: `const key = isCover ? masteringCoverKey(...) : isStem ? stemUploadKey(parsed.data.masterJobId!, filename, Date.now(), nonce) : masteringUploadKey(filename, Date.now(), nonce);`
- imports: `import { stemUploadKey, isValidMasterJobId } from '@/lib/stems';`

In `mastering-upload-client.ts`:

```ts
export type UploadKind = 'audio' | 'cover' | 'stem';
export async function uploadToWorkspace(
  file: File,
  onProgress: (loaded: number, total: number) => void,
  signal: AbortSignal,
  kind: UploadKind = 'audio',
  opts: { masterJobId?: string } = {}
): Promise<string> {
  // …unchanged prelude…
    body: JSON.stringify({
      filename: file.name,
      contentType: kind === 'cover' ? file.type : typeOk ? file.type : 'audio/wav',
      size: file.size,
      ...(kind !== 'audio' ? { kind } : {}),
      ...(kind === 'stem' ? { masterJobId: opts.masterJobId } : {}),
    }),
  // …unchanged…
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/api/admin-mastering-upload-stem.test.ts __tests__/api` (all upload tests stay green)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/mastering/upload/route.ts src/lib/mastering-upload-client.ts __tests__/api/admin-mastering-upload-stem.test.ts
git commit -m "feat(stems): a 'stem' upload kind, held to its master's folder"
```

---

### Task 4: Stems API — read, add, rename, remove

**Files:**
- Create:
  - `src/app/api/admin/stems/[masterJobId]/route.ts` (GET)
  - `src/app/api/admin/stems/[masterJobId]/stems/route.ts` (POST)
  - `src/app/api/admin/stems/[masterJobId]/stems/[stemId]/route.ts` (PATCH, DELETE)
- Test: `__tests__/api/admin-stems.test.ts`

**Interfaces:**
- Consumes: `StemSetRepository` (Task 2), `MasterJobRepository.get`, `isStemKeyFor`, `isValidMasterJobId`, `stemIdFromKey` (Task 1).
- Produces (HTTP):
  - `GET /api/admin/stems/:masterJobId` → `{ success, set: StemSet | null, master: { id, title, target } }`. 404 if the master doesn't exist or isn't saved.
  - `POST /api/admin/stems/:masterJobId/stems` with body `{ key, filename }` → 201 `{ success, set }`, and Event-invokes the worker with `{ stemPreview: { masterJobId, stemKey } }`.
  - `PATCH …/stems/:stemId` with body `{ name }` → `{ success }`.
  - `DELETE …/stems/:stemId` → `{ success }`.

- [ ] **Step 1: Write the failing test**

```ts
/** @jest-environment node */
// __tests__/api/admin-stems.test.ts
jest.mock('@/lib/auth-helper', () => ({
  requireAdmin: jest.fn().mockResolvedValue({}), requireBearer: jest.fn(),
  authErrorResponse: jest.fn(() => new Response('no', { status: 401 })),
}));
const masterGet = jest.fn();
jest.mock('@/infrastructure/database/MasterJobRepository', () => ({
  MasterJobRepository: jest.fn().mockImplementation(() => ({ get: masterGet })),
}));
const setGet = jest.fn(); const addStem = jest.fn(); const renameStem = jest.fn(); const removeStem = jest.fn();
jest.mock('@/infrastructure/database/StemSetRepository', () => ({
  StemSetRepository: jest.fn().mockImplementation(() => ({ get: setGet, addStem, renameStem, removeStem })),
}));
const lambdaSend = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({ send: lambdaSend })),
  InvokeCommand: jest.fn((args: unknown) => ({ args })),
}));
jest.mock('@/lib/aws-config', () => ({ awsConfig: { region: 'ca-central-1', credentials: undefined } }));

import { GET } from '@/app/api/admin/stems/[masterJobId]/route';
import { POST } from '@/app/api/admin/stems/[masterJobId]/stems/route';
import { PATCH, DELETE } from '@/app/api/admin/stems/[masterJobId]/stems/[stemId]/route';
import { requireAdmin } from '@/lib/auth-helper';

const JOB = '0b5e2c1a-1111-4222-8333-444455556666';
const KEY = `audio/mastering/stems/${JOB}/1696000000000_ab12cd34_2_Drums.wav`;
const SAVED = { id: JOB, status: 'done', savedAt: '2026-10-01T00:00:00.000Z', title: 'பாடல்', target: -14 };
const req = (method: string, body?: unknown) =>
  new Request('http://x', { method, ...(body ? { body: JSON.stringify(body) } : {}) }) as never;
const p = (extra: Record<string, string> = {}) => ({ params: Promise.resolve({ masterJobId: JOB, ...extra }) });

beforeEach(() => {
  jest.clearAllMocks();
  masterGet.mockResolvedValue(SAVED);
  setGet.mockResolvedValue(null);
  addStem.mockResolvedValue({ masterJobId: JOB, order: ['1696000000000_ab12cd34_2_Drums'], stems: {}, mix: {}, remix: null });
});

it('is admin-only, everywhere', async () => {
  (requireAdmin as jest.Mock).mockRejectedValueOnce(new Error('no'));
  expect((await GET(req('GET'), p())).status).toBe(401);
});

it('reads a master\'s set, null when it has none yet', async () => {
  const res = await GET(req('GET'), p());
  expect(await res.json()).toMatchObject({ success: true, set: null, master: { id: JOB, title: 'பாடல்', target: -14 } });
});

it('404s an unknown or unsaved master', async () => {
  masterGet.mockResolvedValueOnce(null);
  expect((await GET(req('GET'), p())).status).toBe(404);
  masterGet.mockResolvedValueOnce({ ...SAVED, savedAt: null });
  expect((await POST(req('POST', { key: KEY, filename: '2_Drums.wav' }), p())).status).toBe(404);
});

it('adds a stem from its own folder and asks the worker for a listening copy', async () => {
  const res = await POST(req('POST', { key: KEY, filename: '2_Drums.wav' }), p());
  expect(res.status).toBe(201);
  expect(addStem).toHaveBeenCalledWith(JOB, KEY, '2_Drums.wav');
  const payload = JSON.parse((lambdaSend.mock.calls[0][0] as { args: { Payload: Buffer } }).args.Payload.toString());
  expect(payload).toEqual({ stemPreview: { masterJobId: JOB, stemKey: KEY } });
});

it('refuses a key from another folder', async () => {
  const res = await POST(req('POST', { key: 'audio/mastering/x.wav', filename: 'x.wav' }), p());
  expect(res.status).toBe(400);
  expect(addStem).not.toHaveBeenCalled();
  expect(lambdaSend).not.toHaveBeenCalled();
});

it('renames and removes a stem by id', async () => {
  const sid = '1696000000000_ab12cd34_2_Drums';
  expect((await PATCH(req('PATCH', { name: 'Kick' }), p({ stemId: sid }))).status).toBe(200);
  expect(renameStem).toHaveBeenCalledWith(JOB, sid, 'Kick');
  expect((await DELETE(req('DELETE'), p({ stemId: sid }))).status).toBe(200);
  expect(removeStem).toHaveBeenCalledWith(JOB, sid);
});

it('refuses a path-like stem id', async () => {
  expect((await DELETE(req('DELETE'), p({ stemId: '../x' }))).status).toBe(400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api/admin-stems.test.ts`
Expected: FAIL. Cannot find the route modules.

- [ ] **Step 3: Write minimal implementation**

A shared guard at the top of each route file (repeat it in each file; do not import it from another route file):

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';
import { StemSetRepository } from '@/infrastructure/database/StemSetRepository';
import { isValidMasterJobId } from '@/lib/stems';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function savedMaster(masterJobId: string) {
  const job = await new MasterJobRepository().get(masterJobId);
  return job && job.savedAt ? job : null;
}
```

`[masterJobId]/route.ts`:

```ts
export async function GET(request: NextRequest, { params }: { params: Promise<{ masterJobId: string }> }) {
  try { await requireAdmin(request); requireBearer(request); } catch (err) { return authErrorResponse(err); }
  const { masterJobId } = await params;
  if (!isValidMasterJobId(masterJobId)) return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });
  try {
    const job = await savedMaster(masterJobId);
    if (!job) return NextResponse.json({ success: false, error: 'No saved master with that id.' }, { status: 404 });
    const set = await new StemSetRepository().get(masterJobId);
    return NextResponse.json({ success: true, set, master: { id: job.id, title: job.title ?? null, target: job.target } });
  } catch (err) {
    console.error('[api/admin/stems] read failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not load the stems.' }, { status: 502 });
  }
}
```

`[masterJobId]/stems/route.ts` (POST): zod `{ key: z.string().min(1).max(1024), filename: z.string().min(1).max(255) }`.
- Check `isStemKeyFor(masterJobId, key)` → 400 `'That file is not in this song’s stem folder.'`.
- `savedMaster` → 404.
- `const set = await repo.addStem(masterJobId, key, filename)`.
- Event-invoke `MASTER_WORKER_FUNCTION` (`process.env.MASTER_WORKER_FUNCTION || 'tamilagaval-master-worker'`) with `{ stemPreview: { masterJobId, stemKey: key } }`.
- Return 201 `{ success: true, set }`.
- If the invoke throws, still return 201 with `{ success: true, set, previewQueued: false }`: the stem is stored and the page shows "listening copy not started", with a **Retry** button sending `POST` again with the same key. `addStem` must be idempotent: if `stemIdFromKey(key)` is already in `order`, skip the `list_append` (check with `get` first).

`[masterJobId]/stems/[stemId]/route.ts`:
- `stemId` must match `/^[A-Za-z0-9_-]{1,120}$/`, else 400.
- `PATCH` zod `{ name: z.string().min(1).max(80) }` → `renameStem`. Map `ConditionalCheckFailedException` → 404 `'That stem is no longer in the set.'`.
- `DELETE` → `removeStem`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/api/admin-stems.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/stems __tests__/api/admin-stems.test.ts src/infrastructure/database/StemSetRepository.ts
git commit -m "feat(stems): API to read a master's stems, add, rename and remove them"
```

---

### Task 5: Worker — the listening copy (`stemPreview`)

**Files:**
- Modify: `worker/master-worker.ts` (event type, handler branch, `makeStemPreview`)
- Test: `__tests__/worker/master-worker.test.ts` (new `describe('stem listening copy')`)

**Interfaces:**
- Consumes: `isStemKeyFor`, `isValidMasterJobId`, `stemPreviewKey`, `stemIdFromKey` (Task 1); the existing `ff`, `s3`, `ddb`, `parseSourceInfo`.
- Produces:
  - worker event `{ stemPreview: { masterJobId: string; stemKey: string } }`;
  - writes `stems.<id>.previewKey | previewError | durationSec | sampleRate | channels` on `STEMSET#<id>`.

- [ ] **Step 1: Write the failing test**

```ts
describe('stem listening copy', () => {
  const JOB = '0b5e2c1a-1111-4222-8333-444455556666';
  const KEY = `audio/mastering/stems/${JOB}/1696000000000_ab12cd34_2_Drums.wav`;
  const HEADER = `Input #0, wav, from '/tmp/stem.wav':
  Duration: 00:03:41.92, bitrate: 2304 kb/s
  Stream #0:0: Audio: pcm_s24le ([1][0][0][0] / 0x0001), 44100 Hz, stereo, s32 (24 bit), 2304 kb/s
`;
  const updates = () => send.mock.calls.map((c) => (c[0] as { input: Record<string, unknown> }).input);

  beforeEach(() => {
    spawnSync.mockReset();
    spawnSync.mockImplementation((_c: unknown, args: string[]) =>
      args.length === 3 && args[1] === '-i' ? { status: 0, stdout: '', stderr: HEADER } : { status: 0, stdout: '', stderr: '' });
    s3Send.mockReset();
    s3Send.mockImplementation((cmd: { input: Record<string, unknown> }) =>
      'Body' in cmd.input ? Promise.resolve({}) : Promise.resolve({ Body: { transformToByteArray: async () => new Uint8Array([1]) } }));
    send.mockClear();
  });

  it('encodes a small AAC copy, uploads it beside the stem, and records it on that stem only', async () => {
    const res = await handler({ stemPreview: { masterJobId: JOB, stemKey: KEY } } as never);
    expect(res).toMatchObject({ ok: true });
    const enc = spawnSync.mock.calls.map((c) => c[1] as string[]).find((a) => a.includes('aac'))!;
    expect(enc).toEqual(expect.arrayContaining(['-c:a', 'aac', '-b:a', '128k', '-ac', '2']));
    const put = s3Send.mock.calls.map((c) => c[0].input).find((i) => 'Body' in i);
    expect(put).toMatchObject({ Key: `audio/mastering/stems/${JOB}/preview/1696000000000_ab12cd34_2_Drums.m4a`, ContentType: 'audio/mp4' });
    const u = updates().find((i) => String(i.UpdateExpression).includes('previewKey'))!;
    expect(u.Key).toEqual({ PK: `STEMSET#${JOB}`, SK: 'METADATA' });
    // ONE stem's fields, by nested path — two finishing at once cannot erase each other.
    expect(u.UpdateExpression).toMatch(/#stems\.#sid\.#previewKey = :pk/);
    expect(u.ExpressionAttributeNames).toMatchObject({ '#sid': '1696000000000_ab12cd34_2_Drums' });
    expect(u.ExpressionAttributeValues).toMatchObject({ ':dur': 221.9, ':rate': 44100, ':ch': 2 });
    expect(u.ConditionExpression).toBe('attribute_exists(#stems.#sid)');
  });

  it('does not recreate a stem that was removed while its copy was being made', async () => {
    send.mockImplementationOnce(() => Promise.reject(Object.assign(new Error('gone'), { name: 'ConditionalCheckFailedException' })));
    const res = await handler({ stemPreview: { masterJobId: JOB, stemKey: KEY } } as never);
    expect(res).toMatchObject({ ok: true, removed: true });
  });

  it('records why, on the stem, when the encode fails', async () => {
    spawnSync.mockImplementation((_c: unknown, args: string[]) =>
      args.includes('aac') ? { status: 1, stdout: '', stderr: 'boom' } : { status: 0, stdout: '', stderr: HEADER });
    const res = await handler({ stemPreview: { masterJobId: JOB, stemKey: KEY } } as never);
    expect(res).toMatchObject({ ok: false });
    const u = updates().find((i) => String(i.UpdateExpression).includes('previewError'))!;
    expect(u.ExpressionAttributeValues).toMatchObject({ ':err': 'the listening copy could not be made' });
  });

  it('refuses a key outside that master\'s stem folder without reading S3', async () => {
    const res = await handler({ stemPreview: { masterJobId: JOB, stemKey: 'audio/poem-music/x.wav' } } as never);
    expect(res).toMatchObject({ ok: false });
    expect(s3Send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/worker/master-worker.test.ts -t "stem listening copy"`
Expected: FAIL. The handler falls through to the mastering path (`jobId, s3Key … required`).

- [ ] **Step 3: Write minimal implementation**

In `MasterEvent`: `stemPreview?: { masterJobId?: string; stemKey?: string };`

In `handler`, before the mastering fall-through:

```ts
  if (event?.stemPreview) {
    if (!TAKES_BUCKET) return { ok: false, error: 'TAKES_BUCKET is required' };
    return await makeStemPreview(event.stemPreview, TAKES_BUCKET);
  }
```

```ts
/**
 * A stem's LISTENING COPY: AAC 128k stereo, ~5 MB for five minutes, so the
 * page can load every stem of a song for the live mixer without a 1 GB
 * download. The full WAV stays the source of every render.
 *
 * ⚠️ Writes ONE stem's fields by nested path, conditional on the stem still
 * existing: several copies finish at once, and a stem may be removed while
 * its copy is being made — neither may clobber or resurrect anything.
 */
async function makeStemPreview(spec: NonNullable<MasterEvent['stemPreview']>, bucket: string) {
  const masterJobId = spec.masterJobId ?? '';
  const stemKey = spec.stemKey ?? '';
  if (!isValidMasterJobId(masterJobId) || !isStemKeyFor(masterJobId, stemKey)) {
    console.error('[master-worker] bad stemPreview event');
    return { ok: false };
  }
  const sid = stemIdFromKey(stemKey);
  const write = async (sets: Record<string, unknown>) => {
    const names: Record<string, string> = { '#stems': 'stems', '#sid': sid };
    const values: Record<string, unknown> = {};
    const parts: string[] = [];
    for (const [field, [ph, v]] of Object.entries(sets as Record<string, [string, unknown]>)) {
      names[`#${field}`] = field;
      values[ph] = v;
      parts.push(`#stems.#sid.#${field} = ${ph}`);
    }
    try {
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `STEMSET#${masterJobId}`, SK: 'METADATA' },
        UpdateExpression: `SET ${parts.join(', ')}`,
        ConditionExpression: 'attribute_exists(#stems.#sid)',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }));
      return 'ok' as const;
    } catch (err) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return 'removed' as const;
      throw err;
    }
  };

  const dir = mkdtempSync(join(tmpdir(), 'stem-'));
  const wav = join(dir, 'stem.wav');
  const out = join(dir, 'preview.m4a');
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: stemKey }));
    writeFileSync(wav, Buffer.from(await obj.Body!.transformToByteArray()));
    const header = ff(['-hide_banner', '-i', wav]);
    const info = parseSourceInfo(`${header.stdout ?? ''}${header.stderr ?? ''}`);
    const enc = ff(['-hide_banner', '-nostats', '-i', wav, '-vn', '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart', '-y', out]);
    if (enc.status !== 0) {
      await write({ previewError: [':err', 'the listening copy could not be made'] });
      return { ok: false };
    }
    const previewKey = stemPreviewKey(stemKey);
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: previewKey, Body: readFileSync(out), ContentType: 'audio/mp4' }));
    const r = await write({
      previewKey: [':pk', previewKey],
      previewError: [':noerr', null],
      durationSec: [':dur', info?.durationSec ?? null],
      sampleRate: [':rate', info?.sampleRate ?? null],
      channels: [':ch', info?.channels ?? null],
    });
    return r === 'removed' ? { ok: true, removed: true } : { ok: true, previewKey };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[master-worker] stem preview failed:', message);
    await write({ previewError: [':err', message] }).catch(() => {});
    return { ok: false };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
```

Imports: `import { isValidMasterJobId, isStemKeyFor, stemIdFromKey, stemPreviewKey } from '@/lib/stems';`. The tests' mocked `send` stands in for `ddb.send`. Ensure the conditional-failure test's first `send` call is the update (the worker makes no other DynamoDB call in this pass).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/worker/master-worker.test.ts`
Expected: PASS, all worker tests.

- [ ] **Step 5: Commit**

```bash
git add worker/master-worker.ts __tests__/worker/master-worker.test.ts
git commit -m "feat(stems): worker makes each stem's listening copy, one stem at a time"
```

---

### Task 6: The **Stems** link on the saved-master row

**Files:**
- Modify: `src/components/admin/MasteringStudio.tsx` (row link list, beside **Vertical**)
- Test: `__tests__/components/mastering-row-stems.test.tsx` (copy the harness from `__tests__/components/mastering-row-vertical.test.tsx`: `routeFetch`, `openLibrary`, `rowFor`, `masterFixture`)

**Interfaces:**
- Consumes: `MasterJob.stemCount` (Task 2).
- Produces: a link `href="/admin/mastering/stems/<id>"` labelled `Stems (N)` or `Add stems`.

- [ ] **Step 1: Write the failing test**

```tsx
it('offers "Add stems" on a master with none', async () => {
  routeFetch({}, [masterFixture()]);
  await openLibrary();
  const link = within(rowFor(SONG)).getByRole('link', { name: /^Add stems$/ });
  expect(link).toHaveAttribute('href', '/admin/mastering/stems/job1');
});

it('shows the count when the master has stems', async () => {
  routeFetch({}, [masterFixture({ stemCount: 11 })]);
  await openLibrary();
  expect(within(rowFor(SONG)).getByRole('link', { name: /^Stems \(11\)$/ })).toHaveAttribute('href', '/admin/mastering/stems/job1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/mastering-row-stems.test.tsx`
Expected: FAIL. No link named `Add stems`.

- [ ] **Step 3: Write minimal implementation**

In the row's download links (after the `m.verticalKey && (…Vertical…)` button), add:

```tsx
                    {/* The song's stems live on their own page — the library
                        row only says whether there are any. */}
                    <a
                      href={`/admin/mastering/stems/${m.id}`}
                      className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      {m.stemCount ? `Stems (${m.stemCount})` : 'Add stems'}
                    </a>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/mastering-row-stems.test.tsx __tests__/components/mastering-row-errors.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/MasteringStudio.tsx __tests__/components/mastering-row-stems.test.tsx
git commit -m "feat(stems): a Stems link on each saved master's row"
```

---

### Task 7: The Stems page — upload, list, rename, remove, play

**Files:**
- Create:
  - `src/app/(admin)/admin/mastering/stems/[masterJobId]/page.tsx`
  - `src/components/admin/stems/StemsStudio.tsx`
  - `src/components/admin/stems/StemUpload.tsx`
- Modify: `src/app/(admin)/AdminLayoutClient.tsx` (title for this route)
- Test: `__tests__/components/stems/StemsStudio.test.tsx`

**Interfaces:**
- Consumes: the Task 4 HTTP API; `uploadToWorkspace(…, 'stem', { masterJobId })` (Task 3); `/api/admin/mastering/download?key=…&mode=play` → `{ success, url }`.
- Produces: `<StemsStudio masterJobId={string} />`, which loads everything client-side via `adminFetch`. Task 12 adds the mixer inside it.

- [ ] **Step 1: Write the failing test**

```tsx
/** @jest-environment jsdom */
// __tests__/components/stems/StemsStudio.test.tsx
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
const uploadMock = jest.fn();
jest.mock('@/lib/mastering-upload-client', () => ({ uploadToWorkspace: (...a: unknown[]) => uploadMock(...a), putToS3: jest.fn() }));

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { StemsStudio } from '@/components/admin/stems/StemsStudio';
import { adminFetch } from '@/lib/client-auth';
const mockedFetch = adminFetch as jest.Mock;

const JOB = '0b5e2c1a-1111-4222-8333-444455556666';
const ID = '1696000000000_ab12cd34_2_Drums';
const KEY = `audio/mastering/stems/${JOB}/${ID}.wav`;
const ok = (b: unknown) => ({ ok: true, json: async () => b }) as Response;
const refuse = (error: string, status = 400) => ({ ok: false, status, json: async () => ({ success: false, error }) }) as Response;
const SET = {
  masterJobId: JOB, order: [ID],
  stems: { [ID]: { key: KEY, name: 'Drums', previewKey: `audio/mastering/stems/${JOB}/preview/${ID}.m4a`, previewError: null, durationSec: 221.9, sampleRate: 48000, channels: 2 } },
  mix: {}, remix: null, createdAt: 't', updatedAt: 't',
};
function route(over: Partial<Record<'get' | 'add' | 'patch' | 'del' | 'play', Response>> = {}, set: unknown = SET) {
  mockedFetch.mockImplementation((url: string, init?: { method?: string }) => {
    const m = init?.method ?? 'GET';
    if (url === `/api/admin/stems/${JOB}` && m === 'GET') return Promise.resolve(over.get ?? ok({ success: true, set, master: { id: JOB, title: 'பாடல்', target: -14 } }));
    if (url === `/api/admin/stems/${JOB}/stems` && m === 'POST') return Promise.resolve(over.add ?? ok({ success: true, set }));
    if (url.startsWith(`/api/admin/stems/${JOB}/stems/`) && m === 'PATCH') return Promise.resolve(over.patch ?? ok({ success: true }));
    if (url.startsWith(`/api/admin/stems/${JOB}/stems/`) && m === 'DELETE') return Promise.resolve(over.del ?? ok({ success: true }));
    if (url.startsWith('/api/admin/mastering/download')) return Promise.resolve(over.play ?? ok({ success: true, url: 'https://s3/p' }));
    return Promise.resolve(ok({}));
  });
}
beforeEach(() => { mockedFetch.mockReset(); uploadMock.mockReset().mockResolvedValue(KEY); });

it('names the song and lists its stems with length and rate', async () => {
  route();
  render(<StemsStudio masterJobId={JOB} />);
  expect(await screen.findByText('பாடல்')).toBeInTheDocument();
  const row = screen.getByRole('listitem', { name: /Drums/ });
  expect(within(row).getByText(/3:42/)).toBeInTheDocument();
  expect(within(row).getByText(/48 kHz/)).toBeInTheDocument();
});

it('uploads dropped stems as stems of THIS master, then registers each', async () => {
  route({}, null);
  render(<StemsStudio masterJobId={JOB} />);
  await screen.findByText('பாடல்');
  const input = screen.getByLabelText(/Add stem WAVs/i);
  fireEvent.change(input, { target: { files: [new File(['x'], '2_Drums.wav', { type: 'audio/wav' })] } });
  await waitFor(() => expect(uploadMock).toHaveBeenCalled());
  expect(uploadMock.mock.calls[0][3]).toBe('stem');
  expect(uploadMock.mock.calls[0][4]).toEqual({ masterJobId: JOB });
  await waitFor(() => {
    const add = mockedFetch.mock.calls.find((c) => c[0] === `/api/admin/stems/${JOB}/stems`);
    expect(JSON.parse(add![1].body)).toEqual({ key: KEY, filename: '2_Drums.wav' });
  });
});

it('shows "Preparing listening copy…" until the copy exists', async () => {
  route({}, { ...SET, stems: { [ID]: { ...SET.stems[ID], previewKey: null } } });
  render(<StemsStudio masterJobId={JOB} />);
  const row = await screen.findByRole('listitem', { name: /Drums/ });
  expect(within(row).getByText(/Preparing listening copy/)).toBeInTheDocument();
});

it('renames a stem inline', async () => {
  route();
  render(<StemsStudio masterJobId={JOB} />);
  const row = await screen.findByRole('listitem', { name: /Drums/ });
  fireEvent.click(within(row).getByRole('button', { name: /Rename Drums/ }));
  const box = within(row).getByLabelText(/Stem name/);
  fireEvent.change(box, { target: { value: 'Kick and snare' } });
  fireEvent.keyDown(box, { key: 'Enter' });
  await waitFor(() => {
    const call = mockedFetch.mock.calls.find((c) => String(c[0]).endsWith(`/stems/${ID}`) && c[1]?.method === 'PATCH');
    expect(JSON.parse(call![1].body)).toEqual({ name: 'Kick and snare' });
  });
});

it('reports a refused removal inside that stem\'s row', async () => {
  route({ del: refuse('That stem is no longer in the set.', 404) });
  render(<StemsStudio masterJobId={JOB} />);
  const row = await screen.findByRole('listitem', { name: /Drums/ });
  fireEvent.click(within(row).getByRole('button', { name: /Remove Drums/ }));
  await waitFor(() => expect(within(row).getByRole('alert')).toHaveTextContent(/no longer in the set/));
});

it('flags a stem whose rate differs from the rest', async () => {
  const B = '1696000000001_ab12cd35_Bass';
  route({}, { ...SET, order: [ID, B, 'c'], stems: {
    [ID]: SET.stems[ID],
    [B]: { ...SET.stems[ID], key: `audio/mastering/stems/${JOB}/${B}.wav`, name: 'Bass', sampleRate: 44100 },
    c: { ...SET.stems[ID], key: `audio/mastering/stems/${JOB}/c.wav`, name: 'Strings' },
  } });
  render(<StemsStudio masterJobId={JOB} />);
  const row = await screen.findByRole('listitem', { name: /Bass/ });
  expect(within(row).getByText(/44\.1 kHz — will be resampled to 48 kHz/)).toBeInTheDocument();
});

it('downloads a stem\'s full WAV, not its listening copy', async () => {
  route();
  const open = jest.spyOn(window, 'open').mockImplementation(() => null);
  render(<StemsStudio masterJobId={JOB} />);
  const row = await screen.findByRole('listitem', { name: /Drums/ });
  fireEvent.click(within(row).getByRole('button', { name: /Download Drums/ }));
  await waitFor(() => expect(open).toHaveBeenCalledWith('https://s3/p', '_blank', 'noopener'));
  const call = mockedFetch.mock.calls.find((c) => String(c[0]).startsWith('/api/admin/mastering/download'))!;
  expect(String(call[0])).toContain(`key=${encodeURIComponent(KEY)}`);
  expect(String(call[0])).not.toContain('mode=play');
  open.mockRestore();
});

it('never says SUNO', async () => {
  route();
  render(<StemsStudio masterJobId={JOB} />);
  await screen.findByText('பாடல்');
  expect(document.body.textContent).not.toMatch(/suno/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/stems/StemsStudio.test.tsx`
Expected: FAIL. Cannot find module `StemsStudio`.

- [ ] **Step 3: Write minimal implementation**

`page.tsx`:

```tsx
import { StemsStudio } from '@/components/admin/stems/StemsStudio';

export default async function StemsPage({ params }: { params: Promise<{ masterJobId: string }> }) {
  const { masterJobId } = await params;
  return <StemsStudio masterJobId={masterJobId} />;
}
```

`AdminLayoutClient.tsx`: before the `PAGE_TITLES[pathname]` lookup, add:

```ts
  const isStemsPage = pathname.startsWith("/admin/mastering/stems/");
  const pageInfo = isEditPage
    ? { title: "Edit Content", subtitle: "Update existing content" }
    : isStemsPage
      ? { title: "Stems", subtitle: "A song's separate parts — store, hear and remix them" }
      : PAGE_TITLES[pathname] || { title: "Admin", subtitle: "Manage your platform" };
```

`StemUpload.tsx` copies `BulkWavUpload`'s per-file queue (states `queued | uploading | registering | done | error | cancelled`, one `AbortController` for the batch, **Cancel**, drag-and-drop, a row error with `role="alert"`). Differences:
- it calls `uploadToWorkspace(file, onProgress, signal, 'stem', { masterJobId })`;
- after each upload it `POST`s `{ key, filename: file.name }` to `/api/admin/stems/${masterJobId}/stems`;
- then it calls `onAdded(set)`.

The file `<input>` carries `aria-label="Add stem WAVs"` and `multiple`, `accept=".wav,audio/wav"`.

`StemsStudio.tsx` (client component):
- **State:** `set`, `master`, `loadError`, `rowError: { stemId, message } | null`, `renaming: string | null`.
- **Load:** on mount, `GET /api/admin/stems/${masterJobId}`. While any stem has `previewKey === null && previewError === null`, poll every 4 s, and stop when none are pending or on unmount.
- **Header:** the song title (`master.title`), a link **← Sound Engineering** to `/admin/mastering`.
- **Upload section:** `<StemUpload masterJobId onAdded={setSet} />`.
- **The list:** `<ul>`, one `<li aria-label={stem.name}>` per id in `set.order`, showing:
  - the name, with a **Rename {name}** button that swaps in an `<input aria-label="Stem name">`; Enter saves via PATCH, Escape cancels;
  - the length as `m:ss` (`formatClock` from `ShortWindowFields`, rounded to whole seconds) and the rate as `48 kHz` / `44.1 kHz`;
  - a status: *Preparing listening copy…* while `previewKey` is null, or the `previewError` text in an alert;
  - a play button (an `<audio controls>` whose `src` is fetched on demand from the download route with `mode=play`, for the preview key);
  - **Download {name}**: fetches `/api/admin/mastering/download?key=<full WAV key>&name=<stem name>` (no `mode`, so it is an attachment) and opens the returned URL in a new tab (the spec's "Download stems", one per stem);
  - **Remove {name}**.
  - A row's refusal renders as `<p role="alert">` inside that `<li>`.
- **Mismatch rule:** compute the majority `sampleRate`. A stem with a different rate shows `"{x} kHz — will be resampled to 48 kHz"` when the majority is 48000, else `"{x} kHz — differs from the others"`. A stem more than 0.1 s shorter than the longest shows `"shorter by {s}s — padded with silence when mixed"`.
- **Empty state:** "No stems yet — drop the song's stem WAVs above."
- **Copy:** use "TamilAgaval Music" if the source is named anywhere; never "Suno".

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/stems/StemsStudio.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(admin)/admin/mastering/stems" src/components/admin/stems "src/app/(admin)/AdminLayoutClient.tsx" __tests__/components/stems
git commit -m "feat(stems): the Stems page — upload, list, rename, remove and play"
```

---

### Task 8: PR 1 wrap-up — doc, full CI, PR, worker deploy

**Files:**
- Modify: `src/content/admin-docs.ts`. Add a doc `{ slug: 'stems', title: 'Stems — store and hear a song’s parts', category: 'Music Lab', updatedAt: <now ISO> }` covering:
  - what stems are;
  - the **Add stems / Stems (N)** link;
  - upload;
  - listening copies;
  - rename and remove;
  - the mismatch notes;
  - the warning that a mix of stems is a new version.

  Follow the house style of the neighbouring docs: short headings, ⚠️ for traps.
- Test: the existing `__tests__/content` suites must stay green (they validate doc structure).

- [ ] **Step 1:** Add the doc section. Run `npx jest __tests__/content`. Expected: PASS.
- [ ] **Step 2:** Full CI: `npx tsc --noEmit && npm run lint && npm test -- --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`. Expected: 0 type errors, 0 lint errors (warning count unchanged), all suites green.
- [ ] **Step 3:** Commit and push. Open the PR: `gh pr create --repo rajeswaran140/poo-vaasam --base master --head feat/stems-library` with a plain-language body that ends with the attribution line. Wait for `verify` to pass.
- [ ] **Step 4:** After Raj merges: back up the live worker zip to `~/lambda-backups/`, check its SHA matches, **ask Raj**, and deploy only on his yes (`npm run deploy:master-worker`). Confirm the live `CodeSha256` matches the build.

---

# PR 2 — Mixer and remix (Tasks 9–14)

Branch: `git checkout master && git pull --ff-only && git checkout -b feat/stems-remix`

### Task 9: Planning the remix and building its ffmpeg arguments

**Files:**
- Modify: `src/lib/stems.ts`
- Test: `__tests__/lib/stems.test.ts`

**Interfaces:**
- Consumes: `StemSet` (Task 2).
- Produces:

```ts
export const MIN_GAIN_DB = -60;
export const MAX_GAIN_DB = 6;
export interface RemixInput { stemId: string; key: string; name: string; gainDb: number; sampleRate: number | null; durationSec: number | null }
export type RemixPlan =
  | { ok: true; inputs: RemixInput[]; longestSec: number | null; notes: string[] }
  | { ok: false; message: string };
export function planRemix(set: StemSet): RemixPlan;
export function buildRemixArgs(p: { inputs: Array<{ path: string; gainDb: number; sampleRate: number | null }>; outPath: string }): string[];
```

- [ ] **Step 1: Write the failing test**

```ts
import { planRemix, buildRemixArgs, MIN_GAIN_DB, MAX_GAIN_DB } from '@/lib/stems';
import type { StemSet } from '@/types/stemSet';

const stem = (id: string, over: Record<string, unknown> = {}) => ({
  key: `audio/mastering/stems/J/${id}.wav`, name: id, previewKey: 'p', previewError: null,
  durationSec: 200, sampleRate: 48000, channels: 2, ...over,
});
const set = (stems: Record<string, ReturnType<typeof stem>>, mix: StemSet['mix'] = {}): StemSet => ({
  masterJobId: 'J', order: Object.keys(stems), stems, mix, remix: null, createdAt: 't', updatedAt: 't',
});

describe('planning a remix', () => {
  it('uses every unmuted stem at its saved level, 0 dB by default', () => {
    const p = planRemix(set({ a: stem('a'), b: stem('b') }, { b: { gainDb: -3, muted: false } }));
    expect(p.ok && p.inputs.map((i) => [i.stemId, i.gainDb])).toEqual([['a', 0], ['b', -3]]);
  });

  it('leaves muted stems, and stems at the floor, out entirely', () => {
    const p = planRemix(set({ a: stem('a'), b: stem('b'), c: stem('c') }, {
      b: { gainDb: 0, muted: true }, c: { gainDb: MIN_GAIN_DB, muted: false },
    }));
    expect(p.ok && p.inputs.map((i) => i.stemId)).toEqual(['a']);
  });

  it('refuses a mix with nothing audible in it', () => {
    const p = planRemix(set({ a: stem('a') }, { a: { gainDb: 0, muted: true } }));
    expect(p).toEqual({ ok: false, message: 'Every stem is muted — unmute at least one to render a remix.' });
  });

  it('notes resampling and padding, by stem name', () => {
    const p = planRemix(set({ Vox: stem('Vox'), Bass: stem('Bass', { sampleRate: 44100, durationSec: 199.7 }) }));
    expect(p.ok && p.notes).toEqual([
      'Bass resampled from 44.1 kHz to 48 kHz',
      'Bass padded by 0.3 s to match the longest stem',
    ]);
  });

  it('clamps a level outside the fader range', () => {
    const p = planRemix(set({ a: stem('a') }, { a: { gainDb: 40, muted: false } }));
    expect(p.ok && p.inputs[0].gainDb).toBe(MAX_GAIN_DB);
  });
});

describe('the remix encode', () => {
  const args = buildRemixArgs({
    inputs: [
      { path: '/t/0.wav', gainDb: 0, sampleRate: 48000 },
      { path: '/t/1.wav', gainDb: -3.5, sampleRate: 44100 },
    ],
    outPath: '/t/out.wav',
  });
  const fc = args[args.indexOf('-filter_complex') + 1];

  it('⚠️ never divides the stems down — normalize=0', () => {
    expect(fc).toContain('amix=inputs=2:normalize=0:duration=longest');
  });

  it('changes a level only when it is not 0 dB, and resamples only on a mismatch', () => {
    expect(fc).toContain('[0:a]apad[s0]');
    expect(fc).toContain('[1:a]aresample=48000,volume=-3.5dB,apad[s1]');
  });

  it('writes 32-bit float at 48 kHz, so a sum above full scale is kept, not clipped', () => {
    expect(args).toEqual(expect.arrayContaining(['-c:a', 'pcm_f32le', '-ar', '48000']));
    expect(args).not.toContain('-shortest');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/stems.test.ts`
Expected: FAIL. `planRemix` is not a function.

- [ ] **Step 3: Write minimal implementation**

```ts
export const MIN_GAIN_DB = -60;
export const MAX_GAIN_DB = 6;

const khz = (hz: number) => `${Number((hz / 1000).toFixed(1))} kHz`;

export function planRemix(set: StemSet): RemixPlan {
  const inputs: RemixInput[] = [];
  for (const id of set.order) {
    const s = set.stems[id];
    if (!s) continue;
    const m = set.mix[id] ?? { gainDb: 0, muted: false };
    const gainDb = Math.min(MAX_GAIN_DB, Math.max(MIN_GAIN_DB, m.gainDb));
    if (m.muted || gainDb <= MIN_GAIN_DB) continue;
    inputs.push({ stemId: id, key: s.key, name: s.name, gainDb, sampleRate: s.sampleRate, durationSec: s.durationSec });
  }
  if (inputs.length === 0) return { ok: false, message: 'Every stem is muted — unmute at least one to render a remix.' };
  const lengths = inputs.map((i) => i.durationSec).filter((d): d is number => typeof d === 'number');
  const longestSec = lengths.length ? Math.max(...lengths) : null;
  const notes: string[] = [];
  for (const i of inputs) {
    if (i.sampleRate && i.sampleRate !== 48000) notes.push(`${i.name} resampled from ${khz(i.sampleRate)} to 48 kHz`);
    if (longestSec !== null && i.durationSec !== null && longestSec - i.durationSec > 0.1) {
      notes.push(`${i.name} padded by ${(longestSec - i.durationSec).toFixed(1)} s to match the longest stem`);
    }
  }
  return { ok: true, inputs, longestSec, notes };
}

/**
 * ⚠️ normalize=0 — amix's default divides each input by the input count, so
 * eleven stems at 0 dB would come out ~21 dB down. Float output keeps a sum
 * above full scale (the September stems peaked at +1.7 dBFS) for mastering to
 * bring down. No -shortest: apad + duration=longest end the mix with the
 * longest stem, and nothing else may trim it.
 */
export function buildRemixArgs(p: { inputs: Array<{ path: string; gainDb: number; sampleRate: number | null }>; outPath: string }): string[] {
  const chains = p.inputs.map((inp, n) => {
    const steps: string[] = [];
    if (inp.sampleRate !== null && inp.sampleRate !== 48000) steps.push('aresample=48000');
    if (inp.gainDb !== 0) steps.push(`volume=${inp.gainDb}dB`);
    steps.push('apad');
    return `[${n}:a]${steps.join(',')}[s${n}]`;
  });
  const labels = p.inputs.map((_, n) => `[s${n}]`).join('');
  const filter = `${chains.join(';')};${labels}amix=inputs=${p.inputs.length}:normalize=0:duration=longest[m]`;
  return [
    '-hide_banner', '-nostats',
    ...p.inputs.flatMap((i) => ['-i', i.path]),
    '-filter_complex', filter,
    '-map', '[m]',
    '-c:a', 'pcm_f32le', '-ar', '48000',
    '-y', p.outPath,
  ];
}
```

**⚠️ `apad` with `duration=longest` never ends.** `apad` pads forever, so `amix duration=longest` never terminates. Bound the output with `-t <longestSec>` **on the output** when `longestSec` is known (padding exactly to the longest stem is the intent), and pass `longestSec` to `buildRemixArgs` as `p.durationSec`. Add to the test:

```ts
  it('ends at the longest stem — apad would otherwise pad forever', () => {
    const a = buildRemixArgs({ inputs: [{ path: '/t/0.wav', gainDb: 0, sampleRate: 48000 }], outPath: '/o.wav', durationSec: 221.92 });
    expect(a[a.indexOf('-t') + 1]).toBe('221.92');
    expect(a.indexOf('-t')).toBeGreaterThan(a.indexOf('-map'));
  });
```

When `durationSec` is null, omit `apad` from every chain instead (an unpadded `amix duration=longest` ends with the longest input on its own). Pin that with a test too. Update the implementation's signature to `{ inputs, outPath, durationSec?: number | null }` accordingly. Verify both behaviours for real in Task 14.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/stems.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stems.ts __tests__/lib/stems.test.ts
git commit -m "feat(stems): plan a remix from the saved mix, and build its ffmpeg arguments"
```

---

### Task 10: Saving the mix and requesting a render — repository and routes

**Files:**
- Modify: `src/infrastructure/database/StemSetRepository.ts` (add `saveMix`, `markRemixRequested`)
- Create:
  - `src/app/api/admin/stems/[masterJobId]/mix/route.ts` (PUT)
  - `src/app/api/admin/stems/[masterJobId]/remix/route.ts` (POST)
- Test: `__tests__/infrastructure/StemSetRepository.test.ts`, `__tests__/api/admin-stems-remix.test.ts`

**Interfaces:**
- Consumes: `planRemix`, `MIN_GAIN_DB`, `MAX_GAIN_DB` (Task 9).
- Produces:
  - `saveMix(masterJobId, mix: Record<string, StemMixEntry>): Promise<void>`: replaces `#mix`, entries only for stems still in the set (the route filters).
  - `markRemixRequested(masterJobId): Promise<void>`: `SET #remix.#requestedAt = :now, #remix.#error = :null`, creating `#remix` when absent.
  - `PUT /api/admin/stems/:id/mix` with body `{ mix: Record<stemId, { gainDb: number (−60..6), muted: boolean }> }` → `{ success }`.
  - `POST /api/admin/stems/:id/remix` → 202 `{ success, status: 'queued' }`. Event-invokes `{ stemMix: { masterJobId } }`. 409 with `planRemix`'s message when the plan refuses. 404 for an unknown master. 409 `'Wait for every listening copy, then render.'` is NOT required: the worker renders from WAVs, so listening copies don't gate rendering.

- [ ] **Step 1: Write the failing tests**

Route tests (`@jest-environment node`, mocks as in Task 4, plus `saveMix`, `markRemixRequested`):

```ts
it('saves a mix, clamped to the fader range, only for stems in the set', async () => {
  setGet.mockResolvedValue(SET_WITH(['a', 'b']));
  const res = await PUT(req('PUT', { mix: { a: { gainDb: -3, muted: false }, b: { gainDb: 0, muted: true }, ghost: { gainDb: 0, muted: false } } }), p());
  expect(res.status).toBe(200);
  expect(saveMix).toHaveBeenCalledWith(JOB, { a: { gainDb: -3, muted: false }, b: { gainDb: 0, muted: true } });
});

it('refuses a level that is not a number', async () => {
  const res = await PUT(req('PUT', { mix: { a: { gainDb: 'loud', muted: false } } }), p());
  expect(res.status).toBe(400);
});

it('queues a remix from the STORED mix — the request carries no levels', async () => {
  setGet.mockResolvedValue(SET_WITH(['a']));
  const res = await REMIX(req('POST', { mix: { a: { gainDb: 6, muted: false } } }), p());
  expect(res.status).toBe(202);
  expect(markRemixRequested).toHaveBeenCalledWith(JOB);
  const payload = JSON.parse(lambdaSend.mock.calls[0][0].args.Payload.toString());
  expect(payload).toEqual({ stemMix: { masterJobId: JOB } });
});

it('refuses a remix with every stem muted, in the planner\'s words', async () => {
  setGet.mockResolvedValue({ ...SET_WITH(['a']), mix: { a: { gainDb: 0, muted: true } } });
  const res = await REMIX(req('POST'), p());
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: expect.stringContaining('Every stem is muted') });
  expect(lambdaSend).not.toHaveBeenCalled();
});
```

(`SET_WITH(ids)` builds a `StemSet` with those ids, using the `stem()` helper from Task 9's test. Define it at the top of the file.)

Repository tests:

```ts
it('replaces the whole mix map, without touching the master', async () => {
  await repo.saveMix(JOB, { [ID]: { gainDb: -3, muted: false } });
  const call = mockUpdate.mock.calls[0][0];
  expect(call.updateExpression).toBe('SET #mix = :mix, #updatedAt = :now');
  expect(call.expressionAttributeValues[':mix']).toEqual({ [ID]: { gainDb: -3, muted: false } });
  expect(mockUpdate.mock.calls.some((c) => c[0].key.PK.startsWith('MASTERJOB#'))).toBe(false);
});

it('marks a remix as requested, clearing any old error', async () => {
  await repo.markRemixRequested(JOB);
  const call = mockUpdate.mock.calls[0][0];
  expect(call.updateExpression).toMatch(/#remix = if_not_exists\(#remix, :blank\)/);
});
```

`markRemixRequested` does two updates: first `SET #remix = if_not_exists(#remix, :blank)`, where `:blank` is `{ key: null, renderedAt: null, mixUsed: null, notes: [], error: null, requestedAt: null }`, then `SET #remix.#requestedAt = :now, #remix.#error = :null`. Same reason as `addStem`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/api/admin-stems-remix.test.ts __tests__/infrastructure/StemSetRepository.test.ts`
Expected: FAIL. The modules and methods don't exist.

- [ ] **Step 3: Implement.** Follow Task 4's route skeleton (auth first, `isValidMasterJobId`, `savedMaster`, try/catch → 502 `'Could not save the mix.'` / `'Could not start the remix.'`). Mix zod:

```ts
const mixSchema = z.object({
  mix: z.record(z.string().regex(/^[A-Za-z0-9_-]{1,120}$/), z.object({ gainDb: z.number().finite(), muted: z.boolean() })),
});
```

Clamp `gainDb` to `[MIN_GAIN_DB, MAX_GAIN_DB]` and drop ids not in `set.order` before calling `saveMix`.

- [ ] **Step 4: Run the tests to verify they pass.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/database/StemSetRepository.ts "src/app/api/admin/stems/[masterJobId]/mix" "src/app/api/admin/stems/[masterJobId]/remix" __tests__/api/admin-stems-remix.test.ts __tests__/infrastructure/StemSetRepository.test.ts
git commit -m "feat(stems): save the mix, and queue a remix from the stored levels"
```

---

### Task 11: Worker — rendering the remix (`stemMix`)

**Files:**
- Modify: `worker/master-worker.ts`
- Test: `__tests__/worker/master-worker.test.ts` (new `describe('stem remix')`)

**Interfaces:**
- Consumes:
  - `planRemix`, `buildRemixArgs`, `stemRemixKey`, `isStemKeyFor`, `isValidMasterJobId` (Tasks 1 and 9);
  - `stemSetFromItem` (export it from `StemSetRepository.ts` in Task 2; it is a pure function);
  - the worker's `GetCommand` (already imported from `@aws-sdk/lib-dynamodb`).
- Produces:
  - worker event `{ stemMix: { masterJobId } }`;
  - on success, writes `remix = { key, renderedAt, mixUsed, notes, error: null, requestedAt }`;
  - on failure, writes `remix.error`.

- [ ] **Step 1: Write the failing test**

```ts
describe('stem remix', () => {
  const JOB = '0b5e2c1a-1111-4222-8333-444455556666';
  const k = (id: string) => `audio/mastering/stems/${JOB}/${id}.wav`;
  const ITEM = {
    PK: `STEMSET#${JOB}`, SK: 'METADATA', masterJobId: JOB, order: ['v', 'd', 'b'],
    stems: {
      v: { key: k('v'), name: 'Vocals', durationSec: 221.9, sampleRate: 48000 },
      d: { key: k('d'), name: 'Drums', durationSec: 221.9, sampleRate: 48000 },
      b: { key: k('b'), name: 'Bass', durationSec: 221.6, sampleRate: 44100 },
    },
    mix: { v: { gainDb: -2, muted: false }, d: { gainDb: 0, muted: true } },
    remix: { requestedAt: '2026-10-03T12:00:00.000Z' }, createdAt: 't', updatedAt: 't',
  };
  const ddbInputs = () => send.mock.calls.map((c) => (c[0] as { input: Record<string, unknown> }).input);

  beforeEach(() => {
    spawnSync.mockReset().mockReturnValue({ status: 0, stdout: '', stderr: '' });
    s3Send.mockReset().mockImplementation((cmd: { input: Record<string, unknown> }) =>
      'Body' in cmd.input ? Promise.resolve({}) : Promise.resolve({ Body: { transformToByteArray: async () => new Uint8Array([1]) } }));
    send.mockReset().mockImplementation((cmd: { input: Record<string, unknown> }) =>
      'UpdateExpression' in cmd.input ? Promise.resolve({}) : Promise.resolve({ Item: ITEM }));
  });

  it('reads the set itself, mixes the unmuted stems at their saved levels, and stores a float WAV', async () => {
    const res = await handler({ stemMix: { masterJobId: JOB } } as never);
    expect(res).toMatchObject({ ok: true });
    // Drums are muted: never even downloaded.
    const gets = s3Send.mock.calls.map((c) => c[0].input.Key).filter(Boolean);
    expect(gets).toEqual(expect.arrayContaining([k('v'), k('b')]));
    expect(gets).not.toContain(k('d'));
    const mix = spawnSync.mock.calls.map((c) => c[1] as string[]).find((a) => a.includes('-filter_complex'))!;
    const fc = mix[mix.indexOf('-filter_complex') + 1];
    expect(fc).toContain('volume=-2dB');
    expect(fc).toContain('aresample=48000');
    expect(fc).toContain('normalize=0');
    expect(mix).toEqual(expect.arrayContaining(['-c:a', 'pcm_f32le']));
    const put = s3Send.mock.calls.map((c) => c[0].input).find((i) => 'Body' in i);
    expect(put.Key).toMatch(new RegExp(`^audio/mastering/stems/${JOB}/remix/\\d+-remix\\.wav$`));
    const done = ddbInputs().find((i) => String(i.UpdateExpression).includes('renderedAt'))!;
    expect(done.ExpressionAttributeValues).toMatchObject({
      ':notes': ['Bass resampled from 44.1 kHz to 48 kHz', 'Bass padded by 0.3 s to match the longest stem'],
      ':mixUsed': { v: { gainDb: -2, muted: false }, d: { gainDb: 0, muted: true } },
    });
  });

  it('records the planner\'s refusal on the set when every stem is muted', async () => {
    send.mockImplementation((cmd: { input: Record<string, unknown> }) =>
      'UpdateExpression' in cmd.input ? Promise.resolve({}) : Promise.resolve({ Item: { ...ITEM, mix: { v: { gainDb: 0, muted: true }, d: { gainDb: 0, muted: true }, b: { gainDb: 0, muted: true } } } }));
    const res = await handler({ stemMix: { masterJobId: JOB } } as never);
    expect(res).toMatchObject({ ok: false });
    const err = ddbInputs().find((i) => String(i.UpdateExpression).includes('#error'))!;
    expect(String(err.ExpressionAttributeValues![':err'])).toMatch(/Every stem is muted/);
    expect(s3Send).not.toHaveBeenCalled();
  });

  it('refuses a stem key that is not in this master\'s folder, before downloading anything', async () => {
    send.mockImplementation((cmd: { input: Record<string, unknown> }) =>
      'UpdateExpression' in cmd.input ? Promise.resolve({}) : Promise.resolve({ Item: { ...ITEM, stems: { ...ITEM.stems, v: { ...ITEM.stems.v, key: 'audio/poem-music/x.wav' } } } }));
    const res = await handler({ stemMix: { masterJobId: JOB } } as never);
    expect(res).toMatchObject({ ok: false });
    expect(s3Send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/worker/master-worker.test.ts -t "stem remix"`
Expected: FAIL. It falls through to the mastering path.

- [ ] **Step 3: Write minimal implementation**

`MasterEvent`: `stemMix?: { masterJobId?: string };`. Add a handler branch beside `stemPreview`. Then:

```ts
/**
 * Render a REMIX from a song's stems: the FULL-QUALITY WAVs at the levels
 * saved on the set — never levels from the event, which only names the set.
 * See buildRemixArgs for normalize=0 and the float output.
 */
async function renderStemMix(spec: NonNullable<MasterEvent['stemMix']>, bucket: string) {
  const masterJobId = spec.masterJobId ?? '';
  if (!isValidMasterJobId(masterJobId)) return { ok: false };
  const key = { PK: `STEMSET#${masterJobId}`, SK: 'METADATA' };
  const fail = async (message: string) => {
    await ddb.send(new UpdateCommand({
      TableName: TABLE, Key: key,
      UpdateExpression: 'SET #remix.#error = :err',
      ExpressionAttributeNames: { '#remix': 'remix', '#error': 'error' },
      ExpressionAttributeValues: { ':err': message },
    })).catch(() => {});
    return { ok: false };
  };
  const got = await ddb.send(new GetCommand({ TableName: TABLE, Key: key }));
  if (!got.Item) return { ok: false };
  const set = stemSetFromItem(got.Item as Record<string, unknown>);
  const plan = planRemix(set);
  if (!plan.ok) return fail(plan.message);
  if (plan.inputs.some((i) => !isStemKeyFor(masterJobId, i.key))) return fail('a stem is not in this song’s stem folder');

  const dir = mkdtempSync(join(tmpdir(), 'remix-'));
  try {
    const inputs = [];
    for (const [n, i] of plan.inputs.entries()) {
      const path = join(dir, `${n}.wav`);
      const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: i.key }));
      writeFileSync(path, Buffer.from(await obj.Body!.transformToByteArray()));
      inputs.push({ path, gainDb: i.gainDb, sampleRate: i.sampleRate });
    }
    const outPath = join(dir, 'remix.wav');
    const r = ff(buildRemixArgs({ inputs, outPath, durationSec: plan.longestSec }));
    if (r.status !== 0) return fail('the remix could not be rendered');
    const remixKey = stemRemixKey(masterJobId, Date.now());
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: remixKey, Body: readFileSync(outPath), ContentType: 'audio/wav' }));
    await ddb.send(new UpdateCommand({
      TableName: TABLE, Key: key,
      UpdateExpression: 'SET #remix.#key = :k, #remix.#renderedAt = :at, #remix.#mixUsed = :mixUsed, #remix.#notes = :notes, #remix.#error = :null',
      ExpressionAttributeNames: { '#remix': 'remix', '#key': 'key', '#renderedAt': 'renderedAt', '#mixUsed': 'mixUsed', '#notes': 'notes', '#error': 'error' },
      ExpressionAttributeValues: { ':k': remixKey, ':at': new Date().toISOString(), ':mixUsed': set.mix, ':notes': plan.notes, ':null': null },
    }));
    return { ok: true, remixKey };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[master-worker] stem remix failed:', message);
    return fail(message);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
```

The route's `markRemixRequested` always creates `#remix` before invoking, so nested `SET`s here are valid.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/worker/master-worker.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/master-worker.ts src/infrastructure/database/StemSetRepository.ts __tests__/worker/master-worker.test.ts
git commit -m "feat(stems): worker renders a remix from the full WAVs at the saved levels"
```

---

### Task 12: The live mixer

**Files:**
- Create: `src/components/admin/stems/useStemMixer.ts`, `src/components/admin/stems/StemMixer.tsx`
- Modify: `src/components/admin/stems/StemsStudio.tsx` (mount the mixer under the list; autosave)
- Test: `__tests__/components/stems/StemMixer.test.tsx`

**Interfaces:**
- Consumes: `StemSet` (Task 2), `MIN_GAIN_DB` / `MAX_GAIN_DB` (Task 9), `PUT …/mix` (Task 10), presigned play URLs from the download route.
- Produces:
  - `useStemMixer({ stems: Array<{ id: string; url: string }>, gains: Record<string, StemMixEntry>, solo: Set<string> })`, returning `{ ready, playing, position, duration, play(), pause(), seek(sec) }`;
  - `<StemMixer set masterJobId onMixChange(mix) />`.

- [ ] **Step 1: Write the failing test.** Mock Web Audio in the test file:

```ts
class FakeGain { gain = { value: 1, setTargetAtTime: jest.fn((v: number) => { this.gain.value = v; }) }; connect = jest.fn(); }
class FakeSource { buffer: unknown = null; connect = jest.fn(); start = jest.fn(); stop = jest.fn(); onended: (() => void) | null = null; }
const gains: FakeGain[] = [];
class FakeContext {
  currentTime = 0; state = 'running'; destination = {};
  createGain = () => { const g = new FakeGain(); gains.push(g); return g; };
  createBufferSource = () => new FakeSource();
  decodeAudioData = jest.fn(async () => ({ duration: 221.9 }));
  resume = jest.fn(async () => {}); close = jest.fn(async () => {});
}
(globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeContext;
global.fetch = jest.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })) as never;
```

Tests:
1. Renders one fader per stem, labelled `"{name} level"` (`role="slider"`, i.e. `<input type="range" min=-60 max=6 step=0.5>`), with the dB readout "0.0 dB" and "−∞" at −60.
2. Moving a fader to −6 sets that stem's `GainNode` to `10^(−6/20)` ≈ 0.501 (`toBeCloseTo(0.501, 2)`).
3. **Mute** sets its gain to 0. **Solo** on one stem sets every other stem's gain to 0, and un-soloing restores them.
4. **Reset** returns every fader to 0 dB and clears mute and solo.
5. Autosave: after a fader change, exactly one `PUT /api/admin/stems/<id>/mix` happens about 400 ms later (`await waitFor(…, { timeout: 2000 })`), with body `{ mix: { [id]: { gainDb: -6, muted: false } } }`. Solo is never in the body.
6. A failed save shows `role="alert"` **inside the mixer section** (`within(screen.getByRole('region', { name: /Mixer/ }))`).
7. The note *"A mix of the stems is a new version — it will not sound exactly like the original release."* is present verbatim.
8. A stem without a listening copy is listed as "waiting for its listening copy" and has no fader yet. The mixer still works for the rest.

- [ ] **Step 2: Run to verify it fails.** Expected: FAIL. Cannot find the module.

- [ ] **Step 3: Implement.**

`useStemMixer`:
- one `AudioContext` per mount, closed on unmount;
- `fetch` + `decodeAudioData` for each listening copy;
- one `GainNode` per stem → `destination`;
- `play()` creates fresh `AudioBufferSourceNode`s (sources are single-use) and starts them all at `ctx.currentTime + 0.05` from offset `position`;
- `pause()` stops them and records the position;
- `seek()` = pause + set position (+ play if it was playing);
- `position` advances with `requestAnimationFrame`;
- the effective gain per stem = 0 if muted, or if any solo is active and this stem isn't soloed, else `10 ** (gainDb / 20)` (0 at −60). Apply it with `gain.setTargetAtTime(v, ctx.currentTime, 0.01)` to avoid clicks.

`StemMixer`:
- `<section aria-label="Mixer">` containing the transport (play/pause, a seek `<input type="range">`, elapsed / total), one row per stem (name, fader, readout, **Mute**, **Solo**), **Reset**, and the note;
- autosave: a `useRef` timer of 400 ms → `PUT …/mix` with `{ mix }` (never `solo`); on failure, a `role="alert"` inside the section.

- [ ] **Step 4: Run to verify it passes.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/stems __tests__/components/stems/StemMixer.test.tsx
git commit -m "feat(stems): a live mixer on the listening copies — levels, mute, solo, autosave"
```

---

### Task 13: Render remix, Remix ready, and Master this remix

**Files:**
- Modify:
  - `src/components/admin/stems/StemsStudio.tsx` (render + poll + result);
  - `src/components/admin/MasteringStudio.tsx` (read `?source=&title=&target=`).
- Test: `__tests__/components/stems/StemsStudio.test.tsx`, `__tests__/components/admin/MasteringStudio.test.tsx`

**Interfaces:**
- Consumes: `POST …/remix` (Task 10); `GET …` returning `set.remix` (Task 4); `targetIdOf`-compatible target ids in the studio.
- Produces: **Render remix** → poll `GET` every 4 s until `remix.renderedAt` changes from before, or `remix.error` appears, or 10 minutes pass. Then **Remix ready** with an `<audio>` (play URL) and **Master this remix**, a link to `/admin/mastering?source=<encoded key>&title=<encoded "<song> — remix">&target=<targetId>`.

- [ ] **Step 1: Write the failing tests**

StemsStudio:
1. Render → POST to `/remix`. The button disables and shows *Rendering…*. When `GET` returns a new `remix.renderedAt`, it shows **Remix ready**, the notes as a list, and a **Master this remix** link with exactly the URL above (`encodeURIComponent` on key and title).
2. A 409 (*Every stem is muted…*) shows an alert inside the render section.
3. A `remix.error` from the worker shows an alert inside the render section, and the button re-enables.

MasteringStudio (follow the `masterAndSave` harness; set `window.history.pushState({}, '', '/admin/mastering?source=…&title=…&target=…')` before `render`):
1. A valid remix key loads as the source (the source panel shows its filename), the name field is pre-filled with the title, and the target picker is at the given target.
2. A `source` that is a mastering output (`…-master-14LUFS.wav`) or outside `audio/mastering/` is **not** loaded, and a note *"That link's source can't be mastered — choose a file instead."* is shown in the source section (`role="status"`).

- [ ] **Step 2: Run to verify they fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

StemsStudio: the render section with its own `renderError` state, and polling as `startRender` does in `MasteringStudio`. Capture `priorRenderedAt` before the POST.

MasteringStudio: a mount-only `useEffect`:

```ts
  // "Master this remix" (and any link like it) opens a source by URL.
  // Same setters as reopenMaster; refused unless it is an un-mastered file
  // in the mastering workspace.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const source = q.get('source');
    if (!source) return;
    if (!isMasteringKey(source) || isMasterKey(source) || isKaraokeMasterKey(source)) {
      setSourceLinkNote("That link's source can't be mastered — choose a file instead.");
      return;
    }
    setSourceKey(source);
    setSource({ name: downloadFilename(source), size: 0 });
    setMasterName(q.get('title') ?? '');
    const t = q.get('target');
    if (t) setTargetId(t);
  }, []);
```

`sourceLinkNote` is new state, rendered as `<p role="status">` in the source section. Import `isMasterKey` from `@/lib/loudness-measure` and `isKaraokeMasterKey` from `@/lib/master-peak` if they aren't already imported.

- [ ] **Step 4: Run to verify they pass.** Expected: PASS, plus the whole MasteringStudio suite.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/stems src/components/admin/MasteringStudio.tsx __tests__/components
git commit -m "feat(stems): render a remix, hear it, and open it in Sound Engineering"
```

---

### Task 14: Real checks on ffmpeg 7.0.2, docs, PR 2, deploy

**Files:**
- Create: `scripts/verify-stem-remix.ts`, a permanent check script (house precedent: `scripts/verify-frame-format.ts`)
- Modify: `src/content/admin-docs.ts` (extend the `stems` doc: mixer, render, Master this remix, notes)

- [ ] **Step 1: Write the verification script.**
- It takes `--ffmpeg <path>` (default: the Lambda layer binary extracted under the scratchpad) and `--dir <folder of stem WAVs>`.
- It runs `buildRemixArgs` on real stems and asserts with `astats` `Number of samples`:
  - **(a) Sum check:** all stems at 0 dB equal a reference sum built with `amix=normalize=0` on the same inputs. The difference is under 0.01 dB RMS, and the output's peak may exceed 0 dBFS (float).
  - **(b) Mute check:** with one stem muted, the output equals the sum of the others.
  - **(c) Length check:** the output length equals the longest stem's length (within one 1024-sample frame).
  - **(d) Resample check:** a stem resampled from 44.1 kHz produces a 48 kHz output with no error.
- It prints the elapsed time and the peak scratch size (`du`) for the full set.
- [ ] **Step 2: Run it** against the September karaoke stems:

  ```bash
  aws s3 ls s3://tamil-web-media/audio/mastering/ | sort | grep -E '1789|1790'
  aws s3 cp … --recursive --include '<prefix>*'
  ```

  Paste the numbers into the PR body. If (a)–(d) don't all hold, stop, fix `buildRemixArgs` with a failing unit test first, and re-run.
- [ ] **Step 3:** Update the doc. Full CI (as Task 8). Commit, push, PR (`feat/stems-remix`), and wait for `verify`.
- [ ] **Step 4:** After Raj merges: back up the live worker zip, ask Raj, and deploy on his yes. Then ask him to try one remix and report the song name. Read its worker `REPORT` duration from CloudWatch.

---

## Self-review notes (completed while writing)

- **Spec coverage:**
  - storage (T2, T5);
  - files and keys (T1);
  - upload (T3, T7);
  - row link (T6);
  - page, list, rename, remove, mismatch warnings (T7);
  - mixer, solo, reset, note, autosave (T12);
  - render with normalize=0 and float output, notes (T9, T11);
  - Remix ready, Master this remix, studio `?source` (T13);
  - errors in place (T4, T7, T12, T13);
  - real 7.0.2 checks (T14);
  - two PRs and manual worker deploys (T8, T14).
  - **Download stems** (spec Section 2, item 5) is T7's per-stem **Download {name}** (full WAV, as an attachment), pinned by a test. A one-click "download all" is not built.
- **Spec deviation, deliberate:** the spec said `stems` is a list. The plan stores a **map keyed by stemId plus an `order` list**, because concurrent listening-copy writes would otherwise erase each other (Review Focus 1). The page sees the same ordered list.
- **Trap found while writing:** `apad` + `amix duration=longest` never terminates. Task 9 bounds the output with `-t longestSec`, or drops `apad` when lengths are unknown. Task 14 verifies it for real.
- **Type consistency:**
  - `StemSet`, `StemEntry`, `StemMixEntry`, `StemRemix` are defined in T2 and used verbatim after;
  - `planRemix` / `buildRemixArgs` signatures are fixed in T9 (with `durationSec`) and used in T11;
  - `stemSetFromItem` is exported in T2 and used by the worker in T11.
