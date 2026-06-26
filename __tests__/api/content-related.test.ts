/** @jest-environment node */
/**
 * GET /api/content/related — the client-supplied `limit` is clamped to a sane
 * range (cost/abuse guard) before it reaches findByType.
 */
import { NextRequest } from 'next/server';

const mockFindByType = jest.fn();
jest.mock('@/infrastructure/database/ContentRepository', () => ({
  ContentRepository: jest.fn().mockImplementation(() => ({ findByType: mockFindByType })),
}));

import { GET } from '@/app/api/content/related/route';
import { ContentType } from '@/types/content';

const TYPE = Object.values(ContentType)[0];
const get = (qs: string) => GET(new NextRequest(`http://localhost/api/content/related?${qs}`));

beforeEach(() => {
  jest.clearAllMocks();
  mockFindByType.mockResolvedValue({ items: [] });
});

// The route fetches limit+1 (one extra for the self-exclusion buffer).
it('clamps an oversized limit to 50', async () => {
  await get(`type=${TYPE}&limit=9999`);
  expect(mockFindByType.mock.calls[0][1].limit).toBe(51);
});

it('floors a non-positive limit to 1', async () => {
  await get(`type=${TYPE}&limit=0`);
  expect(mockFindByType.mock.calls[0][1].limit).toBe(2);
});

it('falls back to the default 20 for a non-numeric limit', async () => {
  await get(`type=${TYPE}&limit=abc`);
  expect(mockFindByType.mock.calls[0][1].limit).toBe(21);
});

it('400s on an invalid content type (and never queries)', async () => {
  const res = await get('type=bogus');
  expect(res.status).toBe(400);
  expect(mockFindByType).not.toHaveBeenCalled();
});
