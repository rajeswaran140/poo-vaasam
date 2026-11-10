/** @jest-environment node */
/** Visual story repository — video job rows (GENJOB#). */

const mockQuery = jest.fn();
const mockPut = jest.fn(async (..._a: any[]) => undefined);
const mockGet = jest.fn();
const mockUpdate = jest.fn(async (_p: any): Promise<any> => undefined);
const mockDelete = jest.fn(async (..._a: any[]): Promise<any> => undefined);
const mockTransact = jest.fn(async (_i: any[]): Promise<any> => undefined);

jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: {
    put: (...a: any[]) => mockPut(...a),
    get: (k: any) => mockGet(k),
    query: (p: any) => mockQuery(p),
    update: (p: any) => mockUpdate(p),
    transactWrite: (i: any[]) => mockTransact(i),
    delete: (...a: any[]) => mockDelete(...a),
  },
  handleDynamoDBError: (e: any) => {
    const w: any = new Error(e?.message || 'Unknown DynamoDB error');
    w.name = 'DynamoDBError';
    w.statusCode = 500;
    throw w;
  },
}));

import {
  VisualStoryRepository,
  VisualStoryDomainError,
  vsPk,
  genJobSk,
  videoLockSk,
} from '@/infrastructure/database/VisualStoryRepository';
import { VIDEO_STALE_MS } from '@/services/video/gen-job';
import { candIdForJob, isGenJobId, type GenJob } from '@/types/visualStory';

const repo = new VisualStoryRepository();
const VS = 'vs_1730000000000_abcdef12';
const JOB = 'gj_1793000000000_abc123';

const job = (extra: Partial<GenJob> = {}): GenJob => ({
  jobId: JOB, sceneOrder: 1, shotOrder: 2, status: 'submitted', providerId: 'grok',
  providerTaskId: null, reservedUsd: 0.4, candId: candIdForJob(JOB), attempts: 0,
  copyFailures: 0, lastPolledAt: null, createdAt: '2026-11-05T00:00:00.000Z',
  updatedAt: '2026-11-05T00:00:00.000Z', ...extra,
});
const condFail = () => Object.assign(new Error('c'), { name: 'ConditionalCheckFailedException' });

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdate.mockResolvedValue(undefined);
});

describe('ids', () => {
  it('derives the candidate id deterministically', () => {
    expect(candIdForJob('gj_1793000000000_abc123')).toBe('cd_1793000000000_abc123');
  });
  it('validates gj_ ids', () => {
    expect(isGenJobId(JOB)).toBe(true);
    expect(isGenJobId('dj_1793000000000_abc123')).toBe(false);
    expect(isGenJobId('gj_1_x')).toBe(false);
  });
  it('builds the sort key', () => {
    expect(genJobSk(JOB)).toBe(`GENJOB#${JOB}`);
  });
});

describe('createGenJob', () => {
  it('writes the sparse index attributes with an attribute_not_exists guard', async () => {
    await repo.createGenJob(VS, job());
    const [item, opts] = mockPut.mock.calls[0];
    expect(item).toMatchObject({
      PK: vsPk(VS), SK: genJobSk(JOB), jobId: JOB,
      GSI1PK: 'VSTORY_INFLIGHT', GSI1SK: `2026-11-05T00:00:00.000Z#${VS}#${JOB}`,
    });
    expect(opts.conditionExpression).toBe('attribute_not_exists(PK)');
  });

  it('refuses a duplicate id', async () => {
    mockPut.mockRejectedValueOnce(condFail());
    await expect(repo.createGenJob(VS, job())).rejects.toBeInstanceOf(VisualStoryDomainError);
  });

  it('wraps other storage errors', async () => {
    mockPut.mockRejectedValueOnce(new Error('boom'));
    await expect(repo.createGenJob(VS, job())).rejects.toMatchObject({ name: 'DynamoDBError' });
  });
});

describe('getGenJob', () => {
  it('strips keys', async () => {
    mockGet.mockResolvedValueOnce({ PK: 'x', SK: 'y', GSI1PK: 'VSTORY_INFLIGHT', GSI1SK: 'z', ...job() });
    expect(await repo.getGenJob(VS, JOB)).toEqual(job());
    expect(mockGet).toHaveBeenCalledWith({ PK: vsPk(VS), SK: genJobSk(JOB) });
  });
  it('returns null when absent', async () => {
    mockGet.mockResolvedValueOnce(undefined);
    expect(await repo.getGenJob(VS, JOB)).toBeNull();
  });
});

describe('transitionGenJob', () => {
  it('terminal transition sends the status condition and KEEPS the index keys (settle drops them)', async () => {
    mockUpdate.mockResolvedValueOnce({ PK: 'p', SK: 's', ...job({ status: 'succeeded' }) });
    const out = await repo.transitionGenJob(VS, JOB, ['running'], 'succeeded', { providerTaskId: 't1' });
    const p = mockUpdate.mock.calls[0][0];
    expect(p.key).toEqual({ PK: vsPk(VS), SK: genJobSk(JOB) });
    expect(p.conditionExpression).toBe('attribute_exists(PK) AND #s IN (:from0)');
    expect(p.updateExpression).toMatch(/^SET .*#providerTaskId = :providerTaskId/);
    expect(p.updateExpression).not.toContain('REMOVE');
    expect(p.expressionAttributeValues).toMatchObject({ ':to': 'succeeded', ':from0': 'running' });
    expect(out?.status).toBe('succeeded');
  });

  it.each(['failed', 'cancelled'] as const)('keeps the index on %s (an unsettled job must stay findable)', async (to) => {
    await repo.transitionGenJob(VS, JOB, ['submitted', 'running'], to);
    const p = mockUpdate.mock.calls[0][0];
    expect(p.updateExpression).not.toContain('REMOVE');
    expect(p.conditionExpression).toContain(':from0, :from1');
  });

  it('keeps the index on a non-terminal transition', async () => {
    await repo.transitionGenJob(VS, JOB, ['submitted'], 'running');
    expect(mockUpdate.mock.calls[0][0].updateExpression).not.toContain('REMOVE');
  });

  it('returns null when the condition fails', async () => {
    mockUpdate.mockRejectedValueOnce(condFail());
    expect(await repo.transitionGenJob(VS, JOB, ['running'], 'failed')).toBeNull();
  });
});

describe('transitionGenJob — billedUsd intent (Ruling V10)', () => {
  it('stores billedUsd with the terminal transition', async () => {
    await repo.transitionGenJob(VS, JOB, ['running'], 'failed', { code: 'upstream', error: 'e', billedUsd: 0.4 });
    const p = mockUpdate.mock.calls[0][0];
    expect(p.updateExpression).toMatch(/#billedUsd = :billedUsd/);
    expect(p.expressionAttributeNames['#billedUsd']).toBe('billedUsd');
    expect(p.expressionAttributeValues[':billedUsd']).toBe(0.4);
  });
});

describe('settleGenJob (Ruling V10)', () => {
  const cancelled = (codes: string[]) =>
    Object.assign(new Error('Transaction cancelled'), {
      name: 'TransactionCanceledException',
      CancellationReasons: codes.map((Code) => ({ Code })),
    });

  it('one transaction: marks the job settled (once) and moves the story money, rounded to 6 decimals', async () => {
    expect(await repo.settleGenJob(VS, JOB, { reservedUsd: 0.4, billedUsd: 0.4 })).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockTransact).toHaveBeenCalledTimes(1);
    const [jobOp, metaOp] = mockTransact.mock.calls[0][0];
    expect(jobOp.Update.Key).toEqual({ PK: vsPk(VS), SK: genJobSk(JOB) });
    expect(jobOp.Update.UpdateExpression).toBe('SET settledAt = :now, billedUsd = :b REMOVE GSI1PK, GSI1SK');
    expect(jobOp.Update.ConditionExpression).toBe('attribute_exists(PK) AND attribute_not_exists(settledAt)');
    expect(jobOp.Update.ExpressionAttributeValues).toEqual({ ':now': expect.any(String), ':b': 0.4 });
    expect(metaOp.Update.Key).toEqual({ PK: vsPk(VS), SK: 'METADATA' });
    expect(metaOp.Update.UpdateExpression).toBe('ADD reservedUsd :negR, spentUsd :b, committedUsd :delta');
    expect(metaOp.Update.ConditionExpression).toBe('attribute_exists(PK)');
    expect(metaOp.Update.ExpressionAttributeValues).toEqual({ ':negR': -0.4, ':b': 0.4, ':delta': 0 });
  });

  it('unbilled: releases the reservation, spends nothing', async () => {
    await repo.settleGenJob(VS, JOB, { reservedUsd: 0.1 + 0.2, billedUsd: 0 });
    const [jobOp, metaOp] = mockTransact.mock.calls[0][0];
    expect(jobOp.Update.ExpressionAttributeValues[':b']).toBe(0);
    expect(metaOp.Update.ExpressionAttributeValues).toEqual({ ':negR': -0.3, ':b': 0, ':delta': -0.3 });
  });

  it('cancelled by the settledAt condition ⇒ false (already settled: no double count)', async () => {
    mockTransact.mockRejectedValueOnce(cancelled(['ConditionalCheckFailed', 'None']));
    expect(await repo.settleGenJob(VS, JOB, { reservedUsd: 0.4, billedUsd: 0.4 })).toBe(false);
  });

  it('story missing ⇒ logged, false, and the orphan job is stamped and dropped from the index', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockTransact.mockRejectedValueOnce(cancelled(['None', 'ConditionalCheckFailed']));
    expect(await repo.settleGenJob(VS, JOB, { reservedUsd: 0.4, billedUsd: 0.4 })).toBe(false);
    expect(log).toHaveBeenCalled();
    const p = mockUpdate.mock.calls[0][0];
    expect(p.key).toEqual({ PK: vsPk(VS), SK: genJobSk(JOB) });
    expect(p.updateExpression).toBe('SET settledAt = :now REMOVE GSI1PK, GSI1SK');
    expect(p.conditionExpression).toBe('attribute_exists(PK) AND attribute_not_exists(settledAt)');
    log.mockRestore();
  });

  it('story missing and the orphan drop fails ⇒ still false, never thrown', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockTransact.mockRejectedValueOnce(cancelled(['None', 'ConditionalCheckFailed']));
    mockUpdate.mockRejectedValueOnce(new Error('ddb down'));
    expect(await repo.settleGenJob(VS, JOB, { reservedUsd: 0.4, billedUsd: 0.4 })).toBe(false);
    log.mockRestore();
  });

  it.each([
    ['TransactionConflict', 'None'],
    ['None', 'TransactionConflict'],
    ['None', 'ThrottlingError'],
  ])('a write conflict or throttle (%s, %s) is retried, then settles', async (a, b) => {
    mockTransact.mockRejectedValueOnce(cancelled([a, b]));
    expect(await repo.settleGenJob(VS, JOB, { reservedUsd: 0.4, billedUsd: 0.4 })).toBe(true);
    expect(mockTransact).toHaveBeenCalledTimes(2);
  });

  it('a conflict that lands after the first try committed reads as already settled (no double count)', async () => {
    mockTransact
      .mockRejectedValueOnce(cancelled(['TransactionConflict', 'None']))
      .mockRejectedValueOnce(cancelled(['ConditionalCheckFailed', 'None']));
    expect(await repo.settleGenJob(VS, JOB, { reservedUsd: 0.4, billedUsd: 0.4 })).toBe(false);
  });

  it('a conflict on every try is thrown after 3 attempts, never taken as settled', async () => {
    mockTransact.mockRejectedValue(cancelled(['TransactionConflict', 'None']));
    await expect(repo.settleGenJob(VS, JOB, { reservedUsd: 0.4, billedUsd: 0.4 })).rejects.toMatchObject({
      name: 'DynamoDBError',
    });
    expect(mockTransact).toHaveBeenCalledTimes(3);
    mockTransact.mockReset();
    mockTransact.mockResolvedValue(undefined);
  });

  it('any other cancellation is thrown at once, never retried or taken as settled', async () => {
    mockTransact.mockRejectedValueOnce(cancelled(['ValidationError', 'None']));
    await expect(repo.settleGenJob(VS, JOB, { reservedUsd: 0.4, billedUsd: 0.4 })).rejects.toMatchObject({
      name: 'DynamoDBError',
    });
    expect(mockTransact).toHaveBeenCalledTimes(1);
  });

  it('other storage errors are wrapped', async () => {
    mockTransact.mockRejectedValueOnce(new Error('ddb down'));
    await expect(repo.settleGenJob(VS, JOB, { reservedUsd: 0.4, billedUsd: 0 })).rejects.toMatchObject({
      name: 'DynamoDBError',
    });
  });
});

describe('touchGenJob', () => {
  it('increments attempts and stamps lastPolledAt', async () => {
    await repo.touchGenJob(VS, JOB);
    const p = mockUpdate.mock.calls[0][0];
    expect(p.updateExpression).toBe('SET lastPolledAt = :now ADD attempts :one');
    expect(p.expressionAttributeValues[':one']).toBe(1);
    expect(p.updateExpression).not.toContain('copyFailures');
    expect(p.conditionExpression).toBe('attribute_exists(PK)');
  });
  it('also increments copyFailures when asked', async () => {
    await repo.touchGenJob(VS, JOB, { copyFailed: true });
    expect(mockUpdate.mock.calls[0][0].updateExpression).toBe(
      'SET lastPolledAt = :now ADD attempts :one, copyFailures :one'
    );
  });
});

describe('listInflight', () => {
  it('follows LastEvaluatedKey and derives vsId from the partition key', async () => {
    mockQuery
      .mockResolvedValueOnce({ Items: [{ PK: vsPk(VS), SK: genJobSk(JOB), GSI1PK: 'VSTORY_INFLIGHT', ...job() }], LastEvaluatedKey: { k: 1 } })
      .mockResolvedValueOnce({ Items: [{ PK: vsPk('vs_1730000000001_zzzzzz12'), SK: 'GENJOB#gj_1793000000001_def456', ...job({ jobId: 'gj_1793000000001_def456' }) }] });
    const out = await repo.listInflight();
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[0][0]).toMatchObject({ indexName: 'GSI1', expressionAttributeValues: { ':pk': 'VSTORY_INFLIGHT' } });
    expect(mockQuery.mock.calls[1][0].exclusiveStartKey).toEqual({ k: 1 });
    expect(out.map((r) => r.vsId)).toEqual([VS, 'vs_1730000000001_zzzzzz12']);
    expect(out[0].job).toEqual(job());
  });
});

describe('loadTree', () => {
  it('splits GENJOB# rows into genJobs', async () => {
    const PK = vsPk(VS);
    mockQuery.mockResolvedValueOnce({
      Items: [
        { PK, SK: 'METADATA', vsId: VS, masterJobId: 'm', audioKey: 'a', title: 't', status: 'DRAFT', aspectRatio: '16:9', providerId: 'grok', windowStartSec: 0, windowEndSec: 60, budgetUsdCap: 40, createdAt: 't', updatedAt: 't' },
        { PK, SK: genJobSk(JOB), GSI1PK: 'VSTORY_INFLIGHT', GSI1SK: 'x', ...job() },
      ],
    });
    const tree = await repo.loadTree(VS);
    expect(tree?.genJobs).toEqual([job()]);
    expect(tree?.candidates).toEqual([]);
  });
});

describe('per-shot video lock (VIDLOCK#)', () => {
  const NOW = new Date('2026-11-05T12:00:00.000Z');

  it('builds the sort key', () => {
    expect(videoLockSk(1, 2)).toBe('VIDLOCK#001#002');
  });

  it('the stale window is one hour', () => {
    expect(VIDEO_STALE_MS).toBe(60 * 60_000);
  });

  it('claims with a conditional put that also takes over a lock older than 1 h', async () => {
    mockPut.mockResolvedValueOnce(undefined);
    await expect(repo.claimShotVideo(VS, 1, 2, JOB, NOW)).resolves.toBe(true);
    const [item, opts] = mockPut.mock.calls[0];
    expect(item).toEqual({ PK: vsPk(VS), SK: 'VIDLOCK#001#002', jobId: JOB, createdAt: NOW.toISOString() });
    expect(opts.conditionExpression).toBe('attribute_not_exists(PK) OR createdAt < :staleBefore');
    expect(opts.expressionAttributeValues).toEqual({ ':staleBefore': '2026-11-05T11:00:00.000Z' });
  });

  it('a held (fresh) lock ⇒ false', async () => {
    mockPut.mockRejectedValueOnce(condFail());
    await expect(repo.claimShotVideo(VS, 1, 2, JOB, NOW)).resolves.toBe(false);
  });

  it('any other error propagates', async () => {
    mockPut.mockRejectedValueOnce(new Error('ddb down'));
    await expect(repo.claimShotVideo(VS, 1, 2, JOB, NOW)).rejects.toThrow();
  });

  it('release is a delete guarded by the claiming jobId', async () => {
    await expect(repo.releaseShotVideo(VS, 1, 2, JOB)).resolves.toBe(true);
    const [key, opts] = mockDelete.mock.calls[0];
    expect(key).toEqual({ PK: vsPk(VS), SK: 'VIDLOCK#001#002' });
    expect(opts.conditionExpression).toBe('jobId = :j');
    expect(opts.expressionAttributeValues).toEqual({ ':j': JOB });
  });

  it('release of a lock someone else now holds (or that is gone) ⇒ false, swallowed', async () => {
    mockDelete.mockRejectedValueOnce(condFail());
    await expect(repo.releaseShotVideo(VS, 1, 2, JOB)).resolves.toBe(false);
  });

  it('release with another error propagates', async () => {
    mockDelete.mockRejectedValueOnce(new Error('ddb down'));
    await expect(repo.releaseShotVideo(VS, 1, 2, JOB)).rejects.toThrow();
  });

  it('loadTree ignores VIDLOCK rows', async () => {
    mockQuery.mockResolvedValueOnce({
      Items: [
        { PK: vsPk(VS), SK: 'METADATA', vsId: VS, aspectRatio: '9:16', budgetUsdCap: 40, spentUsd: 0, reservedUsd: 0 },
        { PK: vsPk(VS), SK: 'VIDLOCK#001#002', jobId: JOB, createdAt: NOW.toISOString() },
      ],
    });
    const tree = await repo.loadTree(VS);
    expect(tree).not.toBeNull();
    const all = JSON.stringify({ ...tree, story: undefined });
    expect(all).not.toContain('VIDLOCK');
    expect(all).not.toContain(JOB);
  });
});
