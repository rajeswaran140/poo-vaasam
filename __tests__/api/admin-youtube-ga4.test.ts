/** @jest-environment node */
/**
 * Tests for GET /api/admin/youtube/ga4 — auth gate + 503 when GA4 isn't
 * configured + happy path returns the aggregated payload.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/ga4-api', () => ({
  isGA4Configured: jest.fn(),
  fetchSubscribeClicksBySource: jest.fn(),
  fetchTrafficSnapshot: jest.fn(),
}));

import { GET } from '@/app/api/admin/youtube/ga4/route';
import * as auth from '@/lib/auth-helper';
import * as ga4 from '@/lib/ga4-api';

const mockedRequireAdmin = auth.requireAdmin as jest.Mock;
const mockedIsConfigured = ga4.isGA4Configured as jest.Mock;
const mockedClicks = ga4.fetchSubscribeClicksBySource as jest.Mock;
const mockedTraffic = ga4.fetchTrafficSnapshot as jest.Mock;

const req = (qs = '') =>
  new NextRequest(`https://tamilagaval.com/api/admin/youtube/ga4${qs}`);

beforeEach(() => {
  jest.clearAllMocks();
  mockedRequireAdmin.mockResolvedValue({ isAuthenticated: true, email: 'admin@example.com' });
});

it('rejects with 403 when caller is not admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockedRequireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  const res = await GET(req());
  expect(res.status).toBe(403);
  expect(mockedClicks).not.toHaveBeenCalled();
  expect(mockedTraffic).not.toHaveBeenCalled();
});

it('returns 503 when GA4 is not configured', async () => {
  mockedIsConfigured.mockReturnValue(false);
  const res = await GET(req());
  expect(res.status).toBe(503);
  const body = await res.json();
  expect(body.error).toMatch(/GA4_PROPERTY_ID|GA4_SERVICE_ACCOUNT_KEY/);
});

it('clamps `days` to the 1..90 range', async () => {
  mockedIsConfigured.mockReturnValue(true);
  mockedClicks.mockResolvedValue({ ok: true, data: [] });
  mockedTraffic.mockResolvedValue({ ok: false, error: 'no data' });

  await GET(req('?days=500'));
  expect(mockedClicks).toHaveBeenCalledWith(90);

  await GET(req('?days=0'));
  expect(mockedClicks).toHaveBeenLastCalledWith(1);
});

it('returns aggregated payload on happy path', async () => {
  mockedIsConfigured.mockReturnValue(true);
  mockedClicks.mockResolvedValue({
    ok: true,
    data: [
      { source: 'home_hero', eventCount: 42 },
      { source: 'floater', eventCount: 17 },
    ],
  });
  mockedTraffic.mockResolvedValue({
    ok: true,
    data: { totalUsers: 500, sessions: 750, pageViews: 1800, daysBack: 28 },
  });

  const res = await GET(req('?days=28'));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.days).toBe(28);
  expect(body.subscribeClicks.ok).toBe(true);
  expect(body.subscribeClicks.data).toHaveLength(2);
  expect(body.traffic.ok).toBe(true);
  expect(body.traffic.data.totalUsers).toBe(500);
  // Both upstream calls fired in parallel.
  expect(mockedClicks).toHaveBeenCalledTimes(1);
  expect(mockedTraffic).toHaveBeenCalledTimes(1);
});
