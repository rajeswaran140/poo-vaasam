/** @jest-environment node */
/**
 * POST /api/ai/search — input validation hardening: query required, and the
 * optional `type` filter is validated against the ContentType enum before any
 * (billable) embedding work happens.
 */
import { NextRequest } from 'next/server';

const mockEmbed = jest.fn();
jest.mock('@/services/ai/openai', () => ({
  generateEmbedding: (...a: unknown[]) => mockEmbed(...a),
  cosineSimilarity: () => 0.5,
}));
jest.mock('@/infrastructure/database/ContentRepository', () => ({
  ContentRepository: jest.fn().mockImplementation(() => ({
    findByType: jest.fn().mockResolvedValue({ items: [] }),
    findAll: jest.fn().mockResolvedValue({ items: [] }),
  })),
}));

import { POST } from '@/app/api/ai/search/route';
import { ContentType } from '@/types/content';

let ip = 0;
const post = (body: unknown) =>
  POST(
    new NextRequest('https://tamilagaval.com/api/ai/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.3.0.${ip++}` },
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  jest.clearAllMocks();
  process.env.OPENAI_API_KEY = 'sk-real-looking-key';
  mockEmbed.mockResolvedValue([0.1, 0.2, 0.3]);
});

it('400s when query is missing, without spending an embedding', async () => {
  expect((await post({})).status).toBe(400);
  expect(mockEmbed).not.toHaveBeenCalled();
});

it('400s on an invalid content type, without spending an embedding', async () => {
  const res = await post({ query: 'love', type: 'bogus-type' });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe('Invalid content type');
  expect(mockEmbed).not.toHaveBeenCalled();
});

it('accepts a valid query (and a valid type) — 200', async () => {
  const validType = Object.values(ContentType)[0];
  const res = await post({ query: 'love', type: validType });
  expect(res.status).toBe(200);
  expect(mockEmbed).toHaveBeenCalled();
});
