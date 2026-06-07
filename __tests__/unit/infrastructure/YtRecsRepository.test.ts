/** @jest-environment node */
/**
 * YtRecsRepository — cache read/write for AI YouTube recommendations.
 */

import { YtRecsRepository } from '@/infrastructure/database/YtRecsRepository';
import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';

jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: { put: jest.fn(), get: jest.fn() },
  handleDynamoDBError: jest.fn((e) => {
    throw e;
  }),
}));

const ops = DynamoDBOperations as unknown as { put: jest.Mock; get: jest.Mock };

beforeEach(() => jest.clearAllMocks());

it('save() writes a YTRECS item keyed by channel', async () => {
  ops.put.mockResolvedValueOnce({});
  await new YtRecsRepository().save('UC123', { recommendations: ['a', 'b'], generatedAt: 't', days: 28 });
  const item = ops.put.mock.calls[0][0];
  expect(item.PK).toBe('YTRECS#UC123');
  expect(item.SK).toBe('METADATA');
  expect(item.recommendations).toEqual(['a', 'b']);
  expect(item.generatedAt).toBe('t');
});

it('get() maps a stored item to CachedYtRecs', async () => {
  ops.get.mockResolvedValueOnce({ recommendations: ['x'], generatedAt: 'tt', days: 28 });
  expect(await new YtRecsRepository().get('UC123')).toEqual({ recommendations: ['x'], generatedAt: 'tt', days: 28 });
});

it('get() returns null when nothing is cached', async () => {
  ops.get.mockResolvedValueOnce(undefined);
  expect(await new YtRecsRepository().get('UC123')).toBeNull();
});

it('get() defends against a non-array recommendations field', async () => {
  ops.get.mockResolvedValueOnce({ recommendations: null, generatedAt: 't' });
  const r = await new YtRecsRepository().get('UC123');
  expect(r?.recommendations).toEqual([]);
});
