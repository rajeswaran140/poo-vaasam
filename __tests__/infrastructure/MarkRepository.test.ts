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
