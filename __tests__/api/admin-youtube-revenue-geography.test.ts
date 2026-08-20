/** @jest-environment node */
/**
 * INTEGRATION TESTS — GET /api/admin/youtube/revenue-geography.
 *
 * Exercises the route through the real pure summary layer, with auth + the
 * network-bound analytics lib mocked. The cases that matter beyond the usual
 * gating: the channel baseline is fetched in parallel and its failure must NOT
 * take the breakdown down with it, and a monetary-scope 403 must surface as an
 * error rather than as a page full of zeros.
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/youtube-analytics', () => ({
  isYouTubeAnalyticsConfigured: jest.fn(() => true),
  fetchVideoRevenueGeography: jest.fn(),
  fetchVideoRevenueTotals: jest.fn(),
  fetchChannelRpm: jest.fn(),
}));

import { GET } from '@/app/api/admin/youtube/revenue-geography/route';
import * as auth from '@/lib/auth-helper';
import * as yta from '@/lib/youtube-analytics';
import type { RevenueGeoRawRow } from '@/lib/youtube-revenue-geography';

const mockRequireAdmin = auth.requireAdmin as jest.Mock;
const mockConfigured = yta.isYouTubeAnalyticsConfigured as jest.Mock;
const mockGeo = yta.fetchVideoRevenueGeography as jest.Mock;
const mockTotals = yta.fetchVideoRevenueTotals as jest.Mock;
const mockBaseline = yta.fetchChannelRpm as jest.Mock;

const raw = (over: Partial<RevenueGeoRawRow>): RevenueGeoRawRow => ({
  country: 'IN',
  views: 0,
  estimatedRevenue: 0,
  estimatedAdRevenue: 0,
  estimatedRedPartnerRevenue: 0,
  adImpressions: 0,
  monetizedPlaybacks: 0,
  ...over,
});

const ROWS: RevenueGeoRawRow[] = [
  raw({ country: 'IN', views: 900, estimatedRevenue: 1, estimatedAdRevenue: 1, adImpressions: 700, monetizedPlaybacks: 600 }),
  raw({ country: 'CA', views: 100, estimatedRevenue: 4, estimatedAdRevenue: 3.9, estimatedRedPartnerRevenue: 0.1, adImpressions: 120, monetizedPlaybacks: 90 }),
];

const req = (qs: string) =>
  new NextRequest(`https://tamilagaval.com/api/admin/youtube/revenue-geography${qs}`, { method: 'GET' });

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireAdmin.mockResolvedValue({ isAuthenticated: true });
  mockConfigured.mockReturnValue(true);
  mockBaseline.mockResolvedValue({ ok: true, data: { views: 131269, estimatedRevenue: 56.1, rpm: 0.4274 } });
  // Undimensioned video totals: MORE views than the country rows attribute,
  // which is the normal case and the reason this call exists.
  mockTotals.mockResolvedValue({
    ok: true,
    data: { views: 1250, estimatedRevenue: 5, monetizedPlaybacks: 690 },
  });
});

it('returns 403 when not admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockRequireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  expect((await GET(req('?videoId=aaaaaaaaaaa'))).status).toBe(403);
  expect(mockGeo).not.toHaveBeenCalled();
});

it('returns 503 when Analytics OAuth is not configured', async () => {
  mockConfigured.mockReturnValueOnce(false);
  expect((await GET(req('?videoId=aaaaaaaaaaa'))).status).toBe(503);
  expect(mockGeo).not.toHaveBeenCalled();
});

it('returns 400 for a missing or malformed videoId', async () => {
  expect((await GET(req(''))).status).toBe(400);
  expect((await GET(req('?videoId=not-valid'))).status).toBe(400);
  expect(mockGeo).not.toHaveBeenCalled();
});

it('ranks countries by revenue and derives the value signals', async () => {
  mockGeo.mockResolvedValueOnce({ ok: true, data: ROWS });
  const res = await GET(req('?videoId=Song1234567'));
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.success).toBe(true);
  expect(body.hasData).toBe(true);
  // Canada earns 4x India on a ninth of the views — the money leads the list.
  expect(body.rows.map((r: { country: string }) => r.country)).toEqual(['CA', 'IN']);
  expect(body.rows[0].countryName).toBe('Canada');
  expect(body.rows[0].valueIndex).toBeCloseTo(80 / 10, 4);
  expect(body.rows[1].valueIndex).toBeCloseTo(20 / 90, 4);
  // Blended RPM over the UNDIMENSIONED 1,250 views, not the 1,000 the country
  // rows attribute. NOT the mean of the two country RPMs either.
  expect(body.rpm).toBeCloseTo(5 / 1250 * 1000, 6);
  expect(body.rpmBasis).toBe('video-totals');
  expect(body.attributedViews).toBe(1000);
  expect(body.totalViews).toBe(1250);
  expect(body.rpmIndex).toBeCloseTo(4 / 0.4274, 4);
  expect(body.channelRpm).toBeCloseTo(0.4274, 6);
  expect(body.monetizedPlaybackRate).toBeCloseTo(690 / 1250, 6);
  expect(body.servingAds).toBe(true);
  expect(mockGeo).toHaveBeenCalledWith('Song1234567', 28);
  expect(mockTotals).toHaveBeenCalledWith('Song1234567', 28);
  expect(mockBaseline).toHaveBeenCalledWith(28);
});

it('falls back to country-attributed rates, flagged, when the totals call fails', async () => {
  mockGeo.mockResolvedValueOnce({ ok: true, data: ROWS });
  mockTotals.mockResolvedValueOnce({ ok: false, error: 'Analytics API 500: boom' });
  const body = await (await GET(req('?videoId=Song1234567'))).json();
  expect(body.success).toBe(true);
  expect(body.rpmBasis).toBe('country-attributed');
  expect(body.totalViews).toBe(1000); // the attributed sum
  expect(body.rows).toHaveLength(2);
});

it('clamps the days param to [1,365] on BOTH the video and the baseline call', async () => {
  mockGeo.mockResolvedValue({ ok: true, data: ROWS });
  await GET(req('?videoId=Song1234567&days=9999'));
  expect(mockGeo).toHaveBeenLastCalledWith('Song1234567', 365);
  // A baseline or totals call over a different window than the song would make
  // rpm/rpmIndex a comparison between two different periods.
  expect(mockTotals).toHaveBeenLastCalledWith('Song1234567', 365);
  expect(mockBaseline).toHaveBeenLastCalledWith(365);
  await GET(req('?videoId=Song1234567&days=0'));
  expect(mockGeo).toHaveBeenLastCalledWith('Song1234567', 1);
  expect(mockTotals).toHaveBeenLastCalledWith('Song1234567', 1);
  expect(mockBaseline).toHaveBeenLastCalledWith(1);
});

it('still returns the breakdown when the channel baseline fails, with rpmIndex null', async () => {
  mockGeo.mockResolvedValueOnce({ ok: true, data: ROWS });
  mockBaseline.mockResolvedValueOnce({ ok: false, error: 'Analytics API 500: boom' });
  const res = await GET(req('?videoId=Song1234567'));
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.hasData).toBe(true);
  expect(body.rows).toHaveLength(2);
  expect(body.rpmIndex).toBeNull();
  expect(body.channelRpm).toBeNull();
});

it('reports rpmIndex null when the channel had no views to baseline against', async () => {
  mockGeo.mockResolvedValueOnce({ ok: true, data: ROWS });
  mockBaseline.mockResolvedValueOnce({ ok: true, data: { views: 0, estimatedRevenue: 0, rpm: null } });
  const body = await (await GET(req('?videoId=Song1234567'))).json();
  expect(body.rpmIndex).toBeNull();
  expect(body.channelRpm).toBeNull();
});

it('flags a song that served no ads at all', async () => {
  mockGeo.mockResolvedValueOnce({
    ok: true,
    data: [raw({ country: 'IN', views: 5000, adImpressions: 0, monetizedPlaybacks: 0 })],
  });
  const body = await (await GET(req('?videoId=AdFreeSong1'))).json();
  expect(body.servingAds).toBe(false);
  expect(body.totalAdImpressions).toBe(0);
});

it('treats a video with no revenue rows as hasData:false', async () => {
  mockGeo.mockResolvedValueOnce({ ok: true, data: [] });
  const body = await (await GET(req('?videoId=NewNewNew12'))).json();
  expect(body.hasData).toBe(false);
  expect(body.rows).toEqual([]);
  expect(body.topRevenueCountry).toBeNull();
});

it('surfaces a monetary-scope failure as 502 rather than as zeros', async () => {
  // Zeros would read as "this song earns nothing" — a different, wrong answer.
  mockGeo.mockResolvedValueOnce({
    ok: false,
    error: 'Analytics API 403: insufficient scopes (yt-analytics-monetary.readonly)',
  });
  const res = await GET(req('?videoId=ErrErrErr12'));
  expect(res.status).toBe(502);
  expect((await res.json()).error).toMatch(/monetary/);
});
