/** @jest-environment node */
/**
 * Tests for GET /api/admin/youtube/shares — admin gate, not-configured 503,
 * upstream 502, param clamping, and the leaderboard contract.
 *
 * The contract changed in the 2026-07-14 WhatsApp audit: `topN` now trims only
 * the DISPLAY list (it must not bound what gets measured, or the rate ranking
 * goes selection-biased), and an unreadable share count surfaces as `null` +
 * `failedVideoIds` rather than a silent 0.
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

const ROWS = [
  { videoId: 'a', title: 'Song A', views: 1000, shares: 30, sharesPer1k: 30 },
  { videoId: 'b', title: 'Song B', views: 800, shares: null, sharesPer1k: null },
];
const LEADERBOARD = {
  rows: ROWS,
  candidatesConsidered: 42,
  minViews: 100,
  failedVideoIds: ['b'],
};

beforeEach(() => {
  mockedRequireAdmin.mockReset().mockResolvedValue({ isAuthenticated: true });
  mockConfigured.mockReset().mockReturnValue(true);
  mockLeaderboard.mockReset().mockResolvedValue({ ok: true, data: LEADERBOARD });
});

it('returns the leaderboard for an admin', async () => {
  const res = await GET(req());
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    success: true,
    rows: ROWS,
    candidatesConsidered: 42,
    minViews: 100,
    days: 90,
  });
});

it('surfaces the songs whose share count could not be read', async () => {
  const res = await GET(req());
  const json = await res.json();
  // A failed read must reach the client as null + a named id, never as a 0.
  expect(json.failedVideoIds).toEqual(['b']);
  expect(json.rows[1]).toMatchObject({ videoId: 'b', shares: null, sharesPer1k: null });
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

it('clamps days + topN + minViews into range', async () => {
  await GET(req('?days=9999&topN=999&minViews=999999'));
  expect(mockLeaderboard).toHaveBeenCalledWith(365, { topN: 50, minViews: 100_000 });
});

it('applies sane defaults when params are absent or junk', async () => {
  await GET(req('?days=abc&topN=&minViews=xyz'));
  expect(mockLeaderboard).toHaveBeenCalledWith(90, { topN: 20, minViews: 100 });
});

it('allows minViews=0 (no floor) rather than clamping it away', async () => {
  await GET(req('?minViews=0'));
  expect(mockLeaderboard).toHaveBeenCalledWith(90, { topN: 20, minViews: 0 });
});
