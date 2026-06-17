/** @jest-environment node */
/**
 * GET /api/performers/songs/[id] — performer gate, bad-id / 404 handling, and
 * the happy path (gated lyrics + a freshly presigned backing-track URL; the raw
 * S3 key is never returned).
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requirePerformer: jest.fn(),
}));

jest.mock('@/lib/performer-songs', () => ({
  getPerformableSong: jest.fn(),
  presignInstrumental: jest.fn(),
  INSTRUMENTAL_URL_TTL_SECONDS: 300,
}));

import { GET } from '@/app/api/performers/songs/[id]/route';
import * as auth from '@/lib/auth-helper';
import * as lib from '@/lib/performer-songs';

const requirePerformer = auth.requirePerformer as jest.Mock;
const getPerformableSong = lib.getPerformableSong as jest.Mock;
const presignInstrumental = lib.presignInstrumental as jest.Mock;

const req = (id = 'cnt_1') => new NextRequest(`https://tamilagaval.com/api/performers/songs/${id}`);
const ctx = (id = 'cnt_1') => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  requirePerformer.mockResolvedValue({ isAuthenticated: true, emailVerified: true });
});

it('returns 401 when unauthenticated (does not read the song)', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  requirePerformer.mockRejectedValueOnce(new AuthError('Unauthorized', 401));
  const res = await GET(req(), ctx());
  expect(res.status).toBe(401);
  expect(getPerformableSong).not.toHaveBeenCalled();
});

it('rejects a malformed id with 400', async () => {
  const res = await GET(req('../etc'), ctx('../etc'));
  expect(res.status).toBe(400);
  expect(getPerformableSong).not.toHaveBeenCalled();
});

it('returns 404 when the song is missing / unpublished / not performable', async () => {
  getPerformableSong.mockResolvedValueOnce(null);
  const res = await GET(req(), ctx());
  expect(res.status).toBe(404);
  expect(presignInstrumental).not.toHaveBeenCalled();
});

it('returns lyrics + a presigned track URL (and never the raw key)', async () => {
  getPerformableSong.mockResolvedValueOnce({
    instrumentalKey: 'audio/instrumentals/cnt_1.mp3',
    toDetailJSON: () => ({ id: 'cnt_1', slug: 'amma', title: 'அம்மா', artist: 'இராஜ்', theme: 'mother', lyrics: 'பல்லவி' }),
  });
  presignInstrumental.mockResolvedValueOnce('https://signed.example/track?sig=abc');

  const res = await GET(req(), ctx());
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.song.lyrics).toBe('பல்லவி');
  expect(body.song).not.toHaveProperty('instrumentalKey');
  expect(body.instrumentalUrl).toBe('https://signed.example/track?sig=abc');
  expect(body.expiresIn).toBe(300);
  // Presigned with the server-only key.
  expect(presignInstrumental).toHaveBeenCalledWith('audio/instrumentals/cnt_1.mp3');
});
