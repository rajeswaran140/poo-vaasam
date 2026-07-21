/** @jest-environment node */
/**
 * Tests for POST /api/subscribe — email validation, idempotent storage
 * (PK=SUBSCRIBER#<email>), and honeypot handling.
 */

const mockPut = jest.fn();
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: { put: (...a: unknown[]) => mockPut(...a) },
  handleDynamoDBError: (e: unknown) => {
    throw e;
  },
}));

import { POST } from '@/app/api/subscribe/route';
import { NextRequest } from 'next/server';

const req = (body: unknown) =>
  new NextRequest('https://tamilagaval.com/api/subscribe', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => mockPut.mockReset());

it('rejects an invalid email with 400 and stores nothing', async () => {
  const res = await POST(req({ email: 'not-an-email' }));
  expect(res.status).toBe(400);
  expect(mockPut).not.toHaveBeenCalled();
});

it('stores a valid subscriber (lowercased) keyed by email, returns 201', async () => {
  mockPut.mockResolvedValueOnce({});
  const res = await POST(req({ email: 'Raj@Example.COM', source: 'footer' }));
  expect(res.status).toBe(201);
  const item = mockPut.mock.calls[0][0];
  expect(item.PK).toBe('SUBSCRIBER#raj@example.com'); // normalized → idempotent
  expect(item.SK).toBe('METADATA');
  expect(item.email).toBe('raj@example.com');
  expect(item.source).toBe('footer');
  expect(item.status).toBe('SUBSCRIBED');
});

it('silently accepts but does not store when the honeypot is filled', async () => {
  const res = await POST(req({ email: 'bot@example.com', company: 'spammy' }));
  expect(res.status).toBe(200);
  expect(mockPut).not.toHaveBeenCalled();
});

it('rate-limits repeated requests from one IP with 429', async () => {
  mockPut.mockResolvedValue({});
  const reqFrom = (email: string) =>
    new NextRequest('https://tamilagaval.com/api/subscribe', {
      method: 'POST',
      body: JSON.stringify({ email }),
      headers: { 'x-forwarded-for': '203.0.113.7' }, // distinct IP → own bucket
    });
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) statuses.push((await POST(reqFrom(`u${i}@example.com`))).status);
  expect(statuses.slice(0, 5).every((s) => s !== 429)).toBe(true); // first 5 allowed
  expect(statuses[5]).toBe(429); // 6th blocked (5/min per IP)
});
