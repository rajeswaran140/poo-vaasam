/** @jest-environment node */
/**
 * INTEGRATION TESTS — GET /api/admin/youtube/publish-advisor.
 * Auth + config gating, and the daily-series → advice composition for the
 * ship-now / on-schedule / let-it-ride paths.
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/youtube-analytics', () => ({
  ...jest.requireActual('@/lib/youtube-analytics'),
  isYouTubeAnalyticsConfigured: jest.fn(() => true),
  fetchDailySeries: jest.fn(),
}));

jest.mock('@/lib/youtube-api', () => ({
  ...jest.requireActual('@/lib/youtube-api'),
  isYouTubeApiConfigured: jest.fn(() => true),
  fetchChannelStats: jest.fn(),
  fetchChannelVideoStats: jest.fn(),
}));

import { GET } from '@/app/api/admin/youtube/publish-advisor/route';
import * as auth from '@/lib/auth-helper';
import * as yta from '@/lib/youtube-analytics';
import * as ytApi from '@/lib/youtube-api';

const mockAdmin = auth.requireAdmin as jest.Mock;
const mockYtaOn = yta.isYouTubeAnalyticsConfigured as jest.Mock;
const mockDaily = yta.fetchDailySeries as jest.Mock;
const mockApiOn = ytApi.isYouTubeApiConfigured as jest.Mock;
const mockChannel = ytApi.fetchChannelStats as jest.Mock;
const mockVideos = ytApi.fetchChannelVideoStats as jest.Mock;

const req = () => new NextRequest(new Request('http://localhost/api/admin/youtube/publish-advisor'));

/** 20-day series; finalized = first 19, recent window = last 7 finalized (idx 12–18). */
function series({ recentViews, priorViews, retention = 45, subs = 20 }: {
  recentViews: number;
  priorViews: number;
  retention?: number;
  subs?: number;
}) {
  const days = 20;
  return Array.from({ length: days }, (_, i) => {
    const d = new Date('2026-06-01T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    const views = i === days - 1 ? 0 : i >= days - 1 - 7 ? recentViews : priorViews;
    return {
      date: d.toISOString().slice(0, 10),
      views,
      subscribersGained: subs,
      estimatedMinutesWatched: 0,
      averageViewPercentage: retention,
    };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAdmin.mockResolvedValue({ isAuthenticated: true });
  mockYtaOn.mockReturnValue(true);
  mockApiOn.mockReturnValue(true);
  mockChannel.mockResolvedValue({ channelId: 'UC', title: 'T', subscriberCount: 928, viewCount: 1, videoCount: 71, uploadsPlaylistId: 'UU' });
  mockVideos.mockResolvedValue([{ id: 'v', title: 'v', publishedAt: '2020-01-01T00:00:00Z', thumbnail: '', viewCount: 1, likeCount: 0, commentCount: 0, duration: 'PT4M', durationSeconds: 240 }]);
  mockDaily.mockResolvedValue({ ok: true, data: series({ recentViews: 12000, priorViews: 12000 }) });
});

it('401s when not an admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockAdmin.mockRejectedValueOnce(new AuthError('Unauthorized', 401));
  expect((await GET(req())).status).toBe(401);
});

it('503s when Analytics is not configured', async () => {
  mockYtaOn.mockReturnValue(false);
  expect((await GET(req())).status).toBe(503);
});

it('502s when the daily series cannot be fetched', async () => {
  mockDaily.mockResolvedValue({ ok: false, error: 'boom' });
  expect((await GET(req())).status).toBe(502);
});

it('ship-now: reach draining + retention healthy → hero upload on Friday', async () => {
  mockDaily.mockResolvedValue({ ok: true, data: series({ recentViews: 6000, priorViews: 12000, retention: 45 }) });
  const body = await (await GET(req())).json();
  expect(body.success).toBe(true);
  expect(body.advice.verdict).toBe('ship-now');
  expect(body.advice.recommendedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(body.advice.slotLabel).toMatch(/Toronto/);
  expect(body.advice.confidence).toBe(95); // 55+15+15+5+5
  expect(body.inputs.viewsDeclining).toBe(true);
  expect(body.inputs.subsToTier2).toBe(72); // 1000 - 928
  expect(body.advice.reasons.some((r: string) => /WhatsApp/.test(r))).toBe(true);
});

it('on-schedule: flat healthy channel → publish on cadence', async () => {
  // default series is flat 12000/12000, retention 45
  const body = await (await GET(req())).json();
  expect(body.advice.verdict).toBe('on-schedule');
  expect(body.inputs.viewsDeclining).toBe(false);
  expect(body.advice.confidence).toBe(90); // 65+10+10+5
});

it('let-it-ride: published within 2 days → hold even if draining', async () => {
  mockDaily.mockResolvedValue({ ok: true, data: series({ recentViews: 6000, priorViews: 12000, retention: 45 }) });
  const todayIso = new Date().toISOString();
  mockVideos.mockResolvedValue([{ id: 'v', title: 'v', publishedAt: todayIso, thumbnail: '', viewCount: 1, likeCount: 0, commentCount: 0, duration: 'PT4M', durationSeconds: 240 }]);
  const body = await (await GET(req())).json();
  expect(body.advice.verdict).toBe('let-it-ride');
  expect(body.inputs.daysSinceLastUpload).toBeLessThanOrEqual(2);
});

it('degrades without the Data API: still advises, omits subs/recency', async () => {
  mockApiOn.mockReturnValue(false);
  mockDaily.mockResolvedValue({ ok: true, data: series({ recentViews: 6000, priorViews: 12000, retention: 45 }) });
  const body = await (await GET(req())).json();
  expect(body.success).toBe(true);
  expect(body.advice.verdict).toBe('ship-now');
  expect(body.inputs.subsToTier2).toBeNull();
  expect(body.inputs.daysSinceLastUpload).toBeNull();
  expect(body.caveats.some((c: string) => /Data API unavailable/.test(c))).toBe(true);
});
