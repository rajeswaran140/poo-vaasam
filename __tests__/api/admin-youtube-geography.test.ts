/** @jest-environment node */
/**
 * INTEGRATION TESTS — GET /api/admin/youtube/geography.
 *
 * Exercises the route through the real pure summary layer, with auth + the
 * network-bound analytics lib mocked. Covers auth gating, the env-not-configured
 * gate, the videoId requirement, the happy-path country decoration, the
 * low-view empty path, and upstream failure.
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/youtube-analytics', () => ({
  isYouTubeAnalyticsConfigured: jest.fn(() => true),
  fetchVideoGeography: jest.fn(),
}));

import { GET } from '@/app/api/admin/youtube/geography/route';
import * as auth from '@/lib/auth-helper';
import * as yta from '@/lib/youtube-analytics';
import type { GeographyRawRow } from '@/lib/youtube-geography';

const mockRequireAdmin = auth.requireAdmin as jest.Mock;
const mockConfigured = yta.isYouTubeAnalyticsConfigured as jest.Mock;
const mockGeo = yta.fetchVideoGeography as jest.Mock;

const ROWS: GeographyRawRow[] = [
  { country: 'CA', views: 25, estimatedMinutesWatched: 74, averageViewDuration: 178, averageViewPercentage: 44.29 },
  { country: 'IN', views: 149, estimatedMinutesWatched: 379, averageViewDuration: 152, averageViewPercentage: 37.88 },
];

const req = (qs: string) =>
  new NextRequest(`https://tamilagaval.com/api/admin/youtube/geography${qs}`, { method: 'GET' });

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireAdmin.mockResolvedValue({ isAuthenticated: true });
  mockConfigured.mockReturnValue(true);
});

it('returns 403 when not admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockRequireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  expect((await GET(req('?videoId=aaaaaaaaaaa'))).status).toBe(403);
  expect(mockGeo).not.toHaveBeenCalled();
});

it('returns 503 when Analytics OAuth is not configured', async () => {
  mockConfigured.mockReturnValueOnce(false);
  const res = await GET(req('?videoId=aaaaaaaaaaa'));
  expect(res.status).toBe(503);
  expect(mockGeo).not.toHaveBeenCalled();
});

it('returns 400 when videoId is missing', async () => {
  const res = await GET(req(''));
  expect(res.status).toBe(400);
  expect((await res.json()).error).toMatch(/videoId/);
});

it('returns 400 for a malformed videoId (not 11 url-safe chars)', async () => {
  const res = await GET(req('?videoId=not-valid'));
  expect(res.status).toBe(400);
  expect((await res.json()).error).toMatch(/invalid videoId/);
  expect(mockGeo).not.toHaveBeenCalled();
});

it('decorates + ranks countries on the happy path', async () => {
  mockGeo.mockResolvedValueOnce({ ok: true, data: ROWS });
  const res = await GET(req('?videoId=Song1234567'));
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.success).toBe(true);
  expect(body.hasData).toBe(true);
  // sorted by views desc, share computed, names/flags added
  expect(body.rows.map((r: { country: string }) => r.country)).toEqual(['IN', 'CA']);
  expect(body.rows[0].countryName).toBe('India');
  expect(body.rows[0].flag).toBe('🇮🇳');
  expect(body.totalAttributedViews).toBe(174);
  expect(body.topCountry.country).toBe('IN');
  // clamps the day window and passes it through
  expect(mockGeo).toHaveBeenCalledWith('Song1234567', 90);
});

it('clamps the days param to [1,365]', async () => {
  mockGeo.mockResolvedValue({ ok: true, data: ROWS });
  await GET(req('?videoId=Song1234567&days=9999'));
  expect(mockGeo).toHaveBeenLastCalledWith('Song1234567', 365);
  await GET(req('?videoId=Song1234567&days=0'));
  expect(mockGeo).toHaveBeenLastCalledWith('Song1234567', 1);
});

it('treats a low-view video (no rows) as hasData:false', async () => {
  mockGeo.mockResolvedValueOnce({ ok: true, data: [] });
  const res = await GET(req('?videoId=NewNewNew12'));
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.hasData).toBe(false);
  expect(body.rows).toEqual([]);
  expect(body.topCountry).toBeNull();
});

it('returns 502 when the analytics fetch fails', async () => {
  mockGeo.mockResolvedValueOnce({ ok: false, error: 'Analytics API 500: boom' });
  const res = await GET(req('?videoId=ErrErrErr12'));
  expect(res.status).toBe(502);
  expect((await res.json()).error).toMatch(/boom/);
});
