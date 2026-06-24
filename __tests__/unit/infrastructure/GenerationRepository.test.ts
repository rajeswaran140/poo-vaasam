/** @jest-environment node */
/**
 * GenerationRepository — create (brief-child key + GSI1 feed key) and the two
 * list paths (by-brief query, all-feed GSI query). DynamoDBOperations is mocked.
 */

import { GenerationRepository } from '@/infrastructure/database/GenerationRepository';
import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';
import type { CreateGenerationInput } from '@/types/generation';

jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: { put: jest.fn(), query: jest.fn() },
  handleDynamoDBError: jest.fn((e) => {
    throw e;
  }),
}));

const ops = DynamoDBOperations as unknown as { put: jest.Mock; query: jest.Mock };

const input: CreateGenerationInput = {
  briefId: 'brief_42',
  engine: 'suno',
  settings: { weirdness: 15, styleInfluence: 50 },
  scores: { melody: 8, vocals: 3 },
  verdict: 'failed',
  failureReason: 'vocal_delivery',
  notes: 'great flute intro, robotic vocals',
};

beforeEach(() => jest.clearAllMocks());

it('create() stores the generation as a child of its brief + a GSI1 feed entry', async () => {
  ops.put.mockResolvedValueOnce({});
  const gen = await new GenerationRepository().create(input);

  expect(gen.id).toMatch(/^gen_/);
  expect(gen.embedding).toBeNull();
  expect(gen.briefId).toBe('brief_42');

  const item = ops.put.mock.calls[0][0];
  expect(item.PK).toBe('BRIEF#brief_42');
  expect(item.SK).toBe(`GEN#${gen.id}`);
  expect(item.Type).toBe('GENERATION');
  expect(item.GSI1PK).toBe('GENERATION#ALL');
  expect(item.GSI1SK).toBe(`${gen.createdAt}#${gen.id}`);
  expect(item.verdict).toBe('failed');
  expect(item.scores).toEqual({ melody: 8, vocals: 3 });
});

it('listByBrief() queries the brief partition for GEN# items, newest-first', async () => {
  ops.query.mockResolvedValueOnce({ Items: [{ id: 'gen_1', briefId: 'brief_42', verdict: 'failed', notes: 'x' }] });
  const rows = await new GenerationRepository().listByBrief('brief_42');

  const params = ops.query.mock.calls[0][0];
  expect(params.keyConditionExpression).toContain('begins_with(SK, :sk)');
  expect(params.expressionAttributeValues).toMatchObject({ ':pk': 'BRIEF#brief_42', ':sk': 'GEN#' });
  expect(params.scanIndexForward).toBe(false);
  expect(params.indexName).toBeUndefined(); // base table, not the GSI
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: 'gen_1', settings: {}, scores: {}, embedding: null });
});

it('list() reads the newest-first cross-brief feed off GSI1', async () => {
  ops.query.mockResolvedValueOnce({ Items: [] });
  await new GenerationRepository().list({ limit: 25 });

  const params = ops.query.mock.calls[0][0];
  expect(params.indexName).toBe('GSI1');
  expect(params.expressionAttributeValues).toMatchObject({ ':pk': 'GENERATION#ALL' });
  expect(params.scanIndexForward).toBe(false);
  expect(params.limit).toBe(25);
});

it('list() defaults the limit to 100', async () => {
  ops.query.mockResolvedValueOnce({ Items: undefined });
  const rows = await new GenerationRepository().list();
  expect(ops.query.mock.calls[0][0].limit).toBe(100);
  expect(rows).toEqual([]); // tolerates a missing Items array
});

it('propagates DynamoDB errors via handleDynamoDBError', async () => {
  ops.put.mockRejectedValueOnce(new Error('ddb down'));
  await expect(new GenerationRepository().create(input)).rejects.toThrow('ddb down');
});
