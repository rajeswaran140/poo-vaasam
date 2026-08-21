/** @jest-environment node */
/**
 * INTEGRATION TESTS — GET /api/admin/youtube/channel-revenue-by-country.
 *
 * Mirrors the per-video /revenue-geography suite: exercises the route through
 * the real pure summary layer with auth + the network-bound analytics lib
 * mocked. The cases that matter beyond the usual gating: the undimensioned
 * totals fetch is non-fatal (its failure must NOT take the breakdown down with
 * it — the summary just reports rates as `country-attributed`), and a
 * monetary-scope 403 must surface as an error, not as silent zeros.
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/youtube-analytics', () => ({
  isYouTubeAnalyticsConfigured: jest.fn(() => true),
  fetchChannelRevenueByCountry: jest.fn(),
  fetchChannelRevenueTotals: jest.fn(),
}));

import { GET } from '@/app/api/admin/youtube/channel-revenue-by-country/route';
import * as auth from '@/lib/auth-helper';
import * as yta from '@/lib/youtube-analytics';
import type { RevenueGeoRawRow } from '@/lib/youtube-revenue-geography';

const mockRequireAdmin = auth.requireAdmin as jest.Mock;
const mockConfigured = yta.isYouTubeAnalyticsConfigured as jest.Mock;
const mockGeo = yta.fetchChannelRevenueByCountry as jest.Mock;
const mockTotals = yta.fetchChannelRevenueTotals as jest.Mock;

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
  raw({ country: 'IN', views: 58848, estimatedRevenue: 19.97, estimatedAdRevenue: 19.62, adImpressions: 72965, monetizedPlaybacks: 58848 }),
  raw({ country: 'CA', views: 2933, estimatedRevenue: 7.47, estimatedAdRevenue: 7.38, adImpressions: 3192, monetizedPlaybacks: 2933 }),
  raw({ country: 'CH', views: 845, estimatedRevenue: 4.44, estimatedAdRevenue: 4.43, adImpressions: 1196, monetizedPlaybacks: 845 }),
];

const req = (qs = '') =>
  new NextRequest(`https://tamilagaval.com/api/admin/youtube/channel-revenue-by-country${qs}`, {
    method: 'GET',
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireAdmin.mockResolvedValue({ isAuthenticated: true });
  mockConfigured.mockReturnValue(true);
  // Undimensioned channel totals: MORE views than the country rows attribute,
  // matching real behaviour where small markets bill without clearing the geo threshold.
  mockTotals.mockResolvedValue({
    ok: true,
    data: { views: 120693, estimatedRevenue: 52.34, monetizedPlaybacks: 63000 },
  });
});

describe('auth + configuration gates', () => {
  test('401 when not admin', async () => {
    mockRequireAdmin.mockRejectedValue(
      Object.assign(new Error('Unauthorized'), { name: 'AuthError', status: 401 })
    );
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  test('503 when Analytics OAuth is not configured', async () => {
    mockConfigured.mockReturnValue(false);
    const res = await GET(req());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/YOUTUBE_OAUTH/);
  });
});

describe('happy path', () => {
  test('returns the summary with per-country rows sorted by revenue', async () => {
    mockGeo.mockResolvedValue({ ok: true, data: ROWS });

    const res = await GET(req('?days=28'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.days).toBe(28);
    expect(body.hasData).toBe(true);
    // Sorted by revenue descending — IN leads even though CH has the highest CPM.
    expect(body.rows.map((r: { country: string }) => r.country)).toEqual(['IN', 'CA', 'CH']);
    // Undimensioned totals were provided, so RPM is derived from them.
    expect(body.rpmBasis).toBe('video-totals');
    // 52.34 / 120693 * 1000 ≈ 0.4336
    expect(body.rpm).toBeCloseTo(0.4336, 3);
    expect(body.countryCount).toBe(3);
    expect(body.topRevenueCountry.country).toBe('IN');
  });

  test('reports country-attributed basis when undimensioned totals fail (non-fatal)', async () => {
    mockGeo.mockResolvedValue({ ok: true, data: ROWS });
    mockTotals.mockResolvedValue({ ok: false, error: 'quota exceeded' });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.rpmBasis).toBe('country-attributed');
  });

  test('empty rows → hasData:false, no crash', async () => {
    mockGeo.mockResolvedValue({ ok: true, data: [] });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasData).toBe(false);
    expect(body.rows).toEqual([]);
    expect(body.countryCount).toBe(0);
  });
});

describe('error handling', () => {
  test('502 when the country breakdown fetch fails (e.g. monetary-scope 403)', async () => {
    mockGeo.mockResolvedValue({
      ok: false,
      error: 'PERMISSION_DENIED: yt-analytics-monetary.readonly',
    });

    const res = await GET(req());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/PERMISSION_DENIED/);
  });
});

describe('days query param', () => {
  test('defaults to 28 when omitted', async () => {
    mockGeo.mockResolvedValue({ ok: true, data: ROWS });
    await GET(req());
    expect(mockGeo).toHaveBeenCalledWith(28);
    expect(mockTotals).toHaveBeenCalledWith(28);
  });

  test('clamps out-of-range values to [1, 365]', async () => {
    mockGeo.mockResolvedValue({ ok: true, data: ROWS });

    await GET(req('?days=0'));
    expect(mockGeo).toHaveBeenLastCalledWith(1);

    jest.clearAllMocks();
    mockRequireAdmin.mockResolvedValue({ isAuthenticated: true });
    mockConfigured.mockReturnValue(true);
    mockTotals.mockResolvedValue({
      ok: true,
      data: { views: 1, estimatedRevenue: 0, monetizedPlaybacks: 0 },
    });
    mockGeo.mockResolvedValue({ ok: true, data: ROWS });
    await GET(req('?days=9999'));
    expect(mockGeo).toHaveBeenLastCalledWith(365);
  });

  test('falls back to 28 on non-numeric days', async () => {
    mockGeo.mockResolvedValue({ ok: true, data: ROWS });
    await GET(req('?days=abc'));
    expect(mockGeo).toHaveBeenCalledWith(28);
  });
});
