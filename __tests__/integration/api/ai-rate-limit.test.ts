/** @jest-environment node */
/**
 * End-to-end check that the per-IP rate limiter actually gates a live AI route.
 * /api/ai/analyze-poem returns a default analysis (no OpenAI call) when no API
 * key is configured, so this stays fully offline while exercising the real
 * limiter wiring on the route.
 */

import { NextRequest } from 'next/server';

// The route constructs an OpenAI client at import; stub it so a missing key
// can't throw. The route's own placeholder-key guard (set below) means POST
// returns its default analysis without ever calling the client.
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: jest.fn(async ({ key, expressionAttributeValues }: any) => {
        const id = `${key.PK}|${key.SK}`;
        const count = (rows.get(id) ?? 0) + expressionAttributeValues[':one'];
        rows.set(id, count);
        return { count };
      }),
    },
  };
});

jest.mock('openai', () => ({
  __esModule: true,
  default: class {
    chat = { completions: { create: jest.fn() } };
  },
}));

// Placeholder key → the route returns the default analysis (no network call).
const prevKey = process.env.OPENAI_API_KEY;
process.env.OPENAI_API_KEY = 'your-openai-api-key-here';
afterAll(() => {
  process.env.OPENAI_API_KEY = prevKey;
});

import { POST } from '@/app/api/ai/analyze-poem/route';

function poemRequest(ip: string) {
  return new NextRequest('http://localhost:3000/api/ai/analyze-poem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ title: 'டெஸ்ட்', body: 'வரி', author: 'A' }),
  });
}

describe('/api/ai/analyze-poem rate limiting', () => {
  it('returns 429 once a single IP exceeds the per-minute cap', async () => {
    const ip = '203.0.113.50';
    const max = 20;

    // The first `max` requests succeed (default analysis path → 200).
    for (let i = 0; i < max; i++) {
      const res = await POST(poemRequest(ip));
      expect(res.status).toBe(200);
    }

    // The next one from the same IP is throttled.
    const blocked = await POST(poemRequest(ip));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);

    // A different IP is unaffected by the first IP's usage.
    const other = await POST(poemRequest('198.51.100.99'));
    expect(other.status).toBe(200);
  });
});
