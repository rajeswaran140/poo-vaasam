/** @jest-environment node */
/**
 * INTEGRATION TESTS — GET /api/admin/youtube/forecast.
 * Auth gating, forecast composition over the stored series, and graceful
 * degradation (short history / missing subscriber count never 500s).
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/youtube-metrics-history', () => ({
  readChannelMetricSeries: jest.fn(),
}));

jest.mock('@/lib/youtube-api', () => ({
  fetchChannelStats: jest.fn(),
}));

import { GET } from '@/app/api/admin/youtube/forecast/route';
import * as auth from '@/lib/auth-helper';
import * as hist from '@/lib/youtube-metrics-history';
import * as ytApi from '@/lib/youtube-api';

const mockRequireAdmin = auth.requireAdmin as jest.Mock;
const mockSeries = hist.readChannelMetricSeries as jest.Mock;
const mockStats = ytApi.fetchChannelStats as jest.Mock;

const req = (qs = '') =>
  new NextRequest(new Request(`http://localhost/api/admin/youtube/forecast${qs}`));

/** 14 days of steady +10 net subs / 500 views. */
const steadySeries = () =>
  Array.from({ length: 14 }, (_, i) => ({
    scope: 'CHANNEL',
    date: `2026-07-${String(1 + i).padStart(2, '0')}`,
    views: 500,
    estimatedMinutesWatched: 1000,
    subscribersGained: 10,
    subscribersLost: 0,
    netSubscribers: 10,
    capturedAt: '2026-07-15T00:00:00.000Z',
  }));

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireAdmin.mockResolvedValue({ isAuthenticated: true });
  mockSeries.mockResolvedValue(steadySeries());
  mockStats.mockResolvedValue({ subscriberCount: 922, viewCount: 226730, videoCount: 71 });
});

it('401s when not an admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockRequireAdmin.mockRejectedValueOnce(new AuthError('Unauthorized', 401));
  const res = await GET(req());
  expect(res.status).toBe(401);
});

it('forecasts days-to-target with the default 1000 gate', async () => {
  const res = await GET(req());
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.target).toBe(1000);
  expect(body.current).toBe(922);
  expect(body.forecast.remaining).toBe(78);
  expect(body.forecast.etaDays).toBe(8); // ceil(78/10)
  expect(body.forecast.reachable).toBe(true);
  expect(body.notes.forecastAvailable).toBe(true);
});

it('honours a custom target', async () => {
  const res = await GET(req('?target=2000'));
  const body = await res.json();
  expect(body.target).toBe(2000);
  expect(body.forecast.remaining).toBe(1078);
  expect(body.forecast.etaDays).toBe(108); // ceil(1078/10)
});

it('degrades to no-forecast (not 500) when the subscriber count is unavailable', async () => {
  mockStats.mockResolvedValue(null);
  const res = await GET(req());
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.current).toBeNull();
  expect(body.forecast).toBeNull();
  expect(body.notes.subscriberCountAvailable).toBe(false);
  // change reads don't need the subscriber count, so they still compute.
  expect(body.viewsChange).not.toBeNull();
});

it('degrades to no-forecast when history is too short', async () => {
  mockSeries.mockResolvedValue(steadySeries().slice(0, 3));
  const res = await GET(req());
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.forecast).toBeNull();
  expect(body.notes.enoughHistory).toBe(false);
});

it('clamps an out-of-range window instead of failing', async () => {
  const res = await GET(req('?window=999'));
  const body = await res.json();
  expect(body.window).toBe(90); // clamped to max
});
