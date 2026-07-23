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

jest.mock('@/lib/analytics-store', () => ({
  fetchEventSummary: jest.fn(),
}));

import { GET } from '@/app/api/admin/analytics/route';
import * as auth from '@/lib/auth-helper';
import * as ga4 from '@/lib/ga4-api';
import * as site from '@/lib/site-analytics';
import * as store from '@/lib/analytics-store';
import { clearCache } from '@/lib/ttl-cache';

const requireAdmin = auth.requireAdmin as jest.Mock;
const isConfigured = ga4.isGA4Configured as jest.Mock;
const contentSummary = site.fetchContentViewSummary as jest.Mock;
const eventSummary = store.fetchEventSummary as jest.Mock;

const req = (days?: number) =>
  new NextRequest(`https://tamilagaval.com/api/admin/analytics${days ? `?days=${days}` : ''}`);

const SUMMARY = {
  totalViews: 52,
  itemCount: 3,
  top: [{ id: 'cnt_a', title: 'A', type: 'POEMS', path: '/content/cnt_a', viewCount: 40 }],
  titleById: { cnt_a: 'A', cnt_b: 'நிலா' },
};

const EVENTS = {
  total: 14,
  totals: [{ type: 'share', count: 10 }, { type: 'inbound', count: 4 }],
  byType: {
    share: [{ target: 'whatsapp', count: 10 }],
    share_song: [{ target: 'cnt_b', count: 7 }],
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  clearCache(); // module-level memo would otherwise leak between tests
  requireAdmin.mockResolvedValue({ sub: 'admin' });
  contentSummary.mockResolvedValue(SUMMARY);
  eventSummary.mockResolvedValue(EVENTS);
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

// The first-party event block was previously unasserted here and rendered with
// a null fixture in the page test — which is how the derived-type double-count
// shipped unnoticed.
describe('first-party events', () => {
  it('returns the event summary alongside the GA4 sections', async () => {
    isConfigured.mockReturnValue(false);
    const body = await (await GET(req(28))).json();
    expect(body.events).toEqual(EVENTS);
    expect(eventSummary).toHaveBeenCalledWith(28, 8);
  });

  it('passes the requested range through to the event query', async () => {
    isConfigured.mockReturnValue(false);
    await GET(req(7));
    expect(eventSummary).toHaveBeenCalledWith(7, 8);
  });

  it('exposes songTitles so per-song counters render as titles, not cnt_ ids', async () => {
    isConfigured.mockReturnValue(false);
    const body = await (await GET(req())).json();
    expect(body.songTitles).toEqual({ cnt_a: 'A', cnt_b: 'நிலா' });
  });

  it('still serves the rest when the event store fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    isConfigured.mockReturnValue(false);
    eventSummary.mockRejectedValue(new Error('ProvisionedThroughputExceeded'));
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.events).toBeNull();
    expect(body.contentViews).toEqual(SUMMARY);
  });
});

// GA4 allows only 10 concurrent requests per property and one load fans out to
// 9, so an uncached toggle/refresh could exhaust the quota and blank the cards.
describe('caching', () => {
  it('serves a repeat load from cache instead of re-running the fan-out', async () => {
    isConfigured.mockReturnValue(true);
    for (const fn of [
      ga4.fetchTrafficSnapshot, ga4.fetchTrafficTimeseries, ga4.fetchTopPages,
      ga4.fetchTrafficSources, ga4.fetchGeo, ga4.fetchDevices,
      ga4.fetchAudioPlays, ga4.fetchSubscribeClicksBySource, ga4.fetchYouTubeOpens,
    ]) (fn as jest.Mock).mockResolvedValue({ ok: true, data: {} });

    await GET(req(28));
    await GET(req(28));

    expect(ga4.fetchTrafficSnapshot).toHaveBeenCalledTimes(1);
    expect(contentSummary).toHaveBeenCalledTimes(1);
    expect(eventSummary).toHaveBeenCalledTimes(1);
  });

  it('caches per range, so switching to 7d still fetches', async () => {
    isConfigured.mockReturnValue(false);
    await GET(req(28));
    await GET(req(7));
    expect(eventSummary).toHaveBeenCalledTimes(2);
    expect(eventSummary).toHaveBeenNthCalledWith(1, 28, 8);
    expect(eventSummary).toHaveBeenNthCalledWith(2, 7, 8);
  });
});
