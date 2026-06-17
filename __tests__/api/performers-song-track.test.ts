/** @jest-environment node */
/**
 * GET /api/performers/songs/[id]/track — the gated backing-track stream.
 * Proves the performer gate, 404 handling, a full 200 stream, and Range → 206.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requirePerformer: jest.fn(),
}));

jest.mock('@/lib/performer-songs', () => ({
  getPerformableSong: jest.fn(),
  streamInstrumental: jest.fn(),
}));

import { GET } from '@/app/api/performers/songs/[id]/track/route';
import * as auth from '@/lib/auth-helper';
import * as lib from '@/lib/performer-songs';

const requirePerformer = auth.requirePerformer as jest.Mock;
const getPerformableSong = lib.getPerformableSong as jest.Mock;
const streamInstrumental = lib.streamInstrumental as jest.Mock;

const bodyStream = () => new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.close(); } });
const req = (id = 'cnt_1', range?: string) =>
  new NextRequest(`https://tamilagaval.com/api/performers/songs/${id}/track`, range ? { headers: { range } } : undefined);
const ctx = (id = 'cnt_1') => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  requirePerformer.mockResolvedValue({ isAuthenticated: true, emailVerified: true });
});

it('returns 401 when unauthenticated (does not read or stream)', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  requirePerformer.mockRejectedValueOnce(new AuthError('Unauthorized', 401));
  const res = await GET(req(), ctx());
  expect(res.status).toBe(401);
  expect(getPerformableSong).not.toHaveBeenCalled();
  expect(streamInstrumental).not.toHaveBeenCalled();
});

it('rejects a malformed id with 400', async () => {
  const res = await GET(req('..'), ctx('..'));
  expect(res.status).toBe(400);
  expect(getPerformableSong).not.toHaveBeenCalled();
});

it('returns 404 when the song is not performable', async () => {
  getPerformableSong.mockResolvedValueOnce(null);
  const res = await GET(req(), ctx());
  expect(res.status).toBe(404);
  expect(streamInstrumental).not.toHaveBeenCalled();
});

it('streams the full track (200) with audio headers', async () => {
  getPerformableSong.mockResolvedValueOnce({ instrumentalKey: 'performer-tracks/cnt_1.mp3' });
  streamInstrumental.mockResolvedValueOnce({ body: bodyStream(), contentType: 'audio/mpeg', contentLength: 3, statusCode: 200 });
  const res = await GET(req(), ctx());
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('audio/mpeg');
  expect(res.headers.get('accept-ranges')).toBe('bytes');
  expect(res.headers.get('cache-control')).toContain('no-store');
  expect(streamInstrumental).toHaveBeenCalledWith('performer-tracks/cnt_1.mp3', undefined);
});

it('forwards a Range header and returns 206 with Content-Range', async () => {
  getPerformableSong.mockResolvedValueOnce({ instrumentalKey: 'performer-tracks/cnt_1.mp3' });
  streamInstrumental.mockResolvedValueOnce({
    body: bodyStream(), contentType: 'audio/mpeg', contentLength: 2, contentRange: 'bytes 0-1/3', statusCode: 206,
  });
  const res = await GET(req('cnt_1', 'bytes=0-1'), ctx());
  expect(res.status).toBe(206);
  expect(res.headers.get('content-range')).toBe('bytes 0-1/3');
  expect(streamInstrumental).toHaveBeenCalledWith('performer-tracks/cnt_1.mp3', 'bytes=0-1');
});
