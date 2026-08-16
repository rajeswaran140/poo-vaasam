/** @jest-environment node */
/**
 * Saved-master listing: the sparse index and cursor paging.
 *
 * The regression these guard against is invisible in the UI — a return to
 * scanning would look identical on screen and simply cost more every time the
 * table grows. So the tests assert the QUERY SHAPE, not just the rows.
 */

const mockQuery = jest.fn();
const mockScanAll = jest.fn();
const mockUpdate = jest.fn();
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: {
    query: (...a: unknown[]) => mockQuery(...a),
    scanAll: (...a: unknown[]) => mockScanAll(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
    put: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
  },
  handleDynamoDBError: (e: unknown) => { throw e; },
}));

import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';

const repo = new MasterJobRepository();
const row = (id: string, savedAt: string) => ({
  id, status: 'done', createdAt: savedAt, s3Key: `in/${id}.wav`, masterKey: `out/${id}.wav`,
  savedAt, title: id, PK: `MASTERJOB#${id}`, SK: 'METADATA',
});

beforeEach(() => jest.clearAllMocks());

describe('listSavedPage queries the index — it does not scan', () => {
  it('never calls scanAll', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [] });
    await repo.listSavedPage();
    expect(mockScanAll).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('queries the sparse saved partition on GSI1, newest first', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [] });
    await repo.listSavedPage(25);
    const args = mockQuery.mock.calls[0][0];
    expect(args.indexName).toBe('GSI1');
    expect(args.keyConditionExpression).toBe('GSI1PK = :pk');
    expect(args.expressionAttributeValues[':pk']).toBe('MASTERJOB_SAVED');
    expect(args.scanIndexForward).toBe(false); // newest first, from the index
    expect(args.limit).toBe(25);
  });

  /**
   * ⚠️ The partition holds ONLY saved masters, so no filter is needed. A
   * filterExpression here would mean unsaved jobs had leaked into the index.
   */
  it('needs no filter, because unsaved jobs never enter the index', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [] });
    await repo.listSavedPage();
    expect(mockQuery.mock.calls[0][0].filterExpression).toBeUndefined();
  });

  it('returns the rows it was given, in index order', async () => {
    mockQuery.mockResolvedValueOnce({
      Items: [row('new', '2026-08-16T00:00:00Z'), row('old', '2026-08-01T00:00:00Z')],
    });
    expect((await repo.listSavedPage()).masters.map((m) => m.id)).toEqual(['new', 'old']);
  });
});

describe('cursor paging', () => {
  it('reports no next page when DynamoDB returns no LastEvaluatedKey', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [row('a', '2026-08-16T00:00:00Z')] });
    expect((await repo.listSavedPage()).nextCursor).toBeNull();
  });

  it('round-trips the LastEvaluatedKey through an opaque cursor', async () => {
    const lek = { GSI1PK: 'MASTERJOB_SAVED', GSI1SK: '2026-08-01#x', PK: 'MASTERJOB#x', SK: 'METADATA' };
    mockQuery.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: lek });
    const { nextCursor } = await repo.listSavedPage();
    expect(nextCursor).toBeTruthy();

    mockQuery.mockResolvedValueOnce({ Items: [] });
    await repo.listSavedPage(25, nextCursor!);
    expect(mockQuery.mock.calls[1][0].exclusiveStartKey).toEqual(lek);
  });

  it('starts at page one when no cursor is given', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [] });
    await repo.listSavedPage();
    expect(mockQuery.mock.calls[0][0].exclusiveStartKey).toBeUndefined();
  });

  /** A stale bookmark should show the library, not a 500. */
  it('treats a malformed cursor as "start from the beginning"', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [] });
    await repo.listSavedPage(25, 'not-base64-json!!');
    expect(mockQuery.mock.calls[0][0].exclusiveStartKey).toBeUndefined();
  });
});

describe('listSaved pages through rather than scanning', () => {
  it('follows the cursor until the index is exhausted', async () => {
    mockQuery
      .mockResolvedValueOnce({ Items: [row('a', '2026-08-16T00:00:00Z')], LastEvaluatedKey: { k: 1 } })
      .mockResolvedValueOnce({ Items: [row('b', '2026-08-15T00:00:00Z')] });
    const all = await repo.listSaved(100);
    expect(all.map((m) => m.id)).toEqual(['a', 'b']);
    expect(mockScanAll).not.toHaveBeenCalled();
  });

  it('stops at the requested limit instead of draining the index', async () => {
    mockQuery.mockResolvedValue({
      Items: [row('a', '2026-08-16T00:00:00Z'), row('b', '2026-08-15T00:00:00Z')],
      LastEvaluatedKey: { k: 1 },
    });
    expect(await repo.listSaved(2)).toHaveLength(2);
  });
});

describe('save writes the index keys', () => {
  it('sets GSI1PK/GSI1SK so the master appears in the library index', async () => {
    mockUpdate.mockResolvedValueOnce({});
    await repo.save('job1', 'A title');
    const args = mockUpdate.mock.calls[0][0];
    expect(args.updateExpression).toContain('GSI1PK = :gpk');
    expect(args.updateExpression).toContain('GSI1SK = :gsk');
    expect(args.expressionAttributeValues[':gpk']).toBe('MASTERJOB_SAVED');
    expect(args.expressionAttributeValues[':gsk']).toBe(
      `${args.expressionAttributeValues[':savedAt']}#job1`
    );
  });

  /** The ttl removal is what makes a save permanent — it must survive. */
  it('still removes the ttl', async () => {
    mockUpdate.mockResolvedValueOnce({});
    await repo.save('job1', 'A title');
    expect(mockUpdate.mock.calls[0][0].updateExpression).toContain('REMOVE #ttl');
  });

  it('stamps the sort key with the same savedAt it stores', async () => {
    mockUpdate.mockResolvedValueOnce({});
    await repo.save('job1', null);
    const v = mockUpdate.mock.calls[0][0].expressionAttributeValues;
    expect(v[':gsk'].startsWith(v[':savedAt'])).toBe(true);
  });
});
