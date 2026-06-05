/** @jest-environment node */
/**
 * Tests for POST /api/admin/compose — admin gate, body validation, and the
 * heartbeat-streamed brief (success + error are streamed as a 200 whose body
 * ends in the `{ success, data|error }` JSON; auth/validation stay plain JSON).
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

// Read a heartbeat-streamed response: drain the body and parse the trailing JSON.
async function readStreamed(res: Response): Promise<{ success?: boolean; data?: { emotion?: string }; error?: string; code?: string }> {
  const text = (await res.text()).trim();
  return JSON.parse(text);
}

it('streams a clean error (200) when the composer fails, carrying the code', async () => {
  mockedCompose.mockResolvedValueOnce({ ok: false, code: 'auth', error: 'The Claude API key is invalid.' });
  const res = await POST(req({ lyrics: 'lyrics' }));
  expect(res.status).toBe(200); // streamed; the failure is carried in the body
  const body = await readStreamed(res);
  expect(body.success).toBe(false);
  expect(body.error).toMatch(/invalid/i);
  // The structured code is propagated so the client can suppress a pointless retry.
  expect(body.code).toBe('auth');
});

it('does not leak raw upstream detail in the streamed error', async () => {
  mockedCompose.mockResolvedValueOnce({ ok: false, code: 'upstream', error: 'The AI service failed to respond.' });
  const res = await POST(req({ lyrics: 'lyrics' }));
  const body = await readStreamed(res);
  expect(body.success).toBe(false);
  expect(body.error).toBe('The AI service failed to respond.');
});

it('streams the structured brief on success', async () => {
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
      suno_prompts: [{ style: 'Default', prompt: 'prompt' }],
      youtube_description_tamil: 'desc-ta',
      youtube_description_english: 'desc-en',
    },
  });
  const res = await POST(req({ lyrics: 'lyrics' }));
  expect(res.status).toBe(200);
  const body = await readStreamed(res);
  expect(body.success).toBe(true);
  expect(body.data?.emotion).toBe('காதல்');
  // Called with the lyrics + an abort signal so the route can cancel on disconnect.
  expect(mockedCompose).toHaveBeenCalledWith('lyrics', expect.objectContaining({ signal: expect.any(AbortSignal) }));
});
