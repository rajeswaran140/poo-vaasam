/** @jest-environment node */
/** POST /api/admin/compose/critique — admin gate, input validation, rate limit, error mapping. */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockCritique = jest.fn();
jest.mock('@/services/ai/lyricCritic', () => ({
  critiqueLyric: (...args: unknown[]) => mockCritique(...args),
}));

import { POST } from '@/app/api/admin/compose/critique/route';
import * as auth from '@/lib/auth-helper';
import { __resetLyricCriticRateLimitForTests } from '@/lib/lyric-critic-rate-limit';

const requireAdmin = auth.requireAdmin as jest.Mock;
const post = (b: unknown) =>
  POST(new NextRequest('https://tamilagaval.com/api/admin/compose/critique', { method: 'POST', body: JSON.stringify(b) }));

const VALID_INPUT = { lyrics: 'பல்லவி\nஊருக்குப் போகணும்' };
const CRITIQUE = {
  overall: 'A tender pallavi.',
  strengths: [],
  observations: [],
  slackLines: [],
  wordIdeas: [],
  questions: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  __resetLyricCriticRateLimitForTests();
  requireAdmin.mockResolvedValue({ userId: 'admin-1', email: 'a@tamilagaval.com' });
  mockCritique.mockResolvedValue({ ok: true, data: CRITIQUE });
});

it('returns 403 for a non-admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  requireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  expect((await post(VALID_INPUT)).status).toBe(403);
  expect(mockCritique).not.toHaveBeenCalled();
});

it('rejects empty lyrics with 400 — no upstream call', async () => {
  const res = await post({ lyrics: '   ' });
  expect(res.status).toBe(400);
  expect(mockCritique).not.toHaveBeenCalled();
});

it('critiques a valid draft (200)', async () => {
  const res = await post(VALID_INPUT);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.data.overall).toBe('A tender pallavi.');
  expect(mockCritique).toHaveBeenCalledTimes(1);
});

it('maps not_configured to 503', async () => {
  mockCritique.mockResolvedValueOnce({ ok: false, code: 'not_configured', error: 'AI is not configured.' });
  expect((await post(VALID_INPUT)).status).toBe(503);
});

it('maps bad_response to 502', async () => {
  mockCritique.mockResolvedValueOnce({ ok: false, code: 'bad_response', error: 'incomplete' });
  expect((await post(VALID_INPUT)).status).toBe(502);
});

it('maps a service rate_limit to 429', async () => {
  mockCritique.mockResolvedValueOnce({ ok: false, code: 'rate_limit', error: 'slow down' });
  expect((await post(VALID_INPUT)).status).toBe(429);
});

it('enforces the per-admin rate limit (16th call in a window is 429)', async () => {
  let last = 0;
  for (let i = 0; i < 16; i++) last = (await post(VALID_INPUT)).status;
  expect(last).toBe(429);
  // 15 critiques got through; the throttled one never reached the service.
  expect(mockCritique).toHaveBeenCalledTimes(15);
});
