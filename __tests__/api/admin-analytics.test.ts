/** @jest-environment node */
/**
 * GET /api/admin/analytics — admin gating, the GA4-unconfigured branch (still
 * serves first-party views), and the happy path (GA4 results unwrapped, errors
 * surfaced per-section).
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/ga4-api', () => ({
  isGA4Configured: jest.fn(),
  fetchTrafficSnapshot: jest.fn(),
  fetchTrafficTimeseries: jest.fn(),
  fetchTopPages: jest.fn(),
  fetchTrafficSources: jest.fn(),
  fetchGeo: jest.fn(),
  fetchDevices: jest.fn(),
  fetchAudioPlays: jest.fn(),
  fetchSubscribeClicksBySource: jest.fn(),
  fetchYouTubeOpens: jest.fn(),
}));

jest.mock('@/lib/site-analytics', () => ({
  fetchContentViewSummary: jest.fn(),
}));

import { GET } from '@/app/api/admin/analytics/route';
import * as auth from '@/lib/auth-helper';
import * as ga4 from '@/lib/ga4-api';
import * as site from '@/lib/site-analytics';

const requireAdmin = auth.requireAdmin as jest.Mock;
const isConfigured = ga4.isGA4Configured as jest.Mock;
const contentSummary = site.fetchContentViewSummary as jest.Mock;

const req = (days?: number) =>
  new NextRequest(`https://tamilagaval.com/api/admin/analytics${days ? `?days=${days}` : ''}`);

const SUMMARY = { totalViews: 52, itemCount: 3, top: [{ id: 'cnt_a', title: 'A', type: 'POEMS', path: '/content/cnt_a', viewCount: 40 }] };

beforeEach(() => {
  jest.clearAllMocks();
  requireAdmin.mockResolvedValue({ sub: 'admin' });
  contentSummary.mockResolvedValue(SUMMARY);
});

it('rejects non-admins (does not call GA4)', async () => {
  requireAdmin.mockRejectedValue(new Error('Unauthorized'));
  const res = await GET(req());
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(isConfigured).not.toHaveBeenCalled();
});

it('when GA4 is not configured, still returns first-party content views', async () => {
  isConfigured.mockReturnValue(false);
  const res = await GET(req());
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.ga4Configured).toBe(false);
  expect(body.ga4).toBeNull();
  expect(body.contentViews).toEqual(SUMMARY);
});

it('happy path: unwraps GA4 results and surfaces per-section errors', async () => {
  isConfigured.mockReturnValue(true);
  (ga4.fetchTrafficSnapshot as jest.Mock).mockResolvedValue({ ok: true, data: { totalUsers: 100, sessions: 120, pageViews: 300, daysBack: 28 } });
  (ga4.fetchTrafficTimeseries as jest.Mock).mockResolvedValue({ ok: true, data: { points: [{ date: '2026-06-12', users: 5, sessions: 6, pageViews: 9 }], daysBack: 28 } });
  (ga4.fetchTopPages as jest.Mock).mockResolvedValue({ ok: true, data: [{ path: '/songs', title: 'Songs', pageViews: 40 }] });
  (ga4.fetchTrafficSources as jest.Mock).mockResolvedValue({ ok: true, data: [{ key: 'Organic Search', value: 30 }] });
  (ga4.fetchGeo as jest.Mock).mockResolvedValue({ ok: true, data: [{ key: 'India', value: 80 }] });
  (ga4.fetchDevices as jest.Mock).mockResolvedValue({ ok: true, data: [{ key: 'mobile', value: 90 }] });
  (ga4.fetchAudioPlays as jest.Mock).mockResolvedValue({ ok: true, data: { rows: [{ label: 'எங்கள் தேசம்', eventCount: 7 }], total: 7 } });
  (ga4.fetchSubscribeClicksBySource as jest.Mock).mockResolvedValue({ ok: true, data: { rows: [], total: 3 } });
  (ga4.fetchYouTubeOpens as jest.Mock).mockResolvedValue({ ok: false, error: 'PERMISSION_DENIED' });

  const res = await GET(req(7));
  const body = await res.json();

  expect(res.status).toBe(200);
  expect(body.ga4Configured).toBe(true);
  expect(body.days).toBe(7);
  expect(body.contentViews).toEqual(SUMMARY);
  expect(body.ga4.snapshot).toEqual({ data: { totalUsers: 100, sessions: 120, pageViews: 300, daysBack: 28 } });
  expect(body.ga4.geo).toEqual({ data: [{ key: 'India', value: 80 }] });
  // A failed section is surfaced as { error }, not swallowed.
  expect(body.ga4.youtubeOpens).toEqual({ error: 'PERMISSION_DENIED' });
});

it('clamps the days param to 1..90', async () => {
  isConfigured.mockReturnValue(false);
  const body = await (await GET(req(999))).json();
  expect(body.days).toBe(90);
});
