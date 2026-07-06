/** @jest-environment node */
/**
 * INTEGRATION TESTS — GET /api/admin/youtube/monetization.
 * Auth gating, YPP gate computation, graceful revenue 403 pass-through
 * (monetary scope missing), and partial-failure degradation (never 500).
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/youtube-analytics', () => ({
  isYouTubeAnalyticsConfigured: jest.fn(() => true),
  fetchChannelAnalyticsSnapshot: jest.fn(),
  fetchEstimatedRevenue: jest.fn(),
}));

jest.mock('@/lib/youtube-api', () => ({
  fetchChannelStats: jest.fn(),
}));

import { GET } from '@/app/api/admin/youtube/monetization/route';
import * as auth from '@/lib/auth-helper';
import * as yta from '@/lib/youtube-analytics';
import * as ytApi from '@/lib/youtube-api';

const mockRequireAdmin = auth.requireAdmin as jest.Mock;
const mockConfigured = yta.isYouTubeAnalyticsConfigured as jest.Mock;
const mockSnapshot = yta.fetchChannelAnalyticsSnapshot as jest.Mock;
const mockRevenue = yta.fetchEstimatedRevenue as jest.Mock;
const mockStats = ytApi.fetchChannelStats as jest.Mock;

const req = () => new NextRequest(new Request('http://localhost/api/admin/youtube/monetization'));

const snapshot = (over: Record<string, number> = {}) => ({
  ok: true,
  data: {
    views: 0,
    estimatedMinutesWatched: 0,
    averageViewDuration: 0,
    subscribersGained: 0,
    subscribersLost: 0,
    daysBack: 28,
    ...over,
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireAdmin.mockResolvedValue({ isAuthenticated: true });
  mockConfigured.mockReturnValue(true);
  mockStats.mockResolvedValue({ subscriberCount: 710, viewCount: 63500, videoCount: 41 });
  // 365-day watch-hours snapshot (estimatedMinutesWatched / 60 = 4899 hrs)
  mockSnapshot.mockImplementation((days: number) =>
    Promise.resolve(
      days >= 365
        ? snapshot({ estimatedMinutesWatched: 4899 * 60, daysBack: 365 })
        : snapshot({ estimatedMinutesWatched: 20 * 60 * 28, subscribersGained: 100, subscribersLost: 16 })
    )
  );
  // Revenue 403s without the monetary scope.
  mockRevenue.mockResolvedValue({ ok: false, error: 'Analytics API 403: insufficient scope' });
});

it('401s when not an admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockRequireAdmin.mockRejectedValueOnce(new AuthError('Unauthorized', 401));
  const res = await GET(req());
  expect(res.status).toBe(401);
  expect(mockStats).not.toHaveBeenCalled();
});

it('computes gates, passes revenue error through, returns subs (happy path)', async () => {
  const res = await GET(req());
  expect(res.status).toBe(200);
  const body = await res.json();

  expect(body.success).toBe(true);
  expect(body.subscribers).toBe(710);
  expect(body.watchHours365).toBe(4899);
  expect(body.configured).toBe(true);

  // Tier1 fully met (710>500, 4899>3000); Tier2 subs not met, hours met.
  expect(body.gates.tier1.met).toBe(true);
  expect(body.gates.tier2.subs.met).toBe(false);
  expect(body.gates.tier2.hours.met).toBe(true);
  expect(body.gates.tier2.met).toBe(false);

  // pace: netSubsPerDay = (100-16)/28 = 3; watchHoursPerDay = (20*60*28/60)/28 = 20
  expect(body.pace.netSubsPerDay).toBeCloseTo(3, 5);
  expect(body.pace.watchHoursPerDay).toBeCloseTo(20, 5);

  // Revenue degraded gracefully — monetary scope missing.
  expect(body.revenue).toEqual({ ok: false, error: expect.stringContaining('403') });
});

it('passes through real revenue when the monetary scope is present', async () => {
  mockRevenue.mockResolvedValueOnce({ ok: true, data: { estimatedRevenue: 12.34, days: 28 } });
  const res = await GET(req());
  const body = await res.json();
  expect(body.revenue).toEqual({ ok: true, data: { estimatedRevenue: 12.34, days: 28 } });
});

it('degrades to subs-only + flag when Analytics is not configured (never 500)', async () => {
  mockConfigured.mockReturnValue(false);
  mockSnapshot.mockResolvedValue({ ok: false, error: 'not configured' });
  mockRevenue.mockResolvedValue({ ok: false, error: 'not configured' });
  const res = await GET(req());
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.configured).toBe(false);
  expect(body.subscribers).toBe(710); // Data API still works
  expect(body.watchHours365).toBeNull();
  expect(body.pace).toBeNull();
  // Gates still computed off subs (hours axis at 0) so the subs tracker renders.
  expect(body.gates.tier1.subs.current).toBe(710);
});

it('never 500s when the Data API also fails', async () => {
  mockStats.mockResolvedValueOnce(null);
  mockSnapshot.mockResolvedValue({ ok: false, error: 'boom' });
  const res = await GET(req());
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.subscribers).toBeNull();
  expect(body.gates).toBeNull();
});
