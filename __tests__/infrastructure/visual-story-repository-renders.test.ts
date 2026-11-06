/** @jest-environment node */
/** Visual story repository — renders (RENDER#, Phase 6). */

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

import { VisualStoryRepository, NotFoundError, vsPk, renderSk } from '@/infrastructure/database/VisualStoryRepository';
import { isRenderId, newId, type RenderJob } from '@/types/visualStory';

const repo = new VisualStoryRepository();
const VS = 'vs_1730000000000_abcdef12';
const RD = 'rd_1793000000000_abc123';
const render = (extra: Partial<RenderJob> = {}): RenderJob => ({
  renderId: RD, status: 'queued', aspectRatio: '16:9', windowStartSec: 0, windowEndSec: 12,
  shots: [{ sceneOrder: 1, shotOrder: 1, key: `audio/mastering/visual-story/${VS}/candidates/cd_1.mp4`, durationSec: 12 }],
  estimateSec: 20, createdAt: '2026-11-06T00:00:00.000Z', updatedAt: '2026-11-06T00:00:00.000Z', ...extra,
});
const condFail = () => Object.assign(new Error('c'), { name: 'ConditionalCheckFailedException' });

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdate.mockResolvedValue(undefined);
});

it('mints and recognises render ids', () => {
  expect(isRenderId(newId('rd'))).toBe(true);
  expect(isRenderId('gj_1793000000000_abc123')).toBe(false);
});

it('creates a render in the story partition, only while the story exists', async () => {
  await repo.createRender(VS, render());
  const [check, put] = mockTransact.mock.calls[0][0];
  // An Update, not a ConditionCheck: the site's IAM user lacks dynamodb:ConditionCheckItem.
  expect(check.Update).toMatchObject({ Key: { PK: vsPk(VS), SK: 'METADATA' }, ConditionExpression: 'attribute_exists(PK)' });
  expect(check).not.toHaveProperty('ConditionCheck');
  expect(put.Put.Item).toMatchObject({ PK: vsPk(VS), SK: renderSk(RD), status: 'queued' });
  expect(put.Put.ConditionExpression).toBe('attribute_not_exists(PK)');
});

it('reports a story deleted in the meantime as not found', async () => {
  mockTransact.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'TransactionCanceledException' }));
  await expect(repo.createRender(VS, render())).rejects.toBeInstanceOf(NotFoundError);
});

it('lists only RENDER# rows, across pages', async () => {
  mockQuery
    .mockResolvedValueOnce({ Items: [{ PK: 'p', SK: renderSk(RD), ...render() }], LastEvaluatedKey: { k: 1 } })
    .mockResolvedValueOnce({ Items: [{ PK: 'p', SK: 'RENDER#rd_2', ...render({ renderId: 'rd_2' }) }] });
  const out = await repo.listRenders(VS);
  expect(out.map((r) => r.renderId)).toEqual([RD, 'rd_2']);
  expect(mockQuery.mock.calls[0][0].expressionAttributeValues[':sk']).toBe('RENDER#');
  expect(out[0]).not.toHaveProperty('PK');
});

describe('transitionRender', () => {
  it('moves only from the allowed statuses, on a row that still exists', async () => {
    mockUpdate.mockResolvedValueOnce({ PK: 'p', SK: 's', ...render({ status: 'failed', error: 'x' }) });
    const out = await repo.transitionRender(VS, RD, ['queued', 'running'], 'failed', { error: 'x' });
    const p = mockUpdate.mock.calls[0][0];
    expect(p.key).toEqual({ PK: vsPk(VS), SK: renderSk(RD) });
    expect(p.conditionExpression).toBe('attribute_exists(PK) AND #s IN (:from0, :from1)');
    expect(p.expressionAttributeValues).toMatchObject({ ':to': 'failed', ':from0': 'queued', ':from1': 'running', ':error': 'x' });
    expect(out?.status).toBe('failed');
  });

  it('returns null when someone else already moved it, or the story is gone', async () => {
    mockUpdate.mockRejectedValueOnce(condFail());
    expect(await repo.transitionRender(VS, RD, ['queued'], 'failed')).toBeNull();
  });
});

it('loadProgressParts reads only SHOT#, CAND# and RENDER# rows', async () => {
  mockQuery.mockImplementation(async (p: { expressionAttributeValues: Record<string, string> }) => ({
    Items: [{ PK: 'p', SK: `${p.expressionAttributeValues[':sk']}x`, durationSec: 1 }],
  }));
  const parts = await repo.loadProgressParts(VS);
  const prefixes = mockQuery.mock.calls.map((c) => c[0].expressionAttributeValues[':sk']).sort();
  expect(prefixes).toEqual(['CAND#', 'RENDER#', 'SHOT#']);
  for (const c of mockQuery.mock.calls) expect(c[0].keyConditionExpression).toBe('PK = :pk AND begins_with(SK, :sk)');
  expect(parts.shots).toHaveLength(1);
  expect(parts.shots[0]).not.toHaveProperty('PK');
});
