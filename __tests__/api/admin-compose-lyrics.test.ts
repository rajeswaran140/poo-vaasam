/** @jest-environment node */
/** POST /api/admin/compose/lyrics — admin gate, brief validation, rate limit, error mapping. */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockGenerate = jest.fn();
jest.mock('@/services/ai/lyricist', () => ({
  generateLyrics: (...args: unknown[]) => mockGenerate(...args),
}));

import { POST } from '@/app/api/admin/compose/lyrics/route';
import * as auth from '@/lib/auth-helper';
import { __resetLyricRateLimitForTests } from '@/lib/lyric-rate-limit';

const requireAdmin = auth.requireAdmin as jest.Mock;
const post = (b: unknown, withBearer = true) =>
  POST(
    new NextRequest('https://tamilagaval.com/api/admin/compose/lyrics', {
      method: 'POST',
      body: JSON.stringify(b),
      headers: withBearer ? { Authorization: 'Bearer test-token' } : undefined,
    })
  );

const VALID_BRIEF = { theme: 'Homeland nostalgia', emotions: ['ஏக்கம்'] };
const LYRICS = {
  title: 'ஊருக்குப் போகணும்',
  pallavi: ['ஊருக்குப் போகணும்'],
  anupallavi: [],
  charanams: [['வயல் வரப்பினில்']],
  notes: '',
};

beforeEach(() => {
  jest.clearAllMocks();
  __resetLyricRateLimitForTests();
  requireAdmin.mockResolvedValue({ userId: 'admin-1', email: 'a@tamilagaval.com' });
  mockGenerate.mockResolvedValue({ ok: true, data: LYRICS });
});

it('returns 403 for a non-admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  requireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  expect((await post(VALID_BRIEF)).status).toBe(403);
  expect(mockGenerate).not.toHaveBeenCalled();
});

it('returns 401 without a Bearer token (CSRF defense on the mutation)', async () => {
  const res = await post(VALID_BRIEF, false);
  expect(res.status).toBe(401);
  expect(mockGenerate).not.toHaveBeenCalled();
});

it('rejects an invalid brief (missing theme) with 400 — no upstream call', async () => {
  const res = await post({ emotions: ['அன்பு'] });
  expect(res.status).toBe(400);
  expect(mockGenerate).not.toHaveBeenCalled();
});

it('rejects a brief with no emotions with 400', async () => {
  const res = await post({ theme: 'Love', emotions: [] });
  expect(res.status).toBe(400);
  expect(mockGenerate).not.toHaveBeenCalled();
});

it('generates a lyric for a valid brief (200)', async () => {
  const res = await post(VALID_BRIEF);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.data.title).toBe('ஊருக்குப் போகணும்');
  expect(mockGenerate).toHaveBeenCalledTimes(1);
});

it('maps not_configured to 503', async () => {
  mockGenerate.mockResolvedValueOnce({ ok: false, code: 'not_configured', error: 'AI is not configured.' });
  expect((await post(VALID_BRIEF)).status).toBe(503);
});

it('maps bad_response to 502', async () => {
  mockGenerate.mockResolvedValueOnce({ ok: false, code: 'bad_response', error: 'incomplete' });
  expect((await post(VALID_BRIEF)).status).toBe(502);
});

it('maps a service rate_limit to 429', async () => {
  mockGenerate.mockResolvedValueOnce({ ok: false, code: 'rate_limit', error: 'slow down' });
  expect((await post(VALID_BRIEF)).status).toBe(429);
});

it('enforces the per-admin rate limit (11th call in a window is 429)', async () => {
  let last = 0;
  for (let i = 0; i < 11; i++) last = (await post(VALID_BRIEF)).status;
  expect(last).toBe(429);
  // 10 generations got through; the throttled one never reached the service.
  expect(mockGenerate).toHaveBeenCalledTimes(10);
});
