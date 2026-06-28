/** @jest-environment node */
/**
 * CriticJobRepository — create (processing job + TTL, CRITICJOB key) and get
 * (mapped / null). Mirrors ComposeJobRepository.
 */

import { CriticJobRepository } from '@/infrastructure/database/CriticJobRepository';
import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';

jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: { put: jest.fn(), get: jest.fn() },
  handleDynamoDBError: jest.fn((e) => {
    throw e;
  }),
}));

const ops = DynamoDBOperations as unknown as { put: jest.Mock; get: jest.Mock };

beforeEach(() => jest.clearAllMocks());

it('create() writes a processing job with the CRITICJOB key and a ttl', async () => {
  ops.put.mockResolvedValueOnce({});
  const job = await new CriticJobRepository().create('critic_1');

  expect(job).toMatchObject({ id: 'critic_1', status: 'processing', result: null, error: null });
  const item = ops.put.mock.calls[0][0];
  expect(item.PK).toBe('CRITICJOB#critic_1');
  expect(item.SK).toBe('METADATA');
  expect(item.status).toBe('processing');
  expect(typeof item.ttl).toBe('number');
  expect(item.ttl).toBeGreaterThan(0);
});

it('get() maps a stored item to a CriticJob', async () => {
  ops.get.mockResolvedValueOnce({
    id: 'critic_1', status: 'done', createdAt: 'a', updatedAt: 'b',
    result: { overall: 'tender read', strengths: [], observations: [], slackLines: [], wordIdeas: [], questions: [] }, error: null,
  });
  const job = await new CriticJobRepository().get('critic_1');
  expect(job).toMatchObject({ id: 'critic_1', status: 'done', result: { overall: 'tender read' } });
});

it('get() returns null when the job is missing/expired', async () => {
  ops.get.mockResolvedValueOnce(undefined);
  expect(await new CriticJobRepository().get('gone')).toBeNull();
});
