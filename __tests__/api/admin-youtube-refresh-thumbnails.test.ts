/** @jest-environment node */
/** POST /api/admin/youtube/refresh-thumbnails — admin gate + re-mirror summary. */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockFetchVideos = jest.fn();
jest.mock('@/lib/youtube-feed', () => ({ fetchChannelVideos: (...a: unknown[]) => mockFetchVideos(...a) }));

const mockRefresh = jest.fn();
jest.mock('@/lib/video-thumbnails', () => ({ refreshThumbnails: (...a: unknown[]) => mockRefresh(...a) }));

import { POST } from '@/app/api/admin/youtube/refresh-thumbnails/route';
import * as auth from '@/lib/auth-helper';

const requireAdmin = auth.requireAdmin as jest.Mock;
const req = (withBearer = true) =>
  POST(
    new NextRequest('https://tamilagaval.com/api/admin/youtube/refresh-thumbnails', {
      method: 'POST',
      headers: withBearer ? { Authorization: 'Bearer test-token' } : undefined,
    })
  );

beforeEach(() => {
  jest.clearAllMocks();
  requireAdmin.mockResolvedValue({ isAuthenticated: true });
});

it('returns 403 for a non-admin (no re-mirror)', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  requireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  expect((await req()).status).toBe(403);
  expect(mockRefresh).not.toHaveBeenCalled();
});

it('returns 401 without a Bearer token (CSRF defense on the mutation)', async () => {
  expect((await req(false)).status).toBe(401);
  expect(mockRefresh).not.toHaveBeenCalled();
});

it('re-mirrors the current channel videos and returns counts', async () => {
  mockFetchVideos.mockResolvedValueOnce([{ id: 'aaaaaaaaaaa' }, { id: 'bbbbbbbbbbb' }]);
  mockRefresh.mockResolvedValueOnce({ refreshed: ['aaaaaaaaaaa'], failed: ['bbbbbbbbbbb'] });
  const res = await req();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({ success: true, refreshed: 1, failed: 1, total: 2 });
  expect(mockRefresh).toHaveBeenCalledWith(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
});

it('handles an empty channel without calling refresh', async () => {
  mockFetchVideos.mockResolvedValueOnce([]);
  const body = await (await req()).json();
  expect(body).toEqual({ success: true, refreshed: [], failed: [], total: 0 });
  expect(mockRefresh).not.toHaveBeenCalled();
});
