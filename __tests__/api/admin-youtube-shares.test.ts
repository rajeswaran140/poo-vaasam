/** @jest-environment node */
/**
 * Tests for GET /api/admin/youtube/shares — admin gate, not-configured 503,
 * upstream 502, and a successful leaderboard.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockConfigured = jest.fn();
const mockLeaderboard = jest.fn();
jest.mock('@/lib/youtube-analytics', () => ({ isYouTubeAnalyticsConfigured: () => mockConfigured() }));
jest.mock('@/lib/song-shares', () => ({ fetchShareLeaderboard: (...a: unknown[]) => mockLeaderboard(...a) }));

import { GET } from '@/app/api/admin/youtube/shares/route';
import * as auth from '@/lib/auth-helper';

const mockedRequireAdmin = auth.requireAdmin as jest.Mock;
const req = (qs = '?days=90') => new NextRequest(`https://tamilagaval.com/api/admin/youtube/shares${qs}`);

const ROWS = [{ videoId: 'a', title: 'Song A', views: 1000, shares: 30, sharesPer1k: 30 }];

beforeEach(() => {
  mockedRequireAdmin.mockReset().mockResolvedValue({ isAuthenticated: true });
  mockConfigured.mockReset().mockReturnValue(true);
  mockLeaderboard.mockReset().mockResolvedValue({ ok: true, data: ROWS });
});

it('returns the leaderboard for an admin', async () => {
  const res = await GET(req());
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ success: true, rows: ROWS });
});

it('rejects a non-admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockedRequireAdmin.mockRejectedValueOnce(new AuthError('Unauthorized', 401));
  const res = await GET(req());
  expect(res.status).toBe(401);
  expect(mockLeaderboard).not.toHaveBeenCalled();
});

it('returns 503 when Analytics OAuth is not configured', async () => {
  mockConfigured.mockReturnValue(false);
  const res = await GET(req());
  expect(res.status).toBe(503);
  expect(mockLeaderboard).not.toHaveBeenCalled();
});

it('maps an upstream failure to 502', async () => {
  mockLeaderboard.mockResolvedValueOnce({ ok: false, error: 'No response from YouTube Analytics' });
  const res = await GET(req());
  expect(res.status).toBe(502);
});

it('clamps days + topN into range before calling the leaderboard', async () => {
  await GET(req('?days=9999&topN=999'));
  expect(mockLeaderboard).toHaveBeenCalledWith(365, 50);
});
