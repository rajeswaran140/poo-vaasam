import type { TwitchEventRecord } from '@/types/twitch-eventsub';

// Mock DDB operations so putIfAbsent's conditional-put behavior is under
// our control — that's the actual dedupe primitive worth testing.
jest.mock('@/infrastructure/database/dynamodb-client', () => {
  const opStub = {
    get: jest.fn(),
    put: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    transactWrite: jest.fn(),
  };
  return {
    DynamoDBOperations: opStub,
    handleDynamoDBError: (err: unknown) => {
      throw err instanceof Error ? err : new Error(String(err));
    },
    TABLE_NAME: 'TamilWebContent',
  };
});

import { TwitchEventRepository } from '@/infrastructure/database/TwitchEventRepository';
import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';

const ops = DynamoDBOperations as unknown as {
  get: jest.Mock;
  update: jest.Mock;
  transactWrite: jest.Mock;
};

const sample: TwitchEventRecord = {
  tenantId: 'tamilagaval',
  messageId: 'msg-1',
  messageTimestamp: '2026-08-24T12:00:00.000Z',
  messageType: 'notification',
  subscriptionType: 'stream.online',
  subscriptionId: 'sub-1',
  payload: { subscription: { type: 'stream.online' }, event: { id: 'stream-1' } },
  receivedAt: '2026-08-24T12:00:00.000Z',
  processedAt: null,
  processingError: null,
};

beforeEach(() => {
  ops.get.mockReset();
  ops.update.mockReset();
  ops.transactWrite.mockReset();
});

describe('TwitchEventRepository.putIfAbsent', () => {
  const repo = new TwitchEventRepository();

  it('returns true on first-time write (no existing item)', async () => {
    ops.transactWrite.mockResolvedValueOnce({});
    await expect(repo.putIfAbsent(sample)).resolves.toBe(true);
    // The item goes into the transact with the correct PK/SK + ttl.
    const args = ops.transactWrite.mock.calls[0][0];
    const put = args[0].Put;
    expect(put.Item.PK).toBe('TENANT#tamilagaval#TWITCH#EVENT#msg-1');
    expect(put.Item.SK).toBe('METADATA');
    expect(put.Item.Type).toBe('TWITCH_EVENT');
    expect(typeof put.Item.ttl).toBe('number');
    expect(put.ConditionExpression).toContain('attribute_not_exists');
  });

  it('returns false on duplicate (Twitch retry)', async () => {
    const err = new Error('The conditional request failed');
    err.name = 'TransactionCanceledException';
    ops.transactWrite.mockRejectedValueOnce(err);
    await expect(repo.putIfAbsent(sample)).resolves.toBe(false);
  });

  it('returns false on the older ConditionalCheckFailedException shape too', async () => {
    const err = new Error('conditional check failed');
    err.name = 'ConditionalCheckFailedException';
    ops.transactWrite.mockRejectedValueOnce(err);
    await expect(repo.putIfAbsent(sample)).resolves.toBe(false);
  });

  it('propagates non-condition errors (e.g. throughput exceeded)', async () => {
    const err = new Error('throughput exceeded');
    err.name = 'ProvisionedThroughputExceededException';
    ops.transactWrite.mockRejectedValueOnce(err);
    await expect(repo.putIfAbsent(sample)).rejects.toThrow(/throughput/);
  });
});

describe('TwitchEventRepository.markProcessed', () => {
  const repo = new TwitchEventRepository();

  it('updates processedAt + null processingError on success', async () => {
    ops.update.mockResolvedValueOnce({});
    await repo.markProcessed('tamilagaval', 'msg-1', '2026-08-24T12:00:01.000Z');
    const args = ops.update.mock.calls[0][0];
    expect(args.key).toEqual({
      PK: 'TENANT#tamilagaval#TWITCH#EVENT#msg-1',
      SK: 'METADATA',
    });
    expect(args.expressionAttributeValues[':p']).toBe('2026-08-24T12:00:01.000Z');
    expect(args.expressionAttributeValues[':e']).toBeNull();
    expect(args.conditionExpression).toContain('attribute_exists');
  });

  it('carries the error string when processing failed', async () => {
    ops.update.mockResolvedValueOnce({});
    await repo.markProcessed('tamilagaval', 'msg-1', '2026-08-24T12:00:01.000Z', 'boom');
    expect(ops.update.mock.calls[0][0].expressionAttributeValues[':e']).toBe('boom');
  });
});

describe('TwitchEventRepository.get / hydrate', () => {
  const repo = new TwitchEventRepository();

  it('returns null when the row is missing', async () => {
    ops.get.mockResolvedValueOnce(undefined);
    await expect(repo.get('tamilagaval', 'nope')).resolves.toBeNull();
  });

  it('hydrates a well-formed row', async () => {
    ops.get.mockResolvedValueOnce({
      tenantId: 'tamilagaval',
      messageId: 'msg-1',
      messageTimestamp: '2026-08-24T12:00:00.000Z',
      messageType: 'notification',
      subscriptionType: 'stream.online',
      subscriptionId: 'sub-1',
      payload: { event: { id: 'stream-1' } },
      receivedAt: '2026-08-24T12:00:00.000Z',
      processedAt: '2026-08-24T12:00:01.000Z',
      processingError: null,
    });
    const r = await repo.get('tamilagaval', 'msg-1');
    expect(r?.subscriptionType).toBe('stream.online');
    expect(r?.processedAt).toBe('2026-08-24T12:00:01.000Z');
    expect(r?.payload).toEqual({ event: { id: 'stream-1' } });
  });

  it('degrades an older/partial row (no payload → {})', async () => {
    ops.get.mockResolvedValueOnce({
      tenantId: 'tamilagaval',
      messageId: 'msg-1',
      // payload missing entirely
    });
    const r = await repo.get('tamilagaval', 'msg-1');
    expect(r?.payload).toEqual({});
    expect(r?.processedAt).toBeNull();
  });
});
