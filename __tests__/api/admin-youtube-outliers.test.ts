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

// The catalogue theme lookup (uses the REAL themeForSongWithOverride resolver).
const mockFindByType = jest.fn();
jest.mock('@/infrastructure/database/ContentRepository', () => ({
  ContentRepository: jest.fn(() => ({ findByType: mockFindByType })),
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
    publishedAt: '2020-01-01T00:00:00Z', // safely > 60d old (any clock) + same age → viewsPerDay tracks views
    thumbnail: '',
    viewCount: views,
    likeCount: 0,
    commentCount: comments,
    duration: 'PT4M',
    durationSeconds: 240,
  });
  const short = { ...mk('shortclip', 500000, 500), duration: 'PT45S', durationSeconds: 45 }; // a Short
  return [
    mk('normal1', 10000, 10),
    mk('normal2', 10000, 10),
    mk('normal3', 10000, 10),
    mk('normal4', 10000, 10),
    mk('breakout', 100000, 100),
    short,
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
  // Catalogue songs: breakout is a 'mother' song (DB override), normals default to 'love'.
  mockFindByType.mockResolvedValue({
    items: [
      { id: 'c_b', youtubeVideoId: 'breakout', theme: 'mother' },
      { id: 'c_1', youtubeVideoId: 'normal1', theme: undefined },
      { id: 'c_2', youtubeVideoId: 'normal2', theme: undefined },
      { id: 'c_3', youtubeVideoId: 'normal3', theme: undefined },
      { id: 'c_4', youtubeVideoId: 'normal4', theme: undefined },
    ],
  });
  // Window-aware: the 365d pull drives subs/retention; the 30d pull drives growth30d.
  const mainRow = (id: string, views: number, avd: number, subs: number) => ({
    videoId: id, views, estimatedMinutesWatched: 0, averageViewDuration: avd, subscribersGained: subs,
  });
  mockVideoAnalytics.mockImplementation((days: number) => {
    if (days === 30) {
      // Recent velocity: breakout still pulling views, normals cooled.
      return Promise.resolve({
        ok: true,
        data: [
          mainRow('breakout', 9000, 160, 0),
          mainRow('normal1', 100, 100, 0),
          mainRow('normal2', 100, 100, 0),
          mainRow('normal3', 100, 100, 0),
          mainRow('normal4', 100, 100, 0),
        ],
      });
    }
    return Promise.resolve({
      ok: true,
      data: [
        mainRow('breakout', 90000, 160, 900),
        mainRow('normal1', 9000, 100, 20),
        mainRow('normal2', 9000, 100, 20),
        mainRow('normal3', 9000, 100, 20),
        mainRow('normal4', 9000, 100, 20),
      ],
    });
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

it('computes the growth30d long-tail signal from the trailing-30d window', async () => {
  const body = await (await GET(req())).json();
  expect(body.signalsAvailable).toContain('growth30d');
  const breakout = body.outliers.find((o: { videoId: string }) => o.videoId === 'breakout');
  const g = breakout.breakdown.find((b: { key: string }) => b.key === 'growth30d');
  expect(g).toBeTruthy();
  expect(typeof g.value).toBe('number');
  // breakout's recent velocity dwarfs the normals' → highest growth30d too
  const normal = body.outliers.find((o: { videoId: string }) => o.videoId === 'normal1');
  const gn = normal.breakdown.find((b: { key: string }) => b.key === 'growth30d');
  expect(g.value).toBeGreaterThan(gn.value);
  expect(body.caveats.some((c: string) => /trailing-30d views\/day/.test(c))).toBe(true);
});

it('omits growth30d when Analytics is off', async () => {
  mockAnalyticsConfigured.mockReturnValue(false);
  const body = await (await GET(req())).json();
  expect(body.signalsAvailable).not.toContain('growth30d');
  expect(body.caveats.some((c: string) => /growth30d\) needs YouTube Analytics/.test(c))).toBe(true);
});

it('excludes Shorts from the ranking, theme rollup, and count', async () => {
  const body = await (await GET(req('?threshold=2'))).json();
  expect(body.outliers.some((o: { videoId: string }) => o.videoId === 'shortclip')).toBe(false);
  expect(body.channel.ranked).toBe(5); // 6 uploads, 1 Short filtered out
  expect(body.caveats.some((c: string) => /Shorts are excluded/.test(c))).toBe(true);
  // and the Short (500k views) did NOT steal rank #1 from the real breakout
  expect(body.outliers[0].videoId).toBe('breakout');
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

it('joins catalogue themes and groups the rollup by real theme', async () => {
  const body = await (await GET(req())).json();
  expect(body.themesJoined).toBe(true);
  const breakout = body.outliers.find((o: { videoId: string }) => o.videoId === 'breakout');
  expect(breakout.theme).toBe('mother'); // DB override
  const normal = body.outliers.find((o: { videoId: string }) => o.videoId === 'normal1');
  expect(normal.theme).toBe('love'); // default (site convention)
  const themes = body.themeSummary.map((t: { theme: string }) => t.theme).sort();
  expect(themes).toEqual(['love', 'mother']);
  expect(body.themeSummary.every((t: { theme: string }) => t.theme !== '(untagged)')).toBe(true);
});

it('degrades to untagged themes when the catalogue lookup fails (no 500)', async () => {
  mockFindByType.mockRejectedValue(new Error('dynamo down'));
  const res = await GET(req());
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.themesJoined).toBe(false);
  expect(body.outliers[0].theme).toBeNull();
  expect(body.themeSummary[0].theme).toBe('(untagged)');
  expect(body.caveats.some((c: string) => /untagged/i.test(c))).toBe(true);
});

it('always surfaces the Studio-only CTR caveat', async () => {
  const body = await (await GET(req())).json();
  expect(body.caveats.some((c: string) => /Studio-only/.test(c))).toBe(true);
});
