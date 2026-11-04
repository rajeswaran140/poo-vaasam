/** @jest-environment node */
/**
 * Visual story repository — lifecycle and the hard-cap budget reservation.
 *
 * The reservation is what stops concurrent paid calls overspending a story's
 * budget, so the budget tests run against a small in-memory store that really
 * evaluates the ConditionExpression and applies the ADD, rather than a mock
 * returning canned results.
 */

type Item = Record<string, any>;
const store = new Map<string, Item>();
const keyOf = (k: { PK: string; SK: string }) => `${k.PK}|${k.SK}`;

const cond = (name: string, v: string) => {
  const e = new Error(`${name}: ${v}`);
  e.name = 'ConditionalCheckFailedException';
  return e;
};

/** Evaluates `attr <= :v`, `attr = :v` and `attribute_exists(attr)` joined by AND. */
function evalCondition(item: Item | undefined, expr: string, vals: Item): boolean {
  return expr.split(/\s+AND\s+/).every((clause) => {
    const exists = /^attribute_exists\((\w+)\)$/.exec(clause.trim());
    if (exists) return !!item && item[exists[1]] !== undefined;
    const m = /^(\w+)\s*(<=|=)\s*(:\w+)$/.exec(clause.trim());
    if (!m) throw new Error(`fake store cannot evaluate: ${clause}`);
    const actual = item?.[m[1]];
    if (actual === undefined) return false; // a missing attribute fails the comparison
    return m[2] === '<=' ? actual <= vals[m[3]] : actual === vals[m[3]];
  });
}

/** Applies `ADD a :x, b :y` (numeric). */
function applyAdd(item: Item, expr: string, vals: Item) {
  const body = /^ADD\s+(.*)$/.exec(expr.trim());
  if (!body) throw new Error(`fake store cannot apply: ${expr}`);
  for (const part of body[1].split(',')) {
    const [attr, ph] = part.trim().split(/\s+/);
    item[attr] = Math.round(((item[attr] ?? 0) + vals[ph]) * 1e6) / 1e6;
  }
}

const mockUpdate = jest.fn(async (p: any) => {
  const k = keyOf(p.key);
  const item = store.get(k);
  if (p.conditionExpression && !evalCondition(item, p.conditionExpression, p.expressionAttributeValues)) {
    throw cond('cond', p.conditionExpression);
  }
  if (!item) throw cond('missing', k);
  if (/^ADD\s/.test(p.updateExpression.trim())) applyAdd(item, p.updateExpression, p.expressionAttributeValues);
  return { ...item };
});
const mockPut = jest.fn(async (item: Item) => { store.set(keyOf(item as any), { ...item }); });
const mockGet = jest.fn(async (key: any) => {
  const it = store.get(keyOf(key));
  return it ? { ...it } : undefined;
});
const mockQuery = jest.fn();
const mockDelete = jest.fn(async (key: any) => { store.delete(keyOf(key)); });

jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: {
    put: (...a: unknown[]) => mockPut(...(a as [Item])),
    get: (...a: unknown[]) => mockGet(...(a as [any])),
    query: (...a: unknown[]) => mockQuery(...a),
    update: (...a: unknown[]) => mockUpdate(...(a as [any])),
    delete: (...a: unknown[]) => mockDelete(...(a as [any])),
  },
  handleDynamoDBError: (e: unknown) => { throw e; },
}));

import {
  VisualStoryRepository,
  NotFoundError,
  VSTORY_INDEX_PK,
  VSTORY_INFLIGHT_PK,
  vsPk,
  sceneSk,
  shotSk,
  candSk,
  charSk,
  draftSk,
} from '@/infrastructure/database/VisualStoryRepository';
import { DEFAULT_BUDGET_USD_CAP } from '@/types/visualStory';

const repo = new VisualStoryRepository();
const VS = 'vs_1730000000000_abcdef12';

const input = (over: Record<string, unknown> = {}) => ({
  masterJobId: 'm1',
  title: 'Test song',
  aspectRatio: '16:9' as const,
  windowStartSec: 0,
  windowEndSec: 60,
  audioKey: 'audio/mastering/m1.wav',
  ...over,
});

beforeEach(() => {
  store.clear();
  [mockUpdate, mockPut, mockGet, mockQuery, mockDelete].forEach((m) => m.mockClear());
});

describe('key builders', () => {
  it('zero-pads orders so begins_with scans sort', () => {
    expect(vsPk(VS)).toBe(`VSTORY#${VS}`);
    expect(sceneSk(2)).toBe('SCENE#002');
    expect(shotSk(2, 11)).toBe('SHOT#002#011');
    expect(candSk(1, 3, 'cd_x')).toBe('CAND#001#003#cd_x');
    expect(charSk('ch_x')).toBe('CHAR#ch_x');
    expect(draftSk('dr_x')).toBe('DRAFT#dr_x');
    expect(VSTORY_INDEX_PK).toBe('VSTORY');
    expect(VSTORY_INFLIGHT_PK).toBe('VSTORY_INFLIGHT');
  });
});

describe('create', () => {
  it('writes the sparse index attrs and zero counters', async () => {
    const s = await repo.create(input());
    const w = mockPut.mock.calls[0][0] as Item;
    expect(w.PK).toBe(`VSTORY#${s.vsId}`);
    expect(w.SK).toBe('METADATA');
    expect(w.GSI1PK).toBe('VSTORY');
    expect(w.GSI1SK).toBe(`m1#${s.createdAt}#${s.vsId}`);
    expect(w).toMatchObject({
      spentUsd: 0, reservedUsd: 0, committedUsd: 0,
      budgetUsdCap: DEFAULT_BUDGET_USD_CAP, status: 'DRAFT', providerId: 'grok', contentId: null,
    });
    expect(s).toMatchObject({ vsId: s.vsId, status: 'DRAFT', committedUsd: 0 });
    expect(s).not.toHaveProperty('PK');
    expect(s).not.toHaveProperty('GSI1PK');
  });

  it('honours an explicit cap, including 0', async () => {
    expect((await repo.create(input({ budgetUsdCap: 0 }))).budgetUsdCap).toBe(0);
    expect((await repo.create(input({ budgetUsdCap: 5 }))).budgetUsdCap).toBe(5);
  });
});

describe('reads', () => {
  it('findById returns null when absent and strips table keys when present', async () => {
    expect(await repo.findById(VS)).toBeNull();
    const s = await repo.create(input());
    const found = await repo.findById(s.vsId);
    expect(found).toEqual(s);
  });

  it('list queries GSI1 on the VSTORY partition', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [] });
    await repo.list();
    expect(mockQuery.mock.calls[0][0]).toMatchObject({
      indexName: 'GSI1',
      keyConditionExpression: 'GSI1PK = :pk',
      expressionAttributeValues: { ':pk': 'VSTORY' },
    });
  });

  it('listByMaster queries GSI1 with begins_with "<masterJobId>#"', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [] });
    await repo.listByMaster('m1');
    const q = mockQuery.mock.calls[0][0];
    expect(q.indexName).toBe('GSI1');
    expect(q.keyConditionExpression).toBe('GSI1PK = :pk AND begins_with(GSI1SK, :prefix)');
    expect(q.expressionAttributeValues).toEqual({ ':pk': 'VSTORY', ':prefix': 'm1#' });
  });

  it('list follows LastEvaluatedKey across pages', async () => {
    const row = (n: number) => ({ PK: `VSTORY#vs${n}`, SK: 'METADATA', vsId: `vs${n}`, GSI1PK: 'VSTORY', GSI1SK: 'x' });
    mockQuery
      .mockResolvedValueOnce({ Items: [row(1)], LastEvaluatedKey: { PK: 'a' } })
      .mockResolvedValueOnce({ Items: [row(2)] });
    const out = await repo.list();
    expect(out.map((s) => s.vsId)).toEqual(['vs1', 'vs2']);
    expect(mockQuery.mock.calls[1][0].exclusiveStartKey).toEqual({ PK: 'a' });
  });
});

describe('patch', () => {
  it('sets only the given fields plus updatedAt, guarded by existence', async () => {
    store.set(`VSTORY#${VS}|METADATA`, { PK: `VSTORY#${VS}`, SK: 'METADATA', committedUsd: 0 });
    await repo.patch(VS, { title: 'New', budgetUsdCap: 12.3456789 });
    const p = mockUpdate.mock.calls[0][0];
    expect(p.key).toEqual({ PK: `VSTORY#${VS}`, SK: 'METADATA' });
    expect(p.conditionExpression).toBe('attribute_exists(PK) AND committedUsd <= :cap');
    expect(p.updateExpression).toMatch(/^SET /);
    expect(Object.values(p.expressionAttributeValues)).toEqual(
      expect.arrayContaining(['New', 12.345679])
    );
    expect(p.updateExpression).toContain('updatedAt');
    expect(p.updateExpression).not.toContain('status');
  });
});

describe('patch cap guard', () => {
  it('throws CapBelowCommittedError when committed exceeds the new cap at write time', async () => {
    store.set(`VSTORY#${VS}|METADATA`, { PK: `VSTORY#${VS}`, SK: 'METADATA', committedUsd: 15, budgetUsdCap: 40 });
    await expect(repo.patch(VS, { budgetUsdCap: 12 })).rejects.toMatchObject({
      name: 'CapBelowCommittedError',
      committedUsd: 15,
    });
  });
  it('throws NotFoundError when the story is gone', async () => {
    await expect(repo.patch(VS, { budgetUsdCap: 12 })).rejects.toBeInstanceOf(NotFoundError);
  });
  it('allows a cap equal to committed', async () => {
    store.set(`VSTORY#${VS}|METADATA`, { PK: `VSTORY#${VS}`, SK: 'METADATA', committedUsd: 12 });
    await expect(repo.patch(VS, { budgetUsdCap: 12 })).resolves.toBeUndefined();
  });
});

describe('remove', () => {
  it('deletes every item in the partition across pages', async () => {
    mockQuery
      .mockResolvedValueOnce({
        Items: [{ PK: `VSTORY#${VS}`, SK: 'METADATA' }, { PK: `VSTORY#${VS}`, SK: 'SCENE#001' }],
        LastEvaluatedKey: { PK: 'k' },
      })
      .mockResolvedValueOnce({ Items: [{ PK: `VSTORY#${VS}`, SK: 'SHOT#001#001' }] });
    await repo.remove(VS);
    expect(mockQuery.mock.calls[0][0].expressionAttributeValues).toEqual({ ':pk': `VSTORY#${VS}` });
    expect(mockDelete.mock.calls.map((c) => c[0])).toEqual([
      { PK: `VSTORY#${VS}`, SK: 'METADATA' },
      { PK: `VSTORY#${VS}`, SK: 'SCENE#001' },
      { PK: `VSTORY#${VS}`, SK: 'SHOT#001#001' },
    ]);
  });
});

describe('reserve', () => {
  const seed = async (cap: number) => (await repo.create(input({ budgetUsdCap: cap }))).vsId;
  const meta = (id: string) => store.get(`VSTORY#${id}|METADATA`)!;

  it('sends the conditional ADD on committedUsd and the cap read', async () => {
    const id = await seed(0.5);
    expect(await repo.reserve(id, 0.3)).toBe(true);
    const p = mockUpdate.mock.calls[0][0];
    expect(p.updateExpression).toBe('ADD reservedUsd :u, committedUsd :u');
    expect(p.conditionExpression).toBe('committedUsd <= :limit AND budgetUsdCap = :capRead');
    expect(p.expressionAttributeValues).toEqual({ ':u': 0.3, ':limit': 0.2, ':capRead': 0.5 });
    expect(meta(id)).toMatchObject({ reservedUsd: 0.3, committedUsd: 0.3, spentUsd: 0 });
  });

  it('two reserves of 0.30 against cap 0.50: first true, second false', async () => {
    const id = await seed(0.5);
    expect(await repo.reserve(id, 0.3)).toBe(true);
    expect(await repo.reserve(id, 0.3)).toBe(false);
    expect(meta(id)).toMatchObject({ reservedUsd: 0.3, committedUsd: 0.3 });
  });

  it('concurrent reserves cannot jointly pass the cap', async () => {
    const id = await seed(0.5);
    const results = await Promise.all([repo.reserve(id, 0.3), repo.reserve(id, 0.3), repo.reserve(id, 0.3)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(meta(id).committedUsd).toBe(0.3);
  });

  it('allows exactly reaching the cap, despite float drift', async () => {
    const id = await seed(0.3);
    expect(await repo.reserve(id, 0.1)).toBe(true);
    expect(await repo.reserve(id, 0.1)).toBe(true);
    expect(await repo.reserve(id, 0.1)).toBe(true);
    expect(await repo.reserve(id, 0.01)).toBe(false);
    expect(meta(id).committedUsd).toBe(0.3);
  });

  it('counts spent money against the cap', async () => {
    const id = await seed(0.5);
    await repo.reserve(id, 0.4);
    await repo.settle(id, { reservedUsd: 0.4, billedUsd: 0.4 });
    expect(await repo.reserve(id, 0.2)).toBe(false);
    expect(await repo.reserve(id, 0.1)).toBe(true);
  });

  it('refuses without writing when usd exceeds the whole cap (negative limit)', async () => {
    const id = await seed(0.5);
    expect(await repo.reserve(id, 0.6)).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('cap 0 blocks all paid generation', async () => {
    const id = await seed(0);
    expect(await repo.reserve(id, 0.02)).toBe(false);
  });

  it('fails the reservation when the cap is edited between the read and the write', async () => {
    const id = await seed(5);
    // The cap is lowered by another request after our read but before our write.
    mockGet.mockImplementationOnce(async (key: any) => {
      const snapshot = { ...store.get(keyOf(key))! };
      store.get(keyOf(key))!.budgetUsdCap = 0.1;
      return snapshot;
    });
    expect(await repo.reserve(id, 1)).toBe(false);
    expect(meta(id).reservedUsd).toBe(0);
  });

  it('rethrows any error other than ConditionalCheckFailedException', async () => {
    const id = await seed(5);
    const boom = Object.assign(new Error('throttled'), { name: 'ProvisionedThroughputExceededException' });
    mockUpdate.mockRejectedValueOnce(boom);
    await expect(repo.reserve(id, 1)).rejects.toBe(boom);
  });

  it('throws for an unknown story rather than reporting a budget refusal', async () => {
    await expect(repo.reserve(VS, 1)).rejects.toThrow(/not found/i);
  });

  it('rejects a negative or non-finite amount', async () => {
    const id = await seed(5);
    await expect(repo.reserve(id, -1)).rejects.toThrow();
    await expect(repo.reserve(id, NaN)).rejects.toThrow();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('settle', () => {
  const seedReserved = async (usd: number) => {
    const id = (await repo.create(input({ budgetUsdCap: 5 }))).vsId;
    await repo.reserve(id, usd);
    return id;
  };
  const meta = (id: string) => store.get(`VSTORY#${id}|METADATA`)!;

  it('billed == reserved: committed unchanged, 0.02 moves from reserved to spent', async () => {
    const id = await seedReserved(0.02);
    await repo.settle(id, { reservedUsd: 0.02, billedUsd: 0.02 });
    const p = mockUpdate.mock.calls.at(-1)![0];
    expect(p.updateExpression).toBe('ADD reservedUsd :negR, spentUsd :b, committedUsd :delta');
    expect(p.expressionAttributeValues).toEqual({ ':negR': -0.02, ':b': 0.02, ':delta': 0 });
    expect(meta(id)).toMatchObject({ reservedUsd: 0, spentUsd: 0.02, committedUsd: 0.02 });
  });

  it('billed 0: releases the reservation only', async () => {
    const id = await seedReserved(0.02);
    await repo.settle(id, { reservedUsd: 0.02, billedUsd: 0 });
    expect(meta(id)).toMatchObject({ reservedUsd: 0, spentUsd: 0, committedUsd: 0 });
  });

  it('billed above the estimate raises committed by the difference', async () => {
    const id = await seedReserved(0.02);
    await repo.settle(id, { reservedUsd: 0.02, billedUsd: 0.05 });
    expect(meta(id)).toMatchObject({ reservedUsd: 0, spentUsd: 0.05, committedUsd: 0.05 });
  });
});

describe('countShots', () => {
  it('counts SHOT# items across pages with a COUNT query', async () => {
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce({ Count: 3, LastEvaluatedKey: { PK: 'x', SK: 'y' } })
      .mockResolvedValueOnce({ Count: 2 });
    const n = await new VisualStoryRepository().countShots('vs_1700000000000_abcdef12');
    expect(n).toBe(5);
    const first = mockQuery.mock.calls[0][0];
    expect(first.keyConditionExpression).toBe('PK = :pk AND begins_with(SK, :sk)');
    expect(first.expressionAttributeValues).toEqual({ ':pk': 'VSTORY#vs_1700000000000_abcdef12', ':sk': 'SHOT#' });
    expect(first.select).toBe('COUNT');
    expect(mockQuery.mock.calls[1][0].exclusiveStartKey).toEqual({ PK: 'x', SK: 'y' });
  });
});
