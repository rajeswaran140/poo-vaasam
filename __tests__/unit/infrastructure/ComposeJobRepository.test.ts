/** @jest-environment node */
/**
 * ComposeJobRepository — create (processing job + TTL) and get (mapped / null).
 */

import { ComposeJobRepository } from '@/infrastructure/database/ComposeJobRepository';
import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';

jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: { put: jest.fn(), get: jest.fn() },
  handleDynamoDBError: jest.fn((e) => {
    throw e;
  }),
}));

const ops = DynamoDBOperations as unknown as { put: jest.Mock; get: jest.Mock };

beforeEach(() => jest.clearAllMocks());

it('create() writes a processing job with the COMPOSEJOB key and a ttl', async () => {
  ops.put.mockResolvedValueOnce({});
  const job = await new ComposeJobRepository().create('compose_1');

  expect(job).toMatchObject({ id: 'compose_1', status: 'processing', result: null, error: null });
  const item = ops.put.mock.calls[0][0];
  expect(item.PK).toBe('COMPOSEJOB#compose_1');
  expect(item.SK).toBe('METADATA');
  expect(item.status).toBe('processing');
  expect(typeof item.ttl).toBe('number');
  expect(item.ttl).toBeGreaterThan(0);
});

it('get() maps a stored item to a ComposeJob', async () => {
  ops.get.mockResolvedValueOnce({
    id: 'compose_1', status: 'done', createdAt: 'a', updatedAt: 'b',
    result: { emotion: 'காதல்' }, error: null,
  });
  const job = await new ComposeJobRepository().get('compose_1');
  expect(job).toMatchObject({ id: 'compose_1', status: 'done', result: { emotion: 'காதல்' } });
});

it('get() returns null when the job is missing/expired', async () => {
  ops.get.mockResolvedValueOnce(undefined);
  expect(await new ComposeJobRepository().get('gone')).toBeNull();
});
