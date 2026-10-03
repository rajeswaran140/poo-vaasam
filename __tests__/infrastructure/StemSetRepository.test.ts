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

  it('is a no-op re-POST of the same key: no writes, no duplicate in order', async () => {
    mockGet.mockResolvedValue({
      masterJobId: JOB, order: [ID], stems: { [ID]: { key: KEY, name: 'Kick', previewKey: 's3://preview' } },
      mix: {}, remix: null, createdAt: 't', updatedAt: 't',
    });
    const set = await repo.addStem(JOB, KEY, '2_Drums.wav');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(set.order).toEqual([ID]);
    // The existing name (renamed since the first add) and previewKey survive —
    // a retry must not reset either.
    expect(set.stems[ID]).toMatchObject({ name: 'Kick', previewKey: 's3://preview' });
  });

  it('finishes a half-written add (order has the id, the entry write never landed) without re-appending', async () => {
    mockGet.mockResolvedValue({ masterJobId: JOB, order: [ID], stems: {}, mix: {}, remix: null, createdAt: 't', updatedAt: 't' });
    mockUpdate.mockResolvedValueOnce({
      masterJobId: JOB, order: [ID], stems: { [ID]: { key: KEY, name: 'Drums' } }, mix: {}, createdAt: 't', updatedAt: 't',
    });
    await repo.addStem(JOB, KEY, '2_Drums.wav');
    const calls = mockUpdate.mock.calls.map((c) => c[0]);
    expect(calls.some((c) => /list_append/.test(c.updateExpression))).toBe(false);
    const entry = calls.find((c) => /#stems\.#sid = :stem/.test(c.updateExpression))!;
    expect(entry.expressionAttributeNames['#sid']).toBe(ID);
    expect(entry.expressionAttributeValues[':stem']).toMatchObject({ key: KEY, name: 'Drums' });
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

  it('uses a conditional write with the order that was read to prevent race conditions', async () => {
    const prevOrder = ['a', ID, 'c'];
    mockGet.mockResolvedValue({ masterJobId: JOB, order: prevOrder, stems: { a: { key: 'k' }, [ID]: { key: KEY }, c: { key: 'k2' } }, mix: {} });
    await repo.removeStem(JOB, ID);
    const call = mockUpdate.mock.calls[0][0];
    expect(call.conditionExpression).toBe('#order = :prev');
    expect(call.expressionAttributeValues[':prev']).toEqual(prevOrder);
    expect(call.expressionAttributeValues[':order']).toEqual(['a', 'c']);
  });

  it('retries when a concurrent addStem lands and keeps the newly added id', async () => {
    const prevOrder = ['a', ID];
    const newOrder = ['a', ID, 'newid'];
    let getCall = 0;
    mockGet.mockImplementation(() => {
      getCall++;
      if (getCall === 1) return Promise.resolve({ order: prevOrder, stems: { a: { key: 'k' }, [ID]: { key: KEY } }, mix: {} });
      return Promise.resolve({ order: newOrder, stems: { a: { key: 'k' }, [ID]: { key: KEY }, newid: { key: 'k3' } }, mix: {} });
    });
    const error = new Error('The conditional request failed');
    (error as Record<string, string>).name = 'ConditionalCheckFailedException';
    mockUpdate.mockRejectedValueOnce(error);
    mockUpdate.mockResolvedValueOnce({});
    await repo.removeStem(JOB, ID);
    const calls = mockUpdate.mock.calls.map((c) => c[0]);
    expect(calls[1].expressionAttributeValues[':prev']).toEqual(newOrder);
    expect(calls[1].expressionAttributeValues[':order']).toEqual(['a', 'newid']);
  });

  it('rethrows after 3 conditional failures', async () => {
    mockGet.mockResolvedValue({ order: ['a', ID], stems: { a: { key: 'k' }, [ID]: { key: KEY } }, mix: {} });
    const error = new Error('The conditional request failed');
    (error as Record<string, string>).name = 'ConditionalCheckFailedException';
    mockUpdate.mockRejectedValue(error);
    try {
      await repo.removeStem(JOB, ID);
      throw new Error('Expected removeStem to throw');
    } catch (e) {
      expect((e as Record<string, string>).name).toBe('ConditionalCheckFailedException');
    }
    expect(mockUpdate.mock.calls).toHaveLength(3);
  });
});
