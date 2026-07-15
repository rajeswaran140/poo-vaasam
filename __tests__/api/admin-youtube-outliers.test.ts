/** @jest-environment node */
/**
 * INTEGRATION TESTS — GET /api/admin/youtube/outliers.
 * Auth + config gating, happy-path ranking, and graceful degradation when the
 * Analytics enrichment is unavailable (score renormalizes, no 500).
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/youtube-api', () => ({
  ...jest.requireActual('@/lib/youtube-api'),
  isYouTubeApiConfigured: jest.fn(() => true),
  fetchChannelStats: jest.fn(),
  fetchChannelVideoStats: jest.fn(),
}));

jest.mock('@/lib/youtube-analytics', () => ({
  ...jest.requireActual('@/lib/youtube-analytics'),
  isYouTubeAnalyticsConfigured: jest.fn(() => true),
  fetchVideoAnalytics: jest.fn(),
}));

import { GET } from '@/app/api/admin/youtube/outliers/route';
import * as auth from '@/lib/auth-helper';
import * as ytApi from '@/lib/youtube-api';
import * as yta from '@/lib/youtube-analytics';

const mockAdmin = auth.requireAdmin as jest.Mock;
const mockApiConfigured = ytApi.isYouTubeApiConfigured as jest.Mock;
const mockChannel = ytApi.fetchChannelStats as jest.Mock;
const mockVideos = ytApi.fetchChannelVideoStats as jest.Mock;
const mockAnalyticsConfigured = yta.isYouTubeAnalyticsConfigured as jest.Mock;
const mockVideoAnalytics = yta.fetchVideoAnalytics as jest.Mock;

const req = (qs = '') =>
  new NextRequest(new Request(`http://localhost/api/admin/youtube/outliers${qs}`));

// A catalogue where one video (breakout) has a far-higher lifetime view count.
function videos() {
  const mk = (id: string, views: number, comments: number) => ({
    id,
    title: id,
    publishedAt: '2026-01-01T00:00:00Z', // same age → viewsPerDay tracks views
    thumbnail: '',
    viewCount: views,
    likeCount: 0,
    commentCount: comments,
    duration: 'PT4M',
    durationSeconds: 240,
  });
  return [
    mk('normal1', 10000, 10),
    mk('normal2', 10000, 10),
    mk('normal3', 10000, 10),
    mk('normal4', 10000, 10),
    mk('breakout', 100000, 100),
  ];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAdmin.mockResolvedValue({ isAuthenticated: true });
  mockApiConfigured.mockReturnValue(true);
  mockAnalyticsConfigured.mockReturnValue(true);
  mockChannel.mockResolvedValue({
    channelId: 'UCZCuphXleq-mXVYgvqh-OlQ',
    title: 'Tamilagaval',
    subscriberCount: 928,
    viewCount: 229889,
    videoCount: 71,
    uploadsPlaylistId: 'UU...',
  });
  mockVideos.mockResolvedValue(videos());
  mockVideoAnalytics.mockResolvedValue({
    ok: true,
    data: [
      { videoId: 'breakout', views: 90000, estimatedMinutesWatched: 0, averageViewDuration: 160, subscribersGained: 900 },
      { videoId: 'normal1', views: 9000, estimatedMinutesWatched: 0, averageViewDuration: 100, subscribersGained: 20 },
      { videoId: 'normal2', views: 9000, estimatedMinutesWatched: 0, averageViewDuration: 100, subscribersGained: 20 },
      { videoId: 'normal3', views: 9000, estimatedMinutesWatched: 0, averageViewDuration: 100, subscribersGained: 20 },
      { videoId: 'normal4', views: 9000, estimatedMinutesWatched: 0, averageViewDuration: 100, subscribersGained: 20 },
    ],
  });
});

it('401s when not an admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockAdmin.mockRejectedValueOnce(new AuthError('Unauthorized', 401));
  expect((await GET(req())).status).toBe(401);
});

it('503s when the Data API key is not configured', async () => {
  mockApiConfigured.mockReturnValue(false);
  expect((await GET(req())).status).toBe(503);
});

it('502s when the channel cannot be fetched', async () => {
  mockChannel.mockResolvedValue(null);
  expect((await GET(req())).status).toBe(502);
});

it('ranks the breakout song top and flags it an outlier', async () => {
  const res = await GET(req('?threshold=2'));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.analyticsConfigured).toBe(true);
  expect(body.signalsAvailable).toEqual(
    expect.arrayContaining(['viewsPerDay', 'engagement', 'subsPer1k', 'retention'])
  );
  expect(body.outliers[0].videoId).toBe('breakout');
  expect(body.outliers[0].rank).toBe(1);
  expect(body.outliers[0].isOutlier).toBe(true);
  // retention proxy = avgViewDuration(160) / durationSeconds(240) * 100 ≈ 66.7
  const ret = body.outliers[0].breakdown.find((b: { key: string }) => b.key === 'retention');
  expect(ret.value).toBeCloseTo(66.67, 1);
  // subs conversion = 900 / 90000 * 1000 ≈ 10 per 1k
  const subs = body.outliers[0].breakdown.find((b: { key: string }) => b.key === 'subsPer1k');
  expect(subs.value).toBeCloseTo(10, 3);
  expect(body.channel.ranked).toBe(5);
});

it('degrades without Analytics: ranks on the available signals, no 500', async () => {
  mockAnalyticsConfigured.mockReturnValue(false);
  const res = await GET(req());
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.analyticsConfigured).toBe(false);
  expect(body.signalsAvailable).toEqual(['viewsPerDay', 'engagement']);
  // breakout still wins on views/day + engagement
  expect(body.outliers[0].videoId).toBe('breakout');
  // no subs/retention signal present in the breakdown
  expect(body.outliers[0].breakdown.some((b: { key: string }) => b.key === 'subsPer1k')).toBe(false);
  expect(body.caveats[0]).toMatch(/Analytics unavailable/i);
});

it('degrades when Analytics is configured but the fetch fails', async () => {
  mockVideoAnalytics.mockResolvedValue({ ok: false, error: 'boom' });
  const res = await GET(req());
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.analyticsConfigured).toBe(false);
  expect(body.outliers[0].videoId).toBe('breakout');
});

it('returns success with empty rankings for an empty catalogue', async () => {
  mockVideos.mockResolvedValue([]);
  const res = await GET(req());
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.outliers).toEqual([]);
  expect(body.themeSummary).toEqual([]);
  expect(body.channel.ranked).toBe(0);
});

it('always surfaces the Studio-only CTR caveat', async () => {
  const body = await (await GET(req())).json();
  expect(body.caveats.some((c: string) => /Studio-only/.test(c))).toBe(true);
});
