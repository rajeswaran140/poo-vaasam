/** @jest-environment node */
/** Visual story repository — video job rows (GENJOB#). */

const mockQuery = jest.fn();
const mockPut = jest.fn(async (..._a: any[]) => undefined);
const mockGet = jest.fn();
const mockUpdate = jest.fn(async (_p: any): Promise<any> => undefined);

jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: {
    put: (...a: any[]) => mockPut(...a),
    get: (k: any) => mockGet(k),
    query: (p: any) => mockQuery(p),
    update: (p: any) => mockUpdate(p),
    transactWrite: jest.fn(),
    delete: jest.fn(),
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
} from '@/infrastructure/database/VisualStoryRepository';
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
  it('terminal transition sends the status condition and REMOVEs the index keys', async () => {
    mockUpdate.mockResolvedValueOnce({ PK: 'p', SK: 's', ...job({ status: 'succeeded' }) });
    const out = await repo.transitionGenJob(VS, JOB, ['running'], 'succeeded', { providerTaskId: 't1' });
    const p = mockUpdate.mock.calls[0][0];
    expect(p.key).toEqual({ PK: vsPk(VS), SK: genJobSk(JOB) });
    expect(p.conditionExpression).toBe('attribute_exists(PK) AND #s IN (:from0)');
    expect(p.updateExpression).toMatch(/^SET .*#providerTaskId = :providerTaskId/);
    expect(p.updateExpression).toMatch(/ REMOVE GSI1PK, GSI1SK$/);
    expect(p.expressionAttributeValues).toMatchObject({ ':to': 'succeeded', ':from0': 'running' });
    expect(out?.status).toBe('succeeded');
  });

  it.each(['failed', 'cancelled'] as const)('removes the index on %s', async (to) => {
    await repo.transitionGenJob(VS, JOB, ['submitted', 'running'], to);
    const p = mockUpdate.mock.calls[0][0];
    expect(p.updateExpression).toContain('REMOVE GSI1PK, GSI1SK');
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
