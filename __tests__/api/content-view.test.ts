/** @jest-environment node */
/**
 * POST /api/content/[id]/view — the on-site view beacon. Increments only for
 * published content; no-ops for unknown/draft ids; validates the id; rate-limits
 * per IP; never lets a counter failure break the page.
 */

import { NextRequest } from 'next/server';

/**
 * Rate limiting now goes through DynamoDB (SharedRateLimiter), so the store is
 * mocked with a counting fake. Without this the limiter would fall back to its
 * per-instance tier via an error path — and `.env.local` names the PRODUCTION
 * table, so an unmocked test must never be one SDK change away from writing to it.
 */
jest.mock('@/infrastructure/database/dynamodb-client', () => {
  const rows = new Map<string, number>();
  return {
    DynamoDBOperations: {

      update: jest.fn(async ({ key, expressionAttributeValues }: any) => {
        const id = `${key.PK}|${key.SK}`;
        const count = (rows.get(id) ?? 0) + expressionAttributeValues[':one'];
        rows.set(id, count);
        return { count };
      }),
    },
  };
});

jest.mock('@/infrastructure/database/ContentRepository', () => {
  const findById = jest.fn();
  const incrementViewCount = jest.fn();
  return {
    ContentRepository: jest.fn(() => ({ findById, incrementViewCount })),
    __findById: findById,
    __incrementViewCount: incrementViewCount,
  };
});

import { POST } from '@/app/api/content/[id]/view/route';

const repoMock = jest.requireMock('@/infrastructure/database/ContentRepository') as any;
const findById = repoMock.__findById as jest.Mock;
const incrementViewCount = repoMock.__incrementViewCount as jest.Mock;

// Distinct IP per test keeps the module-level rate limiter from bleeding across
// tests (the limiter buckets by x-forwarded-for).
function post(id: string, ip = `10.0.0.${Math.floor(Math.random() * 250) + 1}`) {
  return POST(
    new NextRequest(new Request(`http://localhost/api/content/${id}/view`, {
      method: 'POST',
      headers: { 'x-forwarded-for': ip },
    })),
    { params: Promise.resolve({ id }) }
  );
}

const published = { isPublished: () => true };
const draft = { isPublished: () => false };

beforeEach(() => {
  findById.mockReset();
  incrementViewCount.mockReset();
});

it('increments the counter for published content', async () => {
  findById.mockResolvedValueOnce(published);
  incrementViewCount.mockResolvedValueOnce(undefined);
  const res = await post('cnt_123_abc');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ success: true, counted: true });
  expect(incrementViewCount).toHaveBeenCalledWith('cnt_123_abc');
});

it('does NOT increment for an unpublished (draft) content', async () => {
  findById.mockResolvedValueOnce(draft);
  const res = await post('cnt_draft_1');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ success: true, counted: false });
  expect(incrementViewCount).not.toHaveBeenCalled();
});

it('does NOT increment for an unknown content id', async () => {
  findById.mockResolvedValueOnce(null);
  const res = await post('cnt_missing');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ success: true, counted: false });
  expect(incrementViewCount).not.toHaveBeenCalled();
});

it('rejects a malformed id with 400 and never touches the DB', async () => {
  const res = await post('not-a-content-id');
  expect(res.status).toBe(400);
  expect(findById).not.toHaveBeenCalled();
  expect(incrementViewCount).not.toHaveBeenCalled();
});

it('never breaks the page on a DB error (500, no throw)', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  findById.mockRejectedValueOnce(new Error('ProvisionedThroughputExceeded'));
  const res = await post('cnt_err_1');
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ success: false, counted: false });
});

it('rate-limits a single IP hammering the beacon (429 after the cap)', async () => {
  findById.mockResolvedValue(published);
  incrementViewCount.mockResolvedValue(undefined);
  const ip = '203.0.113.7';
  let last = 200;
  // Limit is 60/min; the 61st from the same IP must be throttled.
  for (let i = 0; i < 61; i++) {
    const res = await post('cnt_rl_1', ip);
    last = res.status;
  }
  expect(last).toBe(429);
});
