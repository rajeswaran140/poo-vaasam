jest.mock('@/infrastructure/database/dynamodb-client', () => {
  const opStub = { get: jest.fn(), put: jest.fn() };
  return {
    DynamoDBOperations: opStub,
    handleDynamoDBError: (err: unknown) => {
      throw err instanceof Error ? err : new Error(String(err));
    },
    TABLE_NAME: 'TamilWebContent',
  };
});

import { TwitchStreamRepository } from '@/infrastructure/database/TwitchStreamRepository';
import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';

const ops = DynamoDBOperations as unknown as { get: jest.Mock; put: jest.Mock };

beforeEach(() => {
  ops.get.mockReset();
  ops.put.mockReset();
});

describe('TwitchStreamRepository', () => {
  const repo = new TwitchStreamRepository();

  it('get() reads at PK=TENANT#…#TWITCH#STREAM / SK=CURRENT', async () => {
    ops.get.mockResolvedValueOnce(undefined);
    await repo.get('tamilagaval');
    expect(ops.get).toHaveBeenCalledWith({
      PK: 'TENANT#tamilagaval#TWITCH#STREAM',
      SK: 'CURRENT',
    });
  });

  it('hydrates a LIVE row', async () => {
    ops.get.mockResolvedValueOnce({
      tenantId: 'tamilagaval',
      isLive: true,
      streamId: 'stream-1',
      broadcasterUserId: '12345',
      broadcasterUserLogin: 'tamilagaval',
      title: 'Live poetry session',
      categoryName: 'Just Chatting',
      categoryId: '509658',
      startedAt: '2026-08-24T12:00:00.000Z',
      updatedAt: '2026-08-24T12:00:01.000Z',
      updatedByMessageId: 'msg-live-1',
    });
    const r = await repo.get('tamilagaval');
    expect(r?.isLive).toBe(true);
    expect(r?.streamId).toBe('stream-1');
    expect(r?.title).toBe('Live poetry session');
  });

  it('hydrates an OFFLINE row and coerces missing bool to false', async () => {
    ops.get.mockResolvedValueOnce({
      tenantId: 'tamilagaval',
      // isLive missing entirely
      updatedAt: '2026-08-24T12:00:00.000Z',
    });
    const r = await repo.get('tamilagaval');
    expect(r?.isLive).toBe(false);
    expect(r?.streamId).toBeNull();
    expect(r?.startedAt).toBeNull();
  });

  it('put() writes with the correct Type marker for filtered scans', async () => {
    await repo.put({
      tenantId: 'tamilagaval',
      isLive: false,
      streamId: null,
      broadcasterUserId: '12345',
      broadcasterUserLogin: 'tamilagaval',
      categoryId: null,
      categoryName: null,
      title: null,
      startedAt: null,
      updatedAt: '2026-08-24T12:00:00.000Z',
      updatedByMessageId: 'msg-offline-1',
    });
    const item = ops.put.mock.calls[0][0];
    expect(item.PK).toBe('TENANT#tamilagaval#TWITCH#STREAM');
    expect(item.SK).toBe('CURRENT');
    expect(item.Type).toBe('TWITCH_STREAM');
  });
});
