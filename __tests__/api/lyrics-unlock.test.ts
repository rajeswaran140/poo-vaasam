/** @jest-environment node */
/**
 * Tests for POST /api/lyrics/unlock — captures the email as a lead
 * (source='lyrics-gate'), sets the signed gate cookie, honours the honeypot,
 * and rejects an invalid email. DynamoDB is mocked.
 */

const mockPut = jest.fn();
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: { put: (...a: unknown[]) => mockPut(...a) },
  handleDynamoDBError: (e: unknown) => {
    throw e;
  },
}));

import { POST } from '@/app/api/lyrics/unlock/route';
import { LYRICS_GATE_COOKIE, verifyGateToken } from '@/lib/lyrics-gate';
import { NextRequest } from 'next/server';

const req = (body: unknown) =>
  new NextRequest('https://tamilagaval.com/api/lyrics/unlock', {
    method: 'POST',
    body: JSON.stringify(body),
  });

beforeEach(() => mockPut.mockReset());

it('rejects an invalid email with 400 and stores nothing', async () => {
  const res = await POST(req({ email: 'not-an-email' }));
  expect(res.status).toBe(400);
  expect(mockPut).not.toHaveBeenCalled();
});

it('stores the lead (source=lyrics-gate, lowercased) and sets a valid gate cookie', async () => {
  mockPut.mockResolvedValueOnce({});
  const res = await POST(req({ email: 'Fan@Example.COM', name: 'ரசிகர்', songId: 'cnt_1_a' }));
  expect(res.status).toBe(200);
  expect((await res.json()).success).toBe(true);

  const item = mockPut.mock.calls[0][0];
  expect(item.PK).toBe('SUBSCRIBER#fan@example.com'); // normalized → idempotent
  expect(item.SK).toBe('METADATA');
  expect(item.email).toBe('fan@example.com');
  expect(item.name).toBe('ரசிகர்');
  expect(item.source).toBe('lyrics-gate');
  expect(item.status).toBe('SUBSCRIBED');

  // Cookie is set and its token verifies.
  const cookie = res.cookies.get(LYRICS_GATE_COOKIE);
  expect(cookie).toBeTruthy();
  expect(cookie?.httpOnly).toBe(true);
  expect(verifyGateToken(cookie!.value)).not.toBeNull();
});

it('silently accepts but does NOT store or set a cookie when the honeypot is filled', async () => {
  const res = await POST(req({ email: 'bot@example.com', company: 'spammy' }));
  expect(res.status).toBe(200);
  expect((await res.json()).success).toBe(true);
  expect(mockPut).not.toHaveBeenCalled();
  expect(res.cookies.get(LYRICS_GATE_COOKIE)).toBeUndefined();
});
