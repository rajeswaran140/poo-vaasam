/** @jest-environment node */
/**
 * Tests for POST /api/admin/compose — admin gate, body validation,
 * 503 when AI not configured, 502 on upstream failure, happy path.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

jest.mock('@/services/ai/composer', () => ({
  composeFromLyrics: jest.fn(),
}));

import { POST } from '@/app/api/admin/compose/route';
import * as auth from '@/lib/auth-helper';
import * as composer from '@/services/ai/composer';

const mockedRequireAdmin = auth.requireAdmin as jest.Mock;
const mockedCompose = composer.composeFromLyrics as jest.Mock;

const req = (body: unknown) =>
  new NextRequest('https://tamilagaval.com/api/admin/compose', {
    method: 'POST',
    body: JSON.stringify(body),
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockedRequireAdmin.mockResolvedValue({ isAuthenticated: true });
});

it('returns 403 when caller is not admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockedRequireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  const res = await POST(req({ lyrics: 'காதல்' }));
  expect(res.status).toBe(403);
  expect(mockedCompose).not.toHaveBeenCalled();
});

it('returns 400 when lyrics are missing', async () => {
  const res = await POST(req({}));
  expect(res.status).toBe(400);
});

it('returns 400 when lyrics are too long', async () => {
  const res = await POST(req({ lyrics: 'x'.repeat(8001) }));
  expect(res.status).toBe(400);
});

it('returns 503 when AI is not configured', async () => {
  mockedCompose.mockResolvedValueOnce({ ok: false, code: 'not_configured', error: 'AI is not configured.' });
  const res = await POST(req({ lyrics: 'lyrics' }));
  expect(res.status).toBe(503);
});

it('returns 503 when the API key is rejected (auth error)', async () => {
  mockedCompose.mockResolvedValueOnce({ ok: false, code: 'auth', error: 'The Claude API key is invalid.' });
  const res = await POST(req({ lyrics: 'lyrics' }));
  expect(res.status).toBe(503);
});

it('returns 429 when rate-limited', async () => {
  mockedCompose.mockResolvedValueOnce({ ok: false, code: 'rate_limit', error: 'Rate-limited.' });
  const res = await POST(req({ lyrics: 'lyrics' }));
  expect(res.status).toBe(429);
});

it('returns 502 on generic upstream failure', async () => {
  mockedCompose.mockResolvedValueOnce({ ok: false, code: 'upstream', error: 'The AI service failed to respond.' });
  const res = await POST(req({ lyrics: 'lyrics' }));
  expect(res.status).toBe(502);
});

it('returns 200 + structured payload on success', async () => {
  mockedCompose.mockResolvedValueOnce({
    ok: true,
    data: {
      emotion: 'காதல்',
      mood: 'Tender',
      theme: 'Love',
      suggested_key: 'C Major',
      suggested_bpm: 90,
      suggested_instruments: ['Veena'],
      song_titles: ['T1'],
      suno_prompt: 'prompt',
      youtube_description: 'desc',
    },
  });
  const res = await POST(req({ lyrics: 'lyrics' }));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.data.emotion).toBe('காதல்');
  expect(mockedCompose).toHaveBeenCalledWith('lyrics');
});
