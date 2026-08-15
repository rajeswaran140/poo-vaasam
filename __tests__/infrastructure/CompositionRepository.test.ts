/** @jest-environment node */
/**
 * CompositionRepository — item-per-version persistence.
 *
 * The guarantee under test is §16: **earlier creative decisions are never
 * overwritten.** Editing the working state must not touch a stored version, and
 * a new version must not rewrite an old one. Both are easy to break in a way
 * that looks fine until the composer goes back for the slow version and finds
 * the fast one.
 */

const mockPut = jest.fn();
const mockQuery = jest.fn();
const mockDelete = jest.fn();
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: {
    put: (...a: unknown[]) => mockPut(...a),
    query: (...a: unknown[]) => mockQuery(...a),
    delete: (...a: unknown[]) => mockDelete(...a),
    get: jest.fn(),
  },
  handleDynamoDBError: (e: unknown) => { throw e; },
}));

import { CompositionRepository } from '@/infrastructure/database/CompositionRepository';

const repo = new CompositionRepository();

const metaItem = (over: Record<string, unknown> = {}) => ({
  PK: 'COMPOSITION#cmp_1', SK: 'METADATA', id: 'cmp_1', title: 'மழை',
  status: 'sketch', spec: { bpm: 90, meter: '4/4' }, versionCount: 0,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', ...over,
});
const versionItem = (n: number, spec: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  PK: 'COMPOSITION#cmp_1', SK: `VERSION#${String(n).padStart(6, '0')}`,
  version: n, label: `V${n}`, spec, createdAt: '2026-08-01T00:00:00.000Z', ...over,
});

beforeEach(() => jest.clearAllMocks());

describe('create', () => {
  it('writes GSI1 attributes so the list is a query, not a scan', async () => {
    mockPut.mockResolvedValueOnce({});
    const c = await repo.create({ title: 'மழை', status: 'idea', spec: {} });
    const item = mockPut.mock.calls[0][0];
    expect(item.GSI1PK).toBe('COMPOSITION');
    expect(item.GSI1SK).toContain(c.id);
    expect(item.SK).toBe('METADATA');
    expect(item.Type).toBe('COMPOSITION');
  });

  it('starts with no versions', async () => {
    mockPut.mockResolvedValueOnce({});
    expect((await repo.create({ title: 'x', status: 'idea', spec: {} })).versions).toEqual([]);
  });
});

describe('findById', () => {
  it('reads the metadata and every version from one partition query', async () => {
    mockQuery.mockResolvedValueOnce({
      Items: [metaItem(), versionItem(1, { bpm: 80 }), versionItem(2, { bpm: 96 })],
    });
    const c = await repo.findById('cmp_1');
    expect(c!.title).toBe('மழை');
    expect(c!.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('orders versions numerically, not by insertion order', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [metaItem(), versionItem(2, {}), versionItem(1, {})] });
    expect((await repo.findById('cmp_1'))!.versions.map((v) => v.version)).toEqual([1, 2]);
  });

  it('returns null when there is no metadata item', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [] });
    expect(await repo.findById('cmp_1')).toBeNull();
  });
});

/** ⚠️ §16 — the reason a notebook exists rather than one editable field. */
describe('update never touches stored versions', () => {
  it('writes ONLY the metadata item', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [metaItem(), versionItem(1, { bpm: 80 })] });
    mockPut.mockResolvedValueOnce({});
    await repo.update('cmp_1', { spec: { bpm: 140 } });

    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(mockPut.mock.calls[0][0].SK).toBe('METADATA');
  });

  it('merges the spec field-by-field, so a partial save cannot wipe other fields', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [metaItem({ spec: { bpm: 90, meter: '4/4', raga: 'மோகனம்' } })] });
    mockPut.mockResolvedValueOnce({});
    const c = await repo.update('cmp_1', { spec: { bpm: 140 } });
    expect(c.spec).toEqual({ bpm: 140, meter: '4/4', raga: 'மோகனம்' });
  });

  it('keeps createdAt and moves updatedAt', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [metaItem()] });
    mockPut.mockResolvedValueOnce({});
    const c = await repo.update('cmp_1', { title: 'new' });
    expect(c.createdAt.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(c.updatedAt.getTime()).toBeGreaterThan(c.createdAt.getTime());
  });

  it('404s on a missing composition rather than creating one', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [] });
    await expect(repo.update('cmp_1', { title: 'x' })).rejects.toThrow(/not found/i);
  });
});

describe('addVersion', () => {
  it('writes a NEW version item and never rewrites an existing one', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [metaItem(), versionItem(1, { bpm: 80 })] });
    mockPut.mockResolvedValue({});
    await repo.addVersion('cmp_1', { spec: { bpm: 96 } });

    const versionWrites = mockPut.mock.calls.map((c) => c[0]).filter((i) => String(i.SK).startsWith('VERSION#'));
    expect(versionWrites).toHaveLength(1);
    expect(versionWrites[0].SK).toBe('VERSION#000002'); // the NEXT slot
    expect(versionWrites[0].version).toBe(2);
  });

  it('zero-pads the sort key so lexicographic order matches numeric order', async () => {
    const nine = Array.from({ length: 9 }, (_, i) => versionItem(i + 1, {}));
    mockQuery.mockResolvedValueOnce({ Items: [metaItem(), ...nine] });
    mockPut.mockResolvedValue({});
    await repo.addVersion('cmp_1', {});
    const write = mockPut.mock.calls.map((c) => c[0]).find((i) => String(i.SK).startsWith('VERSION#'));
    expect(write.SK).toBe('VERSION#000010');
    expect('VERSION#000009' < 'VERSION#000010').toBe(true);
  });

  it('snapshots the CURRENT working spec when none is supplied', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [metaItem({ spec: { bpm: 123, meter: '6/8' } })] });
    mockPut.mockResolvedValue({});
    await repo.addVersion('cmp_1', {});
    const write = mockPut.mock.calls.map((c) => c[0]).find((i) => String(i.SK).startsWith('VERSION#'));
    expect(write.spec).toEqual({ bpm: 123, meter: '6/8' });
  });

  it('defaults the label to V<n> but keeps a custom one', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [metaItem()] });
    mockPut.mockResolvedValue({});
    const c = await repo.addVersion('cmp_1', { label: 'Final' });
    expect(c.versions[0].label).toBe('Final');

    jest.clearAllMocks();
    mockQuery.mockResolvedValueOnce({ Items: [metaItem()] });
    mockPut.mockResolvedValue({});
    expect((await repo.addVersion('cmp_1', {})).versions[0].label).toBe('V1');
  });

  it('keeps every earlier version in the returned record', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [metaItem(), versionItem(1, { bpm: 80 }), versionItem(2, { bpm: 90 })] });
    mockPut.mockResolvedValue({});
    const c = await repo.addVersion('cmp_1', { spec: { bpm: 100 } });
    expect(c.versions.map((v) => v.spec.bpm)).toEqual([80, 90, 100]);
  });
});

describe('delete', () => {
  it('removes every version before the metadata, so nothing is orphaned', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [metaItem(), versionItem(1, {}), versionItem(2, {})] });
    mockDelete.mockResolvedValue({});
    await repo.delete('cmp_1');

    const keys = mockDelete.mock.calls.map((c) => c[0].SK);
    expect(keys).toEqual(['VERSION#000001', 'VERSION#000002', 'METADATA']);
  });

  it('is a no-op on a composition that does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [] });
    await repo.delete('cmp_1');
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe('list', () => {
  it('returns summaries newest-first without version bodies', async () => {
    mockQuery.mockResolvedValueOnce({
      Items: [
        metaItem({ id: 'cmp_old', updatedAt: '2026-08-01T00:00:00.000Z', versionCount: 1 }),
        metaItem({ id: 'cmp_new', updatedAt: '2026-08-10T00:00:00.000Z', versionCount: 3 }),
      ],
    });
    const rows = await repo.list();
    expect(rows.map((r) => r.id)).toEqual(['cmp_new', 'cmp_old']);
    expect(rows[0].versionCount).toBe(3);
    expect(rows[0]).not.toHaveProperty('versions');
  });
});
