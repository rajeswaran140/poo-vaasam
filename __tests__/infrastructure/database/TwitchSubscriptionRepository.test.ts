jest.mock('@/infrastructure/database/dynamodb-client', () => {
  const opStub = { get: jest.fn(), put: jest.fn(), update: jest.fn(), delete: jest.fn(), scanAll: jest.fn() };
  return {
    DynamoDBOperations: opStub,
    handleDynamoDBError: (err: unknown) => {
      throw err instanceof Error ? err : new Error(String(err));
    },
    TABLE_NAME: 'TamilWebContent',
  };
});

import { TwitchSubscriptionRepository } from '@/infrastructure/database/TwitchSubscriptionRepository';
import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';

const ops = DynamoDBOperations as unknown as {
  get: jest.Mock;
  put: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  scanAll: jest.Mock;
};

beforeEach(() => {
  ops.get.mockReset();
  ops.put.mockReset();
  ops.update.mockReset();
  ops.delete.mockReset();
  ops.scanAll.mockReset();
});

describe('TwitchSubscriptionRepository', () => {
  const repo = new TwitchSubscriptionRepository();

  it('key composition puts type into PK so re-creating overwrites', async () => {
    ops.get.mockResolvedValueOnce(undefined);
    await repo.get('tamilagaval', 'stream.online');
    expect(ops.get).toHaveBeenCalledWith({
      PK: 'TENANT#tamilagaval#TWITCH#SUBSCRIPTION#stream.online',
      SK: 'METADATA',
    });
  });

  it('coerces an unknown status to pending (fail-safe)', async () => {
    ops.get.mockResolvedValueOnce({
      tenantId: 'tamilagaval',
      type: 'stream.online',
      status: 'wat',
      twitchSubscriptionId: 'sub-1',
      broadcasterUserId: '12345',
      createdAt: '2026-08-24T12:00:00.000Z',
      updatedAt: '2026-08-24T12:00:00.000Z',
    });
    const r = await repo.get('tamilagaval', 'stream.online');
    expect(r?.status).toBe('pending');
  });

  it('setStatus requires the row to exist and updates status + reason + updatedAt', async () => {
    ops.update.mockResolvedValueOnce({});
    await repo.setStatus('tamilagaval', 'stream.online', 'revoked', 'user_disabled', '2026-08-24T12:00:01.000Z');
    const args = ops.update.mock.calls[0][0];
    expect(args.conditionExpression).toContain('attribute_exists');
    expect(args.expressionAttributeValues[':s']).toBe('revoked');
    expect(args.expressionAttributeValues[':r']).toBe('user_disabled');
    expect(args.expressionAttributeValues[':u']).toBe('2026-08-24T12:00:01.000Z');
    expect(args.expressionAttributeNames['#s']).toBe('status');
    expect(args.expressionAttributeNames['#r']).toBe('reason');
  });

  it('listAll scans with the Type filter and prefix', async () => {
    ops.scanAll.mockResolvedValueOnce({
      Items: [
        {
          tenantId: 'tamilagaval',
          type: 'stream.online',
          status: 'enabled',
          twitchSubscriptionId: 'sub-1',
          broadcasterUserId: '12345',
          createdAt: '2026-08-24T12:00:00.000Z',
          updatedAt: '2026-08-24T12:00:00.000Z',
        },
      ],
      truncated: false,
    });
    const rows = await repo.listAll('tamilagaval');
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('stream.online');
    const args = ops.scanAll.mock.calls[0][0];
    expect(args.expressionAttributeValues[':t']).toBe('TWITCH_SUBSCRIPTION');
    expect(args.expressionAttributeValues[':prefix']).toBe(
      'TENANT#tamilagaval#TWITCH#SUBSCRIPTION#'
    );
  });

  it('put writes with the correct PK/SK/Type', async () => {
    await repo.put({
      tenantId: 'tamilagaval',
      type: 'stream.offline',
      twitchSubscriptionId: 'sub-2',
      broadcasterUserId: '12345',
      status: 'enabled',
      createdAt: '2026-08-24T12:00:00.000Z',
      updatedAt: '2026-08-24T12:00:00.000Z',
      reason: null,
    });
    const item = ops.put.mock.calls[0][0];
    expect(item.PK).toBe('TENANT#tamilagaval#TWITCH#SUBSCRIPTION#stream.offline');
    expect(item.SK).toBe('METADATA');
    expect(item.Type).toBe('TWITCH_SUBSCRIPTION');
  });
});
