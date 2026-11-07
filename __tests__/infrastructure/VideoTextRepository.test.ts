/** @jest-environment node */
/**
 * How a Video Text project is written, edited and rendered.
 * The properties that matter: edits are version-guarded, a render can only start
 * when none is in flight (or the last one went stale), and a stale worker can
 * never overwrite a newer render.
 */

const mockPut = jest.fn();
const mockGet = jest.fn();
const mockUpdate = jest.fn();
const mockQuery = jest.fn();
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: {
    put: (...a: unknown[]) => mockPut(...a),
    get: (...a: unknown[]) => mockGet(...a),
    query: (...a: unknown[]) => mockQuery(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
    delete: jest.fn(),
  },
  handleDynamoDBError: (e: unknown) => { throw e; },
}));

import { VideoTextRepository, RENDER_STALE_MS } from '@/infrastructure/database/VideoTextRepository';
import type { SourceInfo } from '@/types/videoText';

const repo = new VideoTextRepository();
const ccf = () => Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' });
const arg = () => mockUpdate.mock.calls[0][0] as {
  key: Record<string, string>;
  updateExpression: string;
  conditionExpression: string;
  expressionAttributeNames: Record<string, string>;
  expressionAttributeValues: Record<string, unknown>;
};

beforeEach(() => { mockPut.mockReset(); mockGet.mockReset(); mockUpdate.mockReset(); mockQuery.mockReset(); });

describe('create', () => {
  it('writes an idle, empty, version-1 project guarded by attribute_not_exists(PK)', async () => {
    const p = await repo.create('  My video  ');
    const [item, opts] = mockPut.mock.calls[0];
    expect(p.name).toBe('My video');
    expect(p.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(item).toMatchObject({
      PK: `VIDEOTEXT#${p.id}`, SK: 'METADATA', GSI1PK: 'VIDEOTEXT', GSI1SK: p.updatedAt,
      titleText: '', creditsText: '', lyricsText: '', blocks: [],
      style: { sizeScale: 1, lyricPosition: 'lower' }, source: null, version: 1,
      render: {
        renderId: null, status: 'idle', progress: null, outputKey: null,
        outputExpiresAt: null, error: null, startedAt: null, updatedAt: null,
      },
    });
    expect(opts.conditionExpression).toBe('attribute_not_exists(PK)');
  });

  it('rejects an empty or over-long name without writing', async () => {
    await expect(repo.create('   ')).rejects.toThrow();
    await expect(repo.create('x'.repeat(121))).rejects.toThrow();
    expect(mockPut).not.toHaveBeenCalled();
  });
});

describe('get', () => {
  it('returns null for a missing item and strips key attributes from a found one', async () => {
    mockGet.mockResolvedValueOnce(undefined);
    expect(await repo.get('abc')).toBeNull();
    mockGet.mockResolvedValueOnce({ PK: 'VIDEOTEXT#abc', SK: 'METADATA', GSI1PK: 'VIDEOTEXT', GSI1SK: 'x', id: 'abc', name: 'n' });
    const p = (await repo.get('abc')) as unknown as Record<string, unknown>;
    expect(p.id).toBe('abc');
    expect(p.PK).toBeUndefined();
    expect(p.GSI1PK).toBeUndefined();
  });

  it('F2: reads strongly consistent only when asked', async () => {
    mockGet.mockResolvedValue(undefined);
    await repo.get('abc');
    expect(mockGet.mock.calls[0]).toEqual([{ PK: 'VIDEOTEXT#abc', SK: 'METADATA' }]);
    await repo.get('abc', { consistent: true });
    expect(mockGet.mock.calls[1]).toEqual([{ PK: 'VIDEOTEXT#abc', SK: 'METADATA' }, { consistentRead: true }]);
  });

  it('rejects an invalid id without reading', async () => {
    await expect(repo.get('../x')).rejects.toThrow();
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('list', () => {
  it('queries GSI1 newest first with the limit', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [{ PK: 'VIDEOTEXT#a', id: 'a' }] });
    const out = await repo.list(10);
    expect(mockQuery).toHaveBeenCalledWith(expect.objectContaining({
      indexName: 'GSI1', scanIndexForward: false, limit: 10,
      keyConditionExpression: 'GSI1PK = :pk', expressionAttributeValues: { ':pk': 'VIDEOTEXT' },
    }));
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('a');
  });
});

describe('saveEdits', () => {
  const edits = {
    name: 'n', titleText: 't', creditsText: 'c', lyricsText: 'l', blocks: [],
    style: { sizeScale: 1, lyricPosition: 'lower' as const },
  };

  it('is conditional on version = :expected, bumps it, and refreshes updatedAt + GSI1SK', async () => {
    mockUpdate.mockResolvedValueOnce({ version: 4 });
    const r = await repo.saveEdits('abc', edits, 3);
    const a = arg();
    expect(a.key).toEqual({ PK: 'VIDEOTEXT#abc', SK: 'METADATA' });
    expect(a.conditionExpression).toContain('#version = :expected');
    expect(a.conditionExpression).toContain('attribute_exists(PK)');
    expect(a.expressionAttributeValues[':expected']).toBe(3);
    expect(a.expressionAttributeValues[':next']).toBe(4);
    expect(a.updateExpression).toContain('GSI1SK');
    expect(a.updateExpression).toContain('#updatedAt');
    expect(r).toEqual({ ok: true, version: 4 });
  });

  it('answers conflict when the row exists at another version', async () => {
    mockUpdate.mockRejectedValueOnce(ccf());
    mockGet.mockResolvedValueOnce({ id: 'abc', version: 9 });
    expect(await repo.saveEdits('abc', edits, 3)).toEqual({ ok: false, reason: 'conflict' });
  });

  it('answers missing when the row does not exist', async () => {
    mockUpdate.mockRejectedValueOnce(ccf());
    mockGet.mockResolvedValueOnce(undefined);
    expect(await repo.saveEdits('abc', edits, 3)).toEqual({ ok: false, reason: 'missing' });
  });

  it('rethrows other errors', async () => {
    mockUpdate.mockRejectedValueOnce(new Error('boom'));
    await expect(repo.saveEdits('abc', edits, 3)).rejects.toThrow('boom');
  });
});

describe('setSource', () => {
  const src: SourceInfo = {
    key: 'k', width: 1920, height: 1080, fps: 30, durationSec: 12.3499,
    hasAudio: true, uploadedAt: 'a', expiresAt: 'b',
  };

  it('floors durationSec to 0.01 s, stores blocks and resets render to idle', async () => {
    mockUpdate.mockResolvedValueOnce({ version: 5 });
    await repo.setSource('abc', src, []);
    const a = arg();
    expect((a.expressionAttributeValues[':source'] as SourceInfo).durationSec).toBe(12.34);
    expect(a.expressionAttributeValues[':blocks']).toEqual([]);
    expect(a.expressionAttributeValues[':render']).toMatchObject({ renderId: null, status: 'idle', progress: null });
    expect(a.conditionExpression).toBe('attribute_exists(PK)');
  });

  it('increments version, refreshes updatedAt + GSI1SK, and returns the new version', async () => {
    mockUpdate.mockResolvedValueOnce({ version: 5 });
    const r = await repo.setSource('abc', src, []);
    const a = arg();
    expect(a.updateExpression).toContain('#version = #version + :one');
    expect(a.expressionAttributeNames['#version']).toBe('version');
    expect(a.expressionAttributeValues[':one']).toBe(1);
    expect(a.updateExpression).toContain('GSI1SK = :now');
    expect(a.updateExpression).toContain('#updatedAt = :now');
    expect(r).toEqual({ version: 5, durationSec: 12.34 });
  });

  it('F1: floors idempotently — an already-floored 128.14 is stored (and returned) as 128.14', async () => {
    mockUpdate.mockResolvedValueOnce({ version: 5 });
    const r = await repo.setSource('abc', { ...src, durationSec: 128.14 }, []);
    expect((arg().expressionAttributeValues[':source'] as SourceInfo).durationSec).toBe(128.14);
    expect(r).toMatchObject({ durationSec: 128.14 });
  });

  it('does not mutate the caller\'s source object', async () => {
    mockUpdate.mockResolvedValueOnce({ version: 2 });
    await repo.setSource('abc', src, []);
    expect(src.durationSec).toBe(12.3499);
  });

  it('throws when the project does not exist', async () => {
    mockUpdate.mockRejectedValueOnce(ccf());
    await expect(repo.setSource('abc', src, [])).rejects.toThrow(/not found/);
  });
});

describe('startRender', () => {
  const now = Date.parse('2026-11-07T12:00:00.000Z');

  it('sends the idle/done/error OR stale condition and moves to queued', async () => {
    mockUpdate.mockResolvedValueOnce({});
    expect(await repo.startRender('abc', 'r1', now)).toEqual({ ok: true });
    const a = arg();
    expect(a.conditionExpression).toBe(
      'attribute_exists(PK) AND (#render.#status IN (:idle, :done, :error) OR #render.#updatedAt < :staleBefore)'
    );
    expect(a.expressionAttributeNames).toMatchObject({ '#render': 'render', '#status': 'status', '#updatedAt': 'updatedAt' });
    expect(a.expressionAttributeValues[':staleBefore']).toBe(new Date(now - RENDER_STALE_MS).toISOString());
    expect(a.expressionAttributeValues[':queued']).toBe('queued');
    expect(a.expressionAttributeValues[':renderId']).toBe('r1');
    expect(a.expressionAttributeValues[':null']).toBeNull();
    expect(a.updateExpression).toContain('#render.#error = :null');
    expect(a.updateExpression).toContain('#render.#outputKey = :null');
    expect(a.updateExpression).toContain('#render.#progress = :null');
  });

  it('is 20 minutes', () => { expect(RENDER_STALE_MS).toBe(20 * 60 * 1000); });

  it('returns { ok: false } when the condition fails (a render is in flight)', async () => {
    mockUpdate.mockRejectedValueOnce(ccf());
    expect(await repo.startRender('abc', 'r1', now)).toEqual({ ok: false });
  });

  it('rethrows other errors', async () => {
    mockUpdate.mockRejectedValueOnce(new Error('boom'));
    await expect(repo.startRender('abc', 'r1', now)).rejects.toThrow('boom');
  });
});

describe('patchRender', () => {
  it('is conditional on render.renderId and always stamps render.updatedAt', async () => {
    mockUpdate.mockResolvedValueOnce({});
    await repo.patchRender('abc', 'r1', { status: 'encoding', progress: { done: 1, total: 4 } });
    const a = arg();
    expect(a.conditionExpression).toBe('#render.#renderId = :renderId');
    expect(a.expressionAttributeValues[':renderId']).toBe('r1');
    expect(a.updateExpression).toContain('#render.#status = :v0');
    expect(a.updateExpression).toContain('#render.#progress = :v1');
    expect(a.updateExpression).toContain('#render.#updatedAt = :patchedAt');
    expect(a.expressionAttributeValues[':v0']).toBe('encoding');
    expect(a.expressionAttributeValues[':v1']).toEqual({ done: 1, total: 4 });
  });

  it('never changes the renderId even if the fields carry one', async () => {
    mockUpdate.mockResolvedValueOnce({});
    await repo.patchRender('abc', 'r1', { renderId: 'other', status: 'done' });
    expect(arg().updateExpression).not.toContain('#render.#renderId =');
    expect(Object.values(arg().expressionAttributeValues)).not.toContain('other');
  });

  it('returns quietly when a newer render owns the row', async () => {
    mockUpdate.mockRejectedValueOnce(ccf());
    await expect(repo.patchRender('abc', 'r1', { status: 'done' })).resolves.toBeUndefined();
  });

  it('rethrows other errors', async () => {
    mockUpdate.mockRejectedValueOnce(new Error('boom'));
    await expect(repo.patchRender('abc', 'r1', { status: 'done' })).rejects.toThrow('boom');
  });
});
