/** @jest-environment node */
/**
 * INTEGRATION TESTS — GET /api/admin/youtube/funnel.
 *
 * Runs the route through the REAL pure computeFunnel, with auth + the
 * network-bound fetchFunnelData mocked. Covers auth gating, the not-configured
 * gate, the happy path (stages + conversions surface), day-window snapping, and
 * upstream failure.
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/youtube-analytics', () => ({
  isYouTubeAnalyticsConfigured: jest.fn(() => true),
  fetchFunnelData: jest.fn(),
}));

import { GET } from '@/app/api/admin/youtube/funnel/route';
import * as auth from '@/lib/auth-helper';
import * as yta from '@/lib/youtube-analytics';
import type { FunnelInput } from '@/lib/youtube-funnel';

const mockRequireAdmin = auth.requireAdmin as jest.Mock;
const mockConfigured = yta.isYouTubeAnalyticsConfigured as jest.Mock;
const mockFetch = yta.fetchFunnelData as jest.Mock;

const INPUT: FunnelInput = {
  days: 28,
  channel: { views: 10000, watchMinutes: 30000, averageViewPercentage: 32, subscribersGained: 120, subscribersLost: 10, uniqueViewers: 8000 },
  trafficSources: [
    { source: 'RELATED_VIDEO', views: 6000, watchMinutes: 15000 },
    { source: 'PLAYLIST', views: 2500, watchMinutes: 9000 },
    { source: 'YT_SEARCH', views: 1500, watchMinutes: 1000 },
  ],
  playlist: { views: 2500, playlistStarts: 1000, viewsPerPlaylistStart: 2.4, averageTimeInPlaylistSeconds: 480 },
  videos: [{ videoId: 'good', views: 3000, averageViewPercentage: 40, subscribersGained: 60 }],
};

const req = (qs = '') =>
  new NextRequest(`https://tamilagaval.com/api/admin/youtube/funnel${qs}`, { method: 'GET' });

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireAdmin.mockResolvedValue({ isAuthenticated: true });
  mockConfigured.mockReturnValue(true);
  mockFetch.mockResolvedValue({ ok: true, data: INPUT });
});

it('returns 403 when not admin (and never fetches)', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockRequireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  expect((await GET(req())).status).toBe(403);
  expect(mockFetch).not.toHaveBeenCalled();
});

it('returns 503 when Analytics OAuth is not configured', async () => {
  mockConfigured.mockReturnValueOnce(false);
  const res = await GET(req());
  expect(res.status).toBe(503);
  expect(mockFetch).not.toHaveBeenCalled();
});

it('returns the computed funnel on the happy path', async () => {
  const res = await GET(req('?days=28'));
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.success).toBe(true);
  expect(body.stages.map((s: { key: string }) => s.key)).toEqual([
    'DISCOVERED', 'WATCHED', 'WATCHED_2ND_SONG', 'RETURNED', 'SUBSCRIBED',
  ]);
  expect(body.subscribe).toMatchObject({ subscribersGained: 120, subsPer1000Views: 12 });
  expect(body.topConverters[0].videoId).toBe('good');
});

it('snaps an out-of-range day window to the 28-day default', async () => {
  await GET(req('?days=999'));
  expect(mockFetch).toHaveBeenCalledWith(28);
});

it('accepts an allowed day window (7/28/90)', async () => {
  await GET(req('?days=90'));
  expect(mockFetch).toHaveBeenCalledWith(90);
});

it('returns 502 on an upstream Analytics failure', async () => {
  mockFetch.mockResolvedValueOnce({ ok: false, error: 'Analytics API 401' });
  const res = await GET(req());
  expect(res.status).toBe(502);
  expect((await res.json()).error).toMatch(/401/);
});
