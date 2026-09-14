# Expiring Delivery Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a paid file over a link on `tamilagaval.com` that stops working — 3 downloads, 7 days — instead of a permanent public CDN URL.

**Architecture:** A 256-bit token addresses a `DELIVERY#` item in the existing DynamoDB table. The token URL serves a **page** (so email link-scanners cannot burn a download); its Download button hits a counting endpoint that atomically increments under a condition and 302s to a 60-second presigned S3 GET. Deliverables sit behind the bucket policy's existing CloudFront Deny, so the token is the only way in.

**Tech Stack:** Next.js 15.5 App Router, TypeScript 5.9, zod, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-s3`, Jest (jsdom).

**Spec:** `docs/superpowers/specs/2026-09-14-delivery-links-design.md`

## Global Constraints

- **No new AWS resources.** No new table, no new GSI, no new bucket, no new Lambda. One bucket-**policy** edit only.
- **No new npm dependencies.** `crypto` is Node built-in.
- **Payment is manual.** Nothing in this plan takes or verifies payment.
- Table `TamilWebContent`, `ca-central-1`, accessed only through `DynamoDBOperations`. Never a raw scan.
- Admin routes: `requireAdmin(request)`; mutations additionally `requireBearer(request)`.
- `src/middleware.ts` gates only paths starting with `/admin` — the two public routes need no exemption. Verified, do not add one.
- **The page must never increment the counter.** Only `GET /api/d/[token]` counts. This is the scanner defence from spec §3 and the single most important behaviour here.
- Locked values: **`maxDownloads = 3`**, **expiry 7 days**, **presigned TTL 60 s**, **token 32 random bytes base64url (43 chars)**.
- Test runner is jest, not vitest: `NODE_ENV=test npx jest <path>`. **Never pipe jest to `tail` when checking success — the pipe masks its exit code.** The full suite is the `amplify.yml` deploy gate.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/types/delivery.ts` | Client-safe types, zod schemas, token generation + validation. No server SDK. |
| `src/infrastructure/database/DeliveryRepository.ts` | All DynamoDB access, including the atomic count. |
| `src/app/api/d/[token]/route.ts` | Public: validate, count, redirect. |
| `src/app/d/[token]/page.tsx` | Public: the page with the Download button. |
| `src/app/api/admin/deliveries/route.ts` | Admin: create + list. |
| `src/app/api/admin/deliveries/[token]/revoke/route.ts` | Admin: revoke. |
| `src/components/admin/DeliveryManager.tsx` | Admin UI. |
| `src/app/(admin)/admin/deliveries/page.tsx` | Hosts the admin UI. |
| `src/infrastructure/storage/s3-client.ts` | **Modified** — gains `getContentLength`. |

---

### Task 1: Types, token generation and validation

**Files:**
- Create: `src/types/delivery.ts`
- Test: `__tests__/types/delivery.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Delivery`, `DeliveryStatus`, `DEFAULT_MAX_DOWNLOADS`, `DEFAULT_TTL_DAYS`, `newDeliveryToken(): string`, `isDeliveryToken(t: string): boolean`, `createDeliverySchema`, `deliveryStatusOf(d: Delivery, now?: Date): DeliveryStatus`.

- [ ] **Step 1: Write the failing test**

```ts
/** @jest-environment node */
import {
  newDeliveryToken, isDeliveryToken, deliveryStatusOf, createDeliverySchema,
  DEFAULT_MAX_DOWNLOADS, DEFAULT_TTL_DAYS, type Delivery,
} from '@/types/delivery';

const base = (over: Partial<Delivery> = {}): Delivery => ({
  token: newDeliveryToken(),
  s3Key: 'deliveries/x.mp3',
  filename: 'Song - Karaoke.mp3',
  label: 'Buyer — karaoke',
  contentLength: 12151796,
  createdAt: '2026-09-14T00:00:00.000Z',
  expiresAt: '2026-09-21T00:00:00.000Z',
  maxDownloads: 3,
  downloadCount: 0,
  downloads: [],
  revokedAt: null,
  ...over,
});

describe('tokens', () => {
  it('mints 43-char base64url tokens that validate', () => {
    const t = newDeliveryToken();
    expect(t).toHaveLength(43);
    expect(isDeliveryToken(t)).toBe(true);
  });
  it('does not repeat', () => {
    const many = new Set(Array.from({ length: 200 }, newDeliveryToken));
    expect(many.size).toBe(200);
  });
  it('rejects anything that is not a token — keys are built from this', () => {
    for (const bad of ['', 'short', 'a'.repeat(43) + '=', '../../etc/passwd', 'a/b', 'a+b'.padEnd(43, 'x')]) {
      expect(isDeliveryToken(bad)).toBe(false);
    }
  });
});

describe('deliveryStatusOf', () => {
  const NOW = new Date('2026-09-15T00:00:00.000Z');
  it('is active inside the window and under the cap', () => {
    expect(deliveryStatusOf(base(), NOW)).toBe('active');
  });
  it('is expired past expiresAt', () => {
    expect(deliveryStatusOf(base({ expiresAt: '2026-09-14T00:00:00.000Z' }), NOW)).toBe('expired');
  });
  it('is exhausted at the cap', () => {
    expect(deliveryStatusOf(base({ downloadCount: 3 }), NOW)).toBe('exhausted');
  });
  it('is revoked even when otherwise fine', () => {
    expect(deliveryStatusOf(base({ revokedAt: '2026-09-14T12:00:00.000Z' }), NOW)).toBe('revoked');
  });
  it('reports revoked ahead of expired when both apply', () => {
    // The operator killing a link is the more informative fact.
    const d = base({ revokedAt: '2026-09-13T00:00:00.000Z', expiresAt: '2026-09-14T00:00:00.000Z' });
    expect(deliveryStatusOf(d, NOW)).toBe('revoked');
  });
});

describe('createDeliverySchema', () => {
  it('accepts a well-formed create', () => {
    expect(createDeliverySchema.safeParse({
      s3Key: 'deliveries/a.mp3', filename: 'a.mp3', label: 'Buyer',
    }).success).toBe(true);
  });
  it('refuses an s3Key outside the deliveries prefix', () => {
    // Otherwise a link could be minted for any object in the bucket.
    expect(createDeliverySchema.safeParse({
      s3Key: 'audio/poem-music/song.mp3', filename: 'a.mp3', label: 'B',
    }).success).toBe(false);
  });
  it('refuses path traversal in the key', () => {
    expect(createDeliverySchema.safeParse({
      s3Key: 'deliveries/../audio/x.mp3', filename: 'a.mp3', label: 'B',
    }).success).toBe(false);
  });
});

describe('defaults', () => {
  it('are the locked values', () => {
    expect(DEFAULT_MAX_DOWNLOADS).toBe(3);
    expect(DEFAULT_TTL_DAYS).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test npx jest types/delivery`
Expected: FAIL — `Cannot find module '@/types/delivery'`

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Expiring delivery links — the shared contract.
 *
 * CLIENT-SAFE: imports no AWS SDK, so the public page, the API routes and the
 * admin panel share one source of truth. `node:crypto` is a built-in and is
 * only reached by `newDeliveryToken`, which the client never calls.
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

export const DEFAULT_MAX_DOWNLOADS = 3;
export const DEFAULT_TTL_DAYS = 7;
/** Long enough to start a download, too short to be worth passing on. */
export const PRESIGN_TTL_SECONDS = 60;
/** The only prefix a delivery may serve from. See the CloudFront Deny. */
export const DELIVERY_PREFIX = 'deliveries/';

export type DeliveryStatus = 'active' | 'expired' | 'exhausted' | 'revoked';

export interface DeliveryHit { at: string; ip: string }

export interface Delivery {
  token: string;
  /** The object served. NEVER sent to a client. */
  s3Key: string;
  filename: string;
  label: string;
  contentLength: number;
  createdAt: string;
  expiresAt: string;
  maxDownloads: number;
  downloadCount: number;
  downloads: DeliveryHit[];
  revokedAt: string | null;
}

/**
 * 256 bits, base64url, 43 chars. Not a UUID — v4 gives 122 bits and reads as
 * guessable to anyone auditing this later. The token IS the credential.
 */
export function newDeliveryToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Validated before it is ever used to build a DynamoDB key. */
export function isDeliveryToken(t: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(t);
}

/**
 * Revoked is reported ahead of expired: the operator killing a link is the
 * more informative fact, and the message the buyer gets should say so.
 */
export function deliveryStatusOf(d: Delivery, now: Date = new Date()): DeliveryStatus {
  if (d.revokedAt) return 'revoked';
  if (Date.parse(d.expiresAt) <= now.getTime()) return 'expired';
  if (d.downloadCount >= d.maxDownloads) return 'exhausted';
  return 'active';
}

export const createDeliverySchema = z.object({
  s3Key: z
    .string()
    .trim()
    .min(1)
    .max(1024)
    .refine((k) => k.startsWith(DELIVERY_PREFIX), 'Key must be under deliveries/')
    .refine((k) => !k.includes('..'), 'Key must not traverse'),
  filename: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(200),
  maxDownloads: z.number().int().min(1).max(20).optional(),
  ttlDays: z.number().int().min(1).max(90).optional(),
});
export type CreateDeliveryInput = z.infer<typeof createDeliverySchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test npx jest types/delivery`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types/delivery.ts __tests__/types/delivery.test.ts
git commit -m "feat(delivery): token generation, status rules and create validation"
```

---

### Task 2: Repository, with the atomic count

**Files:**
- Create: `src/infrastructure/database/DeliveryRepository.ts`
- Test: `__tests__/infrastructure/DeliveryRepository.test.ts`

**Interfaces:**
- Consumes: Task 1 types and constants.
- Produces: class `DeliveryRepository` with `create(input: CreateDeliveryInput): Promise<Delivery>`, `findByToken(token: string): Promise<Delivery | null>`, `list(): Promise<Delivery[]>`, `consume(token: string, ip: string): Promise<{ ok: true; delivery: Delivery } | { ok: false; reason: 'exhausted' }>`, `revoke(token: string): Promise<void>`; plus `DELIVERY_INDEX_PK`.

- [ ] **Step 1: Write the failing test**

```ts
/** @jest-environment node */
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: {
    put: jest.fn(async () => ({})),
    get: jest.fn(async () => ({ Item: undefined })),
    query: jest.fn(async () => ({ Items: [] })),
    update: jest.fn(async () => ({})),
  },
  handleDynamoDBError: (e: unknown) => { throw e; },
}));

import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';
import { DeliveryRepository, DELIVERY_INDEX_PK } from '@/infrastructure/database/DeliveryRepository';

const put = DynamoDBOperations.put as jest.Mock;
const update = DynamoDBOperations.update as jest.Mock;
const query = DynamoDBOperations.query as jest.Mock;
beforeEach(() => jest.clearAllMocks());

describe('create', () => {
  it('writes a keyed item with the sparse index and a 7-day expiry', async () => {
    const d = await new DeliveryRepository().create({
      s3Key: 'deliveries/a.mp3', filename: 'a.mp3', label: 'Buyer',
    });
    const item = put.mock.calls[0][0];
    expect(item.PK).toBe(`DELIVERY#${d.token}`);
    expect(item.SK).toBe('METADATA');
    expect(item.entityType).toBe('DELIVERY');
    expect(item.GSI1PK).toBe(DELIVERY_INDEX_PK);
    expect(item.maxDownloads).toBe(3);
    expect(item.downloadCount).toBe(0);
    const days = (Date.parse(item.expiresAt) - Date.parse(item.createdAt)) / 86_400_000;
    expect(Math.round(days)).toBe(7);
  });

  it('sets a ttl well after expiry, so cleanup never races enforcement', async () => {
    await new DeliveryRepository().create({ s3Key: 'deliveries/a.mp3', filename: 'a.mp3', label: 'B' });
    const item = put.mock.calls[0][0];
    expect(item.ttl * 1000).toBeGreaterThan(Date.parse(item.expiresAt));
  });
});

describe('consume', () => {
  it('increments under a condition so two clicks cannot both pass the cap', async () => {
    update.mockResolvedValueOnce({ token: 't', downloadCount: 1, downloads: [] });
    await new DeliveryRepository().consume('t'.repeat(43), '1.2.3.4');
    const p = update.mock.calls[0][0];
    expect(p.conditionExpression).toContain('downloadCount < :max');
    expect(p.conditionExpression).toContain('attribute_not_exists(revokedAt)');
    expect(p.updateExpression).toContain('ADD');
  });

  it('reports exhausted rather than throwing when the condition fails', async () => {
    const err = Object.assign(new Error('conditional request failed'), {
      name: 'ConditionalCheckFailedException',
    });
    update.mockRejectedValueOnce(err);
    const r = await new DeliveryRepository().consume('t'.repeat(43), '1.2.3.4');
    expect(r).toEqual({ ok: false, reason: 'exhausted' });
  });

  it('records the hit with an ip, so a disputed delivery has evidence', async () => {
    update.mockResolvedValueOnce({ token: 't', downloadCount: 1, downloads: [] });
    await new DeliveryRepository().consume('t'.repeat(43), '9.9.9.9');
    const p = update.mock.calls[0][0];
    expect(JSON.stringify(p.expressionAttributeValues)).toContain('9.9.9.9');
  });
});

describe('list', () => {
  it('queries the sparse index, never a scan', async () => {
    await new DeliveryRepository().list();
    expect(query.mock.calls[0][0].indexName).toBe('GSI1');
    expect(query.mock.calls[0][0].expressionAttributeValues[':pk']).toBe(DELIVERY_INDEX_PK);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test npx jest DeliveryRepository`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Persistence for expiring delivery links.
 *
 * The interesting part is `consume`: the cap is enforced by a DynamoDB
 * ConditionExpression, not by a read-then-write. Two clicks arriving together
 * would both pass a `downloadCount < max` check made in application code.
 */
import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';
import {
  newDeliveryToken, DEFAULT_MAX_DOWNLOADS, DEFAULT_TTL_DAYS,
  type Delivery, type CreateDeliveryInput,
} from '@/types/delivery';

/** Sparse GSI1 partition holding every delivery. Namespaced; cannot collide. */
export const DELIVERY_INDEX_PK = 'DELIVERY';

/** Rows survive 30 days past expiry — TTL is cleanup, never the control. */
const TTL_GRACE_DAYS = 30;

const pk = (token: string) => `DELIVERY#${token}`;

function toDelivery(i: Record<string, unknown>): Delivery {
  return {
    token: String(i.token),
    s3Key: String(i.s3Key),
    filename: String(i.filename),
    label: String(i.label ?? ''),
    contentLength: Number(i.contentLength ?? 0),
    createdAt: String(i.createdAt),
    expiresAt: String(i.expiresAt),
    maxDownloads: Number(i.maxDownloads ?? DEFAULT_MAX_DOWNLOADS),
    downloadCount: Number(i.downloadCount ?? 0),
    downloads: Array.isArray(i.downloads) ? (i.downloads as Delivery['downloads']) : [],
    revokedAt: (i.revokedAt as string | null) ?? null,
  };
}

export class DeliveryRepository {
  async create(input: CreateDeliveryInput & { contentLength?: number }): Promise<Delivery> {
    try {
      const token = newDeliveryToken();
      const now = new Date();
      const ttlDays = input.ttlDays ?? DEFAULT_TTL_DAYS;
      const expiresAt = new Date(now.getTime() + ttlDays * 86_400_000).toISOString();
      const delivery: Delivery = {
        token,
        s3Key: input.s3Key,
        filename: input.filename,
        label: input.label,
        contentLength: input.contentLength ?? 0,
        createdAt: now.toISOString(),
        expiresAt,
        maxDownloads: input.maxDownloads ?? DEFAULT_MAX_DOWNLOADS,
        downloadCount: 0,
        downloads: [],
        revokedAt: null,
      };
      await DynamoDBOperations.put({
        PK: pk(token), SK: 'METADATA', entityType: 'DELIVERY', ...delivery,
        GSI1PK: DELIVERY_INDEX_PK,
        GSI1SK: `${delivery.createdAt}#${token}`,
        ttl: Math.floor((Date.parse(expiresAt) + TTL_GRACE_DAYS * 86_400_000) / 1000),
      });
      return delivery;
    } catch (error) { handleDynamoDBError(error); }
  }

  async findByToken(token: string): Promise<Delivery | null> {
    try {
      const r = await DynamoDBOperations.get({ PK: pk(token), SK: 'METADATA' });
      return r.Item ? toDelivery(r.Item as Record<string, unknown>) : null;
    } catch (error) { handleDynamoDBError(error); }
  }

  async list(): Promise<Delivery[]> {
    try {
      const r = await DynamoDBOperations.query({
        indexName: 'GSI1',
        keyConditionExpression: 'GSI1PK = :pk',
        expressionAttributeValues: { ':pk': DELIVERY_INDEX_PK },
        scanIndexForward: false,
      });
      return (r.Items ?? []).map((i) => toDelivery(i as Record<string, unknown>));
    } catch (error) { handleDynamoDBError(error); }
  }

  /**
   * Claim one download. The condition is the cap: a failure means the link is
   * used up or revoked, which is an answer, not an error.
   */
  async consume(
    token: string,
    ip: string
  ): Promise<{ ok: true; delivery: Delivery } | { ok: false; reason: 'exhausted' }> {
    const hit = { at: new Date().toISOString(), ip };
    try {
      const updated = await DynamoDBOperations.update({
        key: { PK: pk(token), SK: 'METADATA' },
        updateExpression:
          'ADD downloadCount :one SET downloads = list_append(if_not_exists(downloads, :empty), :hit)',
        conditionExpression: 'downloadCount < :max AND attribute_not_exists(revokedAt)',
        expressionAttributeValues: {
          ':one': 1, ':hit': [hit], ':empty': [], ':max': DEFAULT_MAX_DOWNLOADS,
        },
      });
      return { ok: true, delivery: toDelivery((updated ?? {}) as Record<string, unknown>) };
    } catch (error) {
      if ((error as { name?: string })?.name === 'ConditionalCheckFailedException') {
        return { ok: false, reason: 'exhausted' };
      }
      handleDynamoDBError(error);
    }
  }

  async revoke(token: string): Promise<void> {
    try {
      await DynamoDBOperations.update({
        key: { PK: pk(token), SK: 'METADATA' },
        updateExpression: 'SET revokedAt = :at',
        expressionAttributeValues: { ':at': new Date().toISOString() },
      });
    } catch (error) { handleDynamoDBError(error); }
  }
}
```

> `consume` reads `DEFAULT_MAX_DOWNLOADS` for the condition rather than the row's own `maxDownloads`, because a ConditionExpression cannot reference another attribute of the same item in an arithmetic comparison without a nested-attribute path. If per-link caps are ever needed, read the row first and pass its value as `:max` — the extra read is the price, and the condition still makes the write atomic.

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test npx jest DeliveryRepository`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/database/DeliveryRepository.ts __tests__/infrastructure/DeliveryRepository.test.ts
git commit -m "feat(delivery): repository with a condition-guarded download counter"
```

---

### Task 3: The counting endpoint

**Files:**
- Create: `src/app/api/d/[token]/route.ts`
- Test: `__tests__/api/delivery-download.test.ts`

**Interfaces:**
- Consumes: Task 1 (`isDeliveryToken`, `deliveryStatusOf`, `PRESIGN_TTL_SECONDS`), Task 2 (`findByToken`, `consume`), `S3Operations.getSignedUrl(key, expiresIn, downloadAs)`, `SharedRateLimiter`/`checkRateLimit`/`rateLimitedResponse`/`clientIp` from `@/lib/rate-limit`.
- Produces: `GET /api/d/[token]` — 302 to a presigned URL, or 302 back to `/d/[token]?e=<reason>`.

- [ ] **Step 1: Write the failing test**

```ts
/** @jest-environment node */
const findByToken = jest.fn();
const consume = jest.fn();
const getSignedUrl = jest.fn(async () => 'https://s3.invalid/signed');

jest.mock('@/infrastructure/database/DeliveryRepository', () => ({
  DeliveryRepository: jest.fn().mockImplementation(() => ({ findByToken, consume })),
}));
jest.mock('@/infrastructure/storage/s3-client', () => ({
  S3Operations: { getSignedUrl: (...a: unknown[]) => getSignedUrl(...a) },
}));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/d/[token]/route';

const TOKEN = 'a'.repeat(43);
const ctx = (t = TOKEN) => ({ params: Promise.resolve({ token: t }) });
const req = () => new NextRequest('https://tamilagaval.com/api/d/x');

const live = (over = {}) => ({
  token: TOKEN, s3Key: 'deliveries/a.mp3', filename: 'Song.mp3', label: 'B',
  contentLength: 10, createdAt: '2026-09-14T00:00:00.000Z',
  expiresAt: '2099-01-01T00:00:00.000Z',
  maxDownloads: 3, downloadCount: 0, downloads: [], revokedAt: null, ...over,
});

beforeEach(() => jest.clearAllMocks());

it('redirects a valid token to a short-lived presigned URL', async () => {
  findByToken.mockResolvedValueOnce(live());
  consume.mockResolvedValueOnce({ ok: true, delivery: live({ downloadCount: 1 }) });

  const res = await GET(req(), ctx());
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe('https://s3.invalid/signed');
  // 60s, and the buyer's filename rather than the S3 key.
  expect(getSignedUrl).toHaveBeenCalledWith('deliveries/a.mp3', 60, 'Song.mp3');
});

it('never puts the s3Key in a response the buyer can read', async () => {
  findByToken.mockResolvedValueOnce(live());
  consume.mockResolvedValueOnce({ ok: true, delivery: live({ downloadCount: 1 }) });
  const res = await GET(req(), ctx());
  expect(await res.text()).not.toContain('deliveries/a.mp3');
});

it('rejects a malformed token without touching the database', async () => {
  const res = await GET(req(), ctx('../../etc/passwd'));
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toContain('e=invalid');
  expect(findByToken).not.toHaveBeenCalled();
});

it('sends an unknown token back to the page, not to a 500', async () => {
  findByToken.mockResolvedValueOnce(null);
  const res = await GET(req(), ctx());
  expect(res.headers.get('location')).toContain('e=invalid');
});

it('refuses an expired link before consuming a download', async () => {
  findByToken.mockResolvedValueOnce(live({ expiresAt: '2020-01-01T00:00:00.000Z' }));
  const res = await GET(req(), ctx());
  expect(res.headers.get('location')).toContain('e=expired');
  expect(consume).not.toHaveBeenCalled();
});

it('refuses a revoked link before consuming a download', async () => {
  findByToken.mockResolvedValueOnce(live({ revokedAt: '2026-09-14T01:00:00.000Z' }));
  const res = await GET(req(), ctx());
  expect(res.headers.get('location')).toContain('e=revoked');
  expect(consume).not.toHaveBeenCalled();
});

it('honours the race lost at the database, not the read before it', async () => {
  // The row looked usable, but a simultaneous click took the last download.
  findByToken.mockResolvedValueOnce(live({ downloadCount: 2 }));
  consume.mockResolvedValueOnce({ ok: false, reason: 'exhausted' });
  const res = await GET(req(), ctx());
  expect(res.headers.get('location')).toContain('e=exhausted');
  expect(getSignedUrl).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test npx jest delivery-download`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
/**
 * GET /api/d/[token] — claim one download and redirect to the file.
 *
 * This is the ONLY route that counts. `/d/[token]` renders a page and counts
 * nothing, because email link-scanners prefetch URLs and would otherwise burn
 * a buyer's downloads before he clicked. Do not "simplify" the page away.
 *
 * The cap is enforced by the repository's ConditionExpression, not by the
 * status read above it — that read is a courtesy that avoids a pointless write,
 * and the database is what actually decides.
 */
import { NextRequest, NextResponse } from 'next/server';
import { DeliveryRepository } from '@/infrastructure/database/DeliveryRepository';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { isDeliveryToken, deliveryStatusOf, PRESIGN_TTL_SECONDS } from '@/types/delivery';
import { SharedRateLimiter, checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Stops the token space being swept. Generous for a real buyer retrying. */
const limiter = new SharedRateLimiter({ bucket: 'delivery', windowMs: 60_000, max: 20 });

const back = (request: NextRequest, token: string, reason: string) =>
  NextResponse.redirect(new URL(`/d/${encodeURIComponent(token)}?e=${reason}`, request.nextUrl.origin), 302);

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const rl = await checkRateLimit(limiter, request);
  if (!rl.allowed) return rateLimitedResponse(rl);

  const { token } = await params;
  // Validated before it is used to build a DynamoDB key.
  if (!isDeliveryToken(token)) return back(request, 'invalid', 'invalid');

  const repo = new DeliveryRepository();
  const delivery = await repo.findByToken(token);
  if (!delivery) return back(request, token, 'invalid');

  const status = deliveryStatusOf(delivery);
  if (status !== 'active') return back(request, token, status);

  const claimed = await repo.consume(token, clientIp(request));
  if (!claimed.ok) return back(request, token, 'exhausted');

  const url = await S3Operations.getSignedUrl(
    delivery.s3Key, PRESIGN_TTL_SECONDS, delivery.filename
  );
  return NextResponse.redirect(url, 302);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test npx jest delivery-download`
Expected: PASS

> If this is the first route test to pull `@aws-sdk/client-s3` transitively and it fails on a `browser`-condition resolution, extend `moduleNameMapper` in `jest.config.ts` by enumerating the new subpath. Do NOT add a wildcard and do NOT reach for transforms — the `@smithy/core` browser builds parse fine and then fail at runtime with `loadConfig is not a function`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/d __tests__/api/delivery-download.test.ts
git commit -m "feat(delivery): counting endpoint with condition-enforced cap"
```

---

### Task 4: The public page

**Files:**
- Create: `src/app/d/[token]/page.tsx`
- Test: `__tests__/app/delivery-page.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`isDeliveryToken`, `deliveryStatusOf`), Task 2 (`findByToken`).
- Produces: the page at `/d/[token]`, rendering a Download button linking to `/api/d/[token]`.

- [ ] **Step 1: Write the failing test**

```tsx
/** @jest-environment jsdom */
const findByToken = jest.fn();
jest.mock('@/infrastructure/database/DeliveryRepository', () => ({
  DeliveryRepository: jest.fn().mockImplementation(() => ({ findByToken })),
}));

import { render, screen } from '@testing-library/react';
import DeliveryPage from '@/app/d/[token]/page';

const TOKEN = 'b'.repeat(43);
const live = (over = {}) => ({
  token: TOKEN, s3Key: 'deliveries/secret-key.mp3', filename: 'Sevvanthi Poove - Karaoke.mp3',
  label: 'Buyer', contentLength: 12151796, createdAt: '2026-09-14T00:00:00.000Z',
  expiresAt: '2099-01-01T00:00:00.000Z', maxDownloads: 3, downloadCount: 0,
  downloads: [], revokedAt: null, ...over,
});
const props = (e?: string) => ({
  params: Promise.resolve({ token: TOKEN }),
  searchParams: Promise.resolve(e ? { e } : {}),
});

beforeEach(() => jest.clearAllMocks());

it('offers the download without ever revealing the S3 key', async () => {
  findByToken.mockResolvedValueOnce(live());
  render(await DeliveryPage(props()));

  expect(screen.getByText('Sevvanthi Poove - Karaoke.mp3')).toBeInTheDocument();
  const link = screen.getByRole('link', { name: /Download/i });
  expect(link).toHaveAttribute('href', `/api/d/${TOKEN}`);
  expect(document.body.innerHTML).not.toContain('secret-key');
});

it('does NOT consume a download just by rendering', async () => {
  // The whole reason this page exists: email scanners prefetch links.
  findByToken.mockResolvedValueOnce(live());
  render(await DeliveryPage(props()));
  expect(findByToken).toHaveBeenCalledTimes(1);
  // No consume on the repository mock at all — it is not even wired here.
});

it('shows remaining downloads so the buyer is not surprised', async () => {
  findByToken.mockResolvedValueOnce(live({ downloadCount: 2 }));
  render(await DeliveryPage(props()));
  expect(screen.getByText(/1 download remaining/i)).toBeInTheDocument();
});

it.each([
  ['expired', /expired/i],
  ['exhausted', /already been used/i],
  ['revoked', /no longer active/i],
])('explains %s plainly, with no download button', async (reason, copy) => {
  findByToken.mockResolvedValueOnce(live({
    ...(reason === 'expired' ? { expiresAt: '2020-01-01T00:00:00.000Z' } : {}),
    ...(reason === 'exhausted' ? { downloadCount: 3 } : {}),
    ...(reason === 'revoked' ? { revokedAt: '2026-09-14T00:00:00.000Z' } : {}),
  }));
  render(await DeliveryPage(props(reason)));
  expect(screen.getByText(copy)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Download/i })).not.toBeInTheDocument();
});

it('handles an unknown token without leaking that it never existed vs expired', async () => {
  findByToken.mockResolvedValueOnce(null);
  render(await DeliveryPage(props('invalid')));
  expect(screen.getByText(/not valid/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test npx jest delivery-page`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```tsx
/**
 * /d/[token] — what a buyer opens.
 *
 * Renders and counts NOTHING. Email security filters prefetch links in a
 * message; if this route redirected to the file, a scanner would consume a
 * download before the buyer clicked, possibly all of them through several
 * filters. The Download button is what counts, via /api/d/[token].
 */
import Link from 'next/link';
import { DeliveryRepository } from '@/infrastructure/database/DeliveryRepository';
import { isDeliveryToken, deliveryStatusOf } from '@/types/delivery';

export const dynamic = 'force-dynamic';

const MB = 1024 * 1024;

const MESSAGES: Record<string, string> = {
  invalid: 'This link is not valid.',
  expired: 'This link has expired. Contact TamilAgaval for a new one.',
  exhausted: 'This link has already been used.',
  revoked: 'This link is no longer active.',
};

export default async function DeliveryPage({
  params, searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ e?: string }>;
}) {
  const { token } = await params;
  const { e } = await searchParams;

  const delivery = isDeliveryToken(token) ? await new DeliveryRepository().findByToken(token) : null;
  const status = delivery ? deliveryStatusOf(delivery) : 'invalid';
  const problem = status !== 'active' ? MESSAGES[status] ?? MESSAGES.invalid : e ? MESSAGES[e] : null;

  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <h1 className="text-2xl font-bold text-gray-900">TamilAgaval</h1>

      {problem || !delivery ? (
        <p className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-6 text-gray-700">
          {problem ?? MESSAGES.invalid}
        </p>
      ) : (
        <div className="mt-6 rounded-lg border border-gray-200 p-6">
          <p className="font-medium text-gray-900">{delivery.filename}</p>
          <p className="mt-1 text-sm text-gray-500">
            {(delivery.contentLength / MB).toFixed(1)} MB ·{' '}
            {delivery.maxDownloads - delivery.downloadCount} download
            {delivery.maxDownloads - delivery.downloadCount === 1 ? '' : 's'} remaining ·
            expires {delivery.expiresAt.slice(0, 10)}
          </p>
          <Link
            href={`/api/d/${token}`}
            prefetch={false}
            className="mt-5 inline-block rounded-lg bg-orange-600 px-5 py-2.5 font-medium text-white hover:bg-orange-700"
          >
            Download
          </Link>
        </div>
      )}
    </main>
  );
}
```

> `prefetch={false}` matters: Next prefetches `<Link>` targets on hover, and a prefetch of the counting endpoint would spend a download the buyer never took.

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test npx jest delivery-page`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/d __tests__/app/delivery-page.test.tsx
git commit -m "feat(delivery): public page that never counts a download"
```

---

### Task 5: Admin routes

**Files:**
- Create: `src/app/api/admin/deliveries/route.ts`, `src/app/api/admin/deliveries/[token]/revoke/route.ts`
- Test: `__tests__/api/admin/deliveries.test.ts`

**Interfaces:**
- Consumes: Task 1 (`createDeliverySchema`, `isDeliveryToken`), Task 2 (`create`, `list`, `revoke`), `requireAdmin`/`requireBearer`/`authErrorResponse`, and `S3Operations` for a `HeadObjectCommand` size lookup.
- Produces: `POST`/`GET /api/admin/deliveries`, `POST /api/admin/deliveries/[token]/revoke`.
- Also adds: `S3Operations.getContentLength(key: string): Promise<number | null>` — `null` when the object is absent.

> **Why the size lookup.** The buyer's page shows the file size, and `Delivery.contentLength` is the only source for it. Without this the page reads "0.0 MB". The same call doubles as an existence check, so a link can never be minted for a key that is not there — which would otherwise fail only at download time, in front of a paying customer.

- [ ] **Step 1: Write the failing test**

```ts
/** @jest-environment node */
const create = jest.fn(async (i: Record<string, unknown>) => ({ token: 'c'.repeat(43), ...i }));
const list = jest.fn(async () => []);
const revoke = jest.fn(async () => undefined);
const getContentLength = jest.fn(async () => 12151796);

jest.mock('@/infrastructure/storage/s3-client', () => ({
  S3Operations: { getContentLength: (...a: unknown[]) => getContentLength(...a) },
}));
jest.mock('@/lib/auth-helper', () => ({
  requireAdmin: jest.fn(async () => ({ isAuthenticated: true, userId: 'u1' })),
  requireBearer: jest.fn(() => undefined),
  authErrorResponse: () => new Response('{}', { status: 401 }),
}));
jest.mock('@/infrastructure/database/DeliveryRepository', () => ({
  DeliveryRepository: jest.fn().mockImplementation(() => ({ create, list, revoke })),
}));

import { NextRequest } from 'next/server';
import { requireAdmin, requireBearer } from '@/lib/auth-helper';
import { POST, GET } from '@/app/api/admin/deliveries/route';
import { POST as REVOKE } from '@/app/api/admin/deliveries/[token]/revoke/route';

const post = (body: unknown) =>
  new NextRequest('https://x.test/api/admin/deliveries', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  });

beforeEach(() => jest.clearAllMocks());

it('requires admin to list', async () => {
  await GET(new NextRequest('https://x.test/api/admin/deliveries'));
  expect(requireAdmin).toHaveBeenCalled();
});

it('requires a bearer token to create — a cookie alone is CSRF-able', async () => {
  await POST(post({ s3Key: 'deliveries/a.mp3', filename: 'a.mp3', label: 'B' }));
  expect(requireBearer).toHaveBeenCalled();
});

it('creates and returns the full link, not just the token', async () => {
  const res = await POST(post({ s3Key: 'deliveries/a.mp3', filename: 'a.mp3', label: 'B' }));
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.url).toBe(`https://tamilagaval.com/d/${'c'.repeat(43)}`);
});

it('refuses a key outside the deliveries prefix', async () => {
  const res = await POST(post({ s3Key: 'audio/poem-music/song.mp3', filename: 'a.mp3', label: 'B' }));
  expect(res.status).toBe(400);
  expect(create).not.toHaveBeenCalled();
});

it('refuses to mint a link for an object that is not there', async () => {
  // Otherwise the failure surfaces at download time, in front of the buyer.
  getContentLength.mockResolvedValueOnce(null);
  const res = await POST(post({ s3Key: 'deliveries/ghost.mp3', filename: 'a.mp3', label: 'B' }));
  expect(res.status).toBe(404);
  expect(create).not.toHaveBeenCalled();
});

it('records the real byte size, so the page does not say 0.0 MB', async () => {
  getContentLength.mockResolvedValueOnce(12151796);
  await POST(post({ s3Key: 'deliveries/a.mp3', filename: 'a.mp3', label: 'B' }));
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ contentLength: 12151796 }));
});

it('revokes only a well-formed token', async () => {
  const bad = await REVOKE(post({}), { params: Promise.resolve({ token: '../x' }) });
  expect(bad.status).toBe(400);
  expect(revoke).not.toHaveBeenCalled();

  const ok = await REVOKE(post({}), { params: Promise.resolve({ token: 'd'.repeat(43) }) });
  expect(ok.status).toBe(200);
  expect(revoke).toHaveBeenCalledWith('d'.repeat(43));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test npx jest admin/deliveries`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

`src/app/api/admin/deliveries/route.ts`:

```ts
/**
 * GET  /api/admin/deliveries — list, newest first, with download counts.
 * POST /api/admin/deliveries — mint a link for an object under deliveries/.
 *
 * The response carries the full URL rather than a bare token, so the operator
 * copies one thing and cannot assemble it wrongly.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { DeliveryRepository } from '@/infrastructure/database/DeliveryRepository';
import { createDeliverySchema } from '@/types/delivery';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { SITE_URL } from '@/lib/seo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try { await requireAdmin(request); } catch (e) { return authErrorResponse(e); }
  const deliveries = await new DeliveryRepository().list();
  return NextResponse.json({ success: true, deliveries });
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (e) { return authErrorResponse(e); }

  const parsed = createDeliverySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      { status: 400 }
    );
  }

  // Size for the buyer's page, and an existence check in the same call — a link
  // for a missing key would otherwise fail at download time, in front of them.
  const contentLength = await S3Operations.getContentLength(parsed.data.s3Key);
  if (contentLength === null) {
    return NextResponse.json(
      { success: false, error: `No object at ${parsed.data.s3Key}` },
      { status: 404 }
    );
  }

  const delivery = await new DeliveryRepository().create({ ...parsed.data, contentLength });
  return NextResponse.json(
    { success: true, delivery, url: `${SITE_URL}/d/${delivery.token}` },
    { status: 201 }
  );
}
```

Add to `src/infrastructure/storage/s3-client.ts`, beside the existing `fileExists` (which uses the same `HeadObjectCommand` and is the pattern to follow):

```ts
  /** Byte size of an object, or null when it is not there. */
  static async getContentLength(key: string): Promise<number | null> {
    try {
      const r = await s3Client.send(new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
      return r.ContentLength ?? null;
    } catch (error: any) {
      if (error.name === 'NotFound') return null;
      throw error;
    }
  }
```

`src/app/api/admin/deliveries/[token]/revoke/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { DeliveryRepository } from '@/infrastructure/database/DeliveryRepository';
import { isDeliveryToken } from '@/types/delivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (e) { return authErrorResponse(e); }

  const { token } = await params;
  if (!isDeliveryToken(token)) {
    return NextResponse.json({ success: false, error: 'Bad token' }, { status: 400 });
  }

  await new DeliveryRepository().revoke(token);
  return NextResponse.json({ success: true });
}
```

> `SITE_URL` is exported from `src/lib/seo.ts` as `'https://tamilagaval.com'` — verified, use it rather than hardcoding the domain.

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test npx jest admin/deliveries`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/deliveries __tests__/api/admin/deliveries.test.ts
git commit -m "feat(delivery): admin create, list and revoke routes"
```

---

### Task 6: Admin UI and nav

**Files:**
- Create: `src/components/admin/DeliveryManager.tsx`, `src/app/(admin)/admin/deliveries/page.tsx`
- Modify: `src/config/admin-nav.ts`, `src/app/(admin)/AdminLayoutClient.tsx`
- Test: `__tests__/components/admin/DeliveryManager.test.tsx`

**Interfaces:**
- Consumes: Task 5's routes, `adminFetch` from `@/lib/client-auth`.
- Produces: `<DeliveryManager />`.

- [ ] **Step 1: Write the failing test**

```tsx
/** @jest-environment jsdom */
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { adminFetch } from '@/lib/client-auth';
import { DeliveryManager } from '@/components/admin/DeliveryManager';

const mockedFetch = adminFetch as jest.Mock;
const json = (b: unknown, s = 200) => ({ ok: s < 400, status: s, json: async () => b }) as unknown as Response;
const TOKEN = 'e'.repeat(43);

beforeEach(() => { jest.clearAllMocks(); mockedFetch.mockReset(); });

it('lists existing deliveries with their usage', async () => {
  mockedFetch.mockResolvedValueOnce(json({ success: true, deliveries: [
    { token: TOKEN, filename: 'Song.mp3', label: 'Anton — karaoke', downloadCount: 1,
      maxDownloads: 3, expiresAt: '2026-09-21T00:00:00.000Z', revokedAt: null },
  ] }));
  render(<DeliveryManager />);
  expect(await screen.findByText('Anton — karaoke')).toBeInTheDocument();
  expect(screen.getByText(/1 \/ 3/)).toBeInTheDocument();
});

it('creates a link and shows the URL for copying', async () => {
  mockedFetch.mockResolvedValueOnce(json({ success: true, deliveries: [] }));
  render(<DeliveryManager />);
  await screen.findByText(/No delivery links/i);

  await act(async () => {
    fireEvent.change(screen.getByLabelText(/S3 key/i), { target: { value: 'deliveries/a.mp3' } });
    fireEvent.change(screen.getByLabelText(/Filename/i), { target: { value: 'a.mp3' } });
    fireEvent.change(screen.getByLabelText(/Label/i), { target: { value: 'Buyer' } });
  });

  mockedFetch.mockResolvedValueOnce(json({ success: true, url: `https://tamilagaval.com/d/${TOKEN}`, delivery: {} }, 201));
  mockedFetch.mockResolvedValueOnce(json({ success: true, deliveries: [] }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Create link/i })); });

  await waitFor(() => expect(screen.getByDisplayValue(`https://tamilagaval.com/d/${TOKEN}`)).toBeInTheDocument());
});

it('surfaces a rejected key instead of failing silently', async () => {
  mockedFetch.mockResolvedValueOnce(json({ success: true, deliveries: [] }));
  render(<DeliveryManager />);
  await screen.findByText(/No delivery links/i);

  await act(async () => {
    fireEvent.change(screen.getByLabelText(/S3 key/i), { target: { value: 'audio/x.mp3' } });
    fireEvent.change(screen.getByLabelText(/Filename/i), { target: { value: 'a.mp3' } });
    fireEvent.change(screen.getByLabelText(/Label/i), { target: { value: 'B' } });
  });
  mockedFetch.mockResolvedValueOnce(json({ success: false, error: 'Key must be under deliveries/' }, 400));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Create link/i })); });

  expect(await screen.findByRole('alert')).toHaveTextContent(/deliveries\//);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test npx jest DeliveryManager`
Expected: FAIL — module not found

- [ ] **Step 3: Write the component, page and nav entry**

`src/components/admin/DeliveryManager.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';

interface Row {
  token: string; filename: string; label: string;
  downloadCount: number; maxDownloads: number; expiresAt: string; revokedAt: string | null;
}

export function DeliveryManager() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [form, setForm] = useState({ s3Key: '', filename: '', label: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await adminFetch('/api/admin/deliveries');
    const body = await res.json();
    setRows(body.deliveries ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = useCallback(async () => {
    setBusy(true); setError(null); setCreated(null);
    try {
      const res = await adminFetch('/api/admin/deliveries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not create the link.');
      setCreated(body.url);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  }, [form, load]);

  const revoke = useCallback(async (token: string) => {
    await adminFetch(`/api/admin/deliveries/${token}/revoke`, { method: 'POST' });
    await load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-lg border border-gray-200 p-4">
        {(['s3Key', 'filename', 'label'] as const).map((f) => (
          <div key={f}>
            <label htmlFor={`d-${f}`} className="block text-xs font-medium text-gray-600">
              {f === 's3Key' ? 'S3 key (must be under deliveries/)' : f === 'filename' ? 'Filename the buyer sees' : 'Label for your reference'}
            </label>
            <input
              id={`d-${f}`}
              value={form[f]}
              onChange={(e) => setForm((p) => ({ ...p, [f]: e.target.value }))}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </div>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => void create()}
          className="rounded bg-orange-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Create link
        </button>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {created && (
          <input readOnly value={created} onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-sm" />
        )}
      </div>

      {rows === null ? <p className="text-sm text-gray-500">Loading…</p>
        : rows.length === 0 ? <p className="text-sm text-gray-500">No delivery links yet.</p>
        : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.token} className="flex flex-wrap items-center gap-3 rounded border border-gray-200 px-3 py-2 text-sm">
              <span className="grow truncate">{r.label}</span>
              <span className="text-xs text-gray-500">{r.filename}</span>
              <span className="tabular-nums text-xs">{r.downloadCount} / {r.maxDownloads}</span>
              <span className="text-xs text-gray-500">{r.expiresAt.slice(0, 10)}</span>
              {r.revokedAt
                ? <span className="text-xs text-gray-400">revoked</span>
                : <button type="button" onClick={() => void revoke(r.token)}
                    className="text-xs font-medium text-red-600 hover:underline">Revoke</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

`src/app/(admin)/admin/deliveries/page.tsx`:

```tsx
import { DeliveryManager } from '@/components/admin/DeliveryManager';

export default function DeliveriesPage() {
  return <DeliveryManager />;
}
```

In `src/config/admin-nav.ts`, add `Send` to the lucide import block and this entry in the `Library` section:

```ts
  {
    href: '/admin/deliveries',
    title: 'Delivery links',
    subtitle: 'Expiring download links for paid files',
    section: 'Library',
    icon: Send,
    keywords: ['delivery', 'download', 'link', 'expiring', 'karaoke', 'commission'],
  },
```

In `src/app/(admin)/AdminLayoutClient.tsx`, add to `PAGE_TITLES`:

```ts
  "/admin/deliveries": {
    title: "Delivery links",
    subtitle: "Expiring download links for paid files",
  },
```

> **Both nav files, not just one.** `PAGE_TITLES` sets the page header; `admin-nav.ts` is what puts it in the sidebar. Adding only the former is how `/admin/mastering/bulk` shipped unreachable.

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test npx jest DeliveryManager`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/DeliveryManager.tsx "src/app/(admin)/admin/deliveries" src/config/admin-nav.ts "src/app/(admin)/AdminLayoutClient.tsx" __tests__/components/admin/DeliveryManager.test.tsx
git commit -m "feat(delivery): admin panel for creating and revoking links"
```

---

### Task 7: Close the CDN hole and retire the exposed files

**Files:**
- Modify: the `tamil-web-media` bucket policy (AWS, not in the repo)
- Create: `docs/DELIVERY_LINKS.md`

**Interfaces:**
- Consumes: nothing in code.
- Produces: `deliveries/*` unreachable over CloudFront; the two karaoke files removed from `audio/karaoke/`.

- [ ] **Step 1: Read the current policy and find the existing Deny**

```bash
aws s3api get-bucket-policy --bucket tamil-web-media \
  --query Policy --output text | jq '.Statement[] | select(.Sid | test("DenyCloudFront"))'
```

Expected: a statement `DenyCloudFrontOnMasteringWorkspace` denying `s3:GetObject` to the CloudFront service principal on `audio/mastering/*`.

- [ ] **Step 2: Back the policy up before touching it**

```bash
aws s3api get-bucket-policy --bucket tamil-web-media --query Policy --output text \
  > ~/reports/tamil-web-media.bucket-policy.$(date -u +%Y%m%dT%H%M%SZ).before.json
```

- [ ] **Step 3: Add `deliveries/*` to that statement's Resource list**

Extend the existing Deny rather than adding a second statement — one place to read, one place to get wrong. Apply with `aws s3api put-bucket-policy --bucket tamil-web-media --policy file://<edited>.json`.

- [ ] **Step 4: Verify from the outside, not from the policy text**

```bash
aws s3 cp <any small file> s3://tamil-web-media/deliveries/_probe.txt --quiet
curl -s -o /dev/null -w "%{http_code}\n" https://d2cdoh43143xxa.cloudfront.net/deliveries/_probe.txt
aws s3 rm s3://tamil-web-media/deliveries/_probe.txt --quiet
```

Expected: **403**. A 200 means the Deny did not take and the whole feature is decorative — stop and fix it before continuing.

- [ ] **Step 5: Delete the two karaoke files already public on the CDN**

```bash
aws s3 rm s3://tamil-web-media/audio/karaoke/Sevvanthi-Poove-Karaoke-standard.mp3
aws s3 rm s3://tamil-web-media/audio/karaoke/Sevvanthi-Poove-Karaoke-studio.mp3
curl -s -o /dev/null -w "%{http_code}\n" https://d2cdoh43143xxa.cloudfront.net/audio/karaoke/Sevvanthi-Poove-Karaoke-standard.mp3
```

Expected: **403 or 404.** These are the exposure the feature exists to end. Copies remain at `~/albums/karaoke/sevvanthi/`.

- [ ] **Step 6: Write the operator doc and commit**

`docs/DELIVERY_LINKS.md` covering: what a delivery link is, the 3-downloads / 7-days defaults, that payment is confirmed manually before creating one, how to revoke, that `deliveries/*` is denied to CloudFront and must stay that way, and the scanner reason the page exists.

```bash
git add docs/DELIVERY_LINKS.md
git commit -m "docs: delivery links runbook, and record the CloudFront Deny extension"
```

---

### Task 8: Full-suite gate

**Files:** none.

- [ ] **Step 1: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint src/ __tests__/
```

- [ ] **Step 2: Run the whole suite on its own exit code**

```bash
NODE_ENV=test npx jest --ci > /tmp/full.log 2>&1; echo "exit: $?"; tail -5 /tmp/full.log
```

Expected: `exit: 0`. **Do not pipe jest straight into `tail`** — the pipe reports tail's status and a red suite will look green.

- [ ] **Step 3: Commit anything outstanding**

```bash
git status --short
```

---

## Deliberately not built

- Taking or verifying payment (spec §12).
- Emailing the link — the operator sends it.
- Per-link expiry choice in the UI. `ttlDays` is accepted by the schema and defaults to 7; expose it only if deliveries start differing.
- Watermarking or per-buyer encoding.
