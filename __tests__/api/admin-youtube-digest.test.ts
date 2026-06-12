/** @jest-environment node */
/**
 * INTEGRATION TESTS — GET /api/admin/youtube/digest.
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/youtube-analytics', () => ({
  isYouTubeAnalyticsConfigured: jest.fn(() => true),
  fetchDailySeries: jest.fn(),
  fetchVideoAnalytics: jest.fn(),
}));

import { GET } from '@/app/api/admin/youtube/digest/route';
import * as auth from '@/lib/auth-helper';
import * as yta from '@/lib/youtube-analytics';

const mockRequireAdmin = auth.requireAdmin as jest.Mock;
const mockConfigured = yta.isYouTubeAnalyticsConfigured as jest.Mock;
const mockSeries = yta.fetchDailySeries as jest.Mock;
const mockVideos = yta.fetchVideoAnalytics as jest.Mock;

const series = (n: number, viewsPerDay: number) =>
  Array.from({ length: n }, (_, i) => ({
    date: `2026-06-${String(i + 1).padStart(2, '0')}`,
    views: viewsPerDay,
    subscribersGained: 1,
    estimatedMinutesWatched: viewsPerDay * 2,
  }));

const req = (qs = '') =>
  new NextRequest(`https://tamilagaval.com/api/admin/youtube/digest${qs}`, { method: 'GET' });

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireAdmin.mockResolvedValue({ isAuthenticated: true });
  mockConfigured.mockReturnValue(true);
  mockSeries.mockResolvedValue({ ok: true, data: series(14, 20) });
  mockVideos.mockResolvedValue({
    ok: true,
    data: [{ videoId: 'b', views: 800, subscribersGained: 2, estimatedMinutesWatched: 100, averageViewDuration: 60 }],
  });
});

it('returns 403 when not admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockRequireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  expect((await GET(req())).status).toBe(403);
});

it('returns 503 when Analytics OAuth is not configured', async () => {
  mockConfigured.mockReturnValueOnce(false);
  expect((await GET(req())).status).toBe(503);
  expect(mockSeries).not.toHaveBeenCalled();
});

it('builds the digest (growth + anomaly + top videos + headline)', async () => {
  const res = await GET(req('?days=28'));
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.success).toBe(true);
  expect(body.weekOverWeek.views.current).toBe(140); // 7×20
  expect(body.anomaly.status).toBe('normal'); // steady 20/day
  expect(body.topByViews[0].videoId).toBe('b');
  expect(typeof body.headline).toBe('string');
});

it('flags a stall (counter-lag wording) when recent days collapse', async () => {
  const stalled = [...series(11, 40), ...series(3, 0).map((d, i) => ({ ...d, date: `2026-06-${12 + i}` }))];
  mockSeries.mockResolvedValueOnce({ ok: true, data: stalled });
  const body = await (await GET(req())).json();
  expect(body.anomaly.status).toBe('stalled');
  expect(body.anomaly.message).toMatch(/lag/i);
  expect(body.headline).toMatch(/stalled/i);
});

it('still returns 200 with empty top lists if per-video analytics fail', async () => {
  mockVideos.mockResolvedValueOnce({ ok: false, error: 'video analytics down' });
  const body = await (await GET(req())).json();
  expect(body.success).toBe(true);
  expect(body.topByViews).toEqual([]);
});

it('returns 502 when the daily series fails', async () => {
  mockSeries.mockResolvedValueOnce({ ok: false, error: 'series down' });
  expect((await GET(req())).status).toBe(502);
});
