/** @jest-environment node */
/**
 * Tests for the song share leaderboard.
 *
 * Two defects this suite pins down (found in the 2026-07-14 WhatsApp audit):
 *
 *  1. SELECTION BIAS — the candidate pool used to be "top N *by views*", and the
 *     panel then let you rank that pool by share RATE. A low-view/high-rate song
 *     — precisely the share-worthy outlier the rate exists to surface — was
 *     filtered out before its rate was ever computed. The pool must be selected
 *     by eligibility (a min-views floor), NOT by view rank.
 *
 *  2. SILENT ZERO — a failed per-video shares call fell through to `?? 0`, so an
 *     API error was indistinguishable from "nobody shared it" and quietly ranked
 *     the song last. Failure must surface as `null`, never 0.
 */

jest.mock('@/lib/youtube-analytics', () => ({
  isYouTubeAnalyticsConfigured: jest.fn(() => true),
  fetchVideoAnalytics: jest.fn(),
  fetchVideoShares: jest.fn(),
}));

import { buildShareLeaderboard, fetchShareLeaderboard } from '@/lib/song-shares';
import * as yta from '@/lib/youtube-analytics';

const mockConfigured = yta.isYouTubeAnalyticsConfigured as jest.Mock;
const mockVideoAnalytics = yta.fetchVideoAnalytics as jest.Mock;
const mockVideoShares = yta.fetchVideoShares as jest.Mock;

const vid = (videoId: string, views: number) => ({
  videoId,
  views,
  estimatedMinutesWatched: 0,
  averageViewDuration: 0,
  subscribersGained: 0,
});

describe('buildShareLeaderboard (pure)', () => {
  const videos = [
    { videoId: 'a', views: 1000 },
    { videoId: 'b', views: 200 },
    { videoId: 'c', views: 0 },
  ];
  const titles = new Map([['a', 'Song A']]);

  it('ranks by absolute shares and computes shares-per-1k', () => {
    const shares = new Map<string, number | null>([['a', 10], ['b', 20], ['c', 0]]);
    const rows = buildShareLeaderboard(videos, shares, titles);
    expect(rows.map((r) => r.videoId)).toEqual(['b', 'a', 'c']); // 20, 10, 0
    expect(rows[0]).toMatchObject({ videoId: 'b', title: 'b', views: 200, shares: 20, sharesPer1k: 100 });
    expect(rows[1]).toMatchObject({ videoId: 'a', title: 'Song A', shares: 10, sharesPer1k: 10 });
  });

  it('guards divide-by-zero views', () => {
    const shares = new Map<string, number | null>([['c', 0]]);
    const rows = buildShareLeaderboard([{ videoId: 'c', views: 0 }], shares, titles);
    expect(rows[0]).toMatchObject({ shares: 0, sharesPer1k: 0, title: 'c' });
  });

  it('reports an UNKNOWN share count as null — never as a zero', () => {
    const shares = new Map<string, number | null>([['a', 10], ['b', null]]);
    const rows = buildShareLeaderboard(videos.slice(0, 2), shares, titles);
    const b = rows.find((r) => r.videoId === 'b')!;
    expect(b.shares).toBeNull();
    expect(b.sharesPer1k).toBeNull(); // NOT 0 — we do not know
  });

  it('sorts rows with an unknown share count last, below genuine zeros', () => {
    const shares = new Map<string, number | null>([
      ['a', null], // unknown
      ['b', 0], // genuinely zero
      ['c', 5],
    ]);
    const rows = buildShareLeaderboard(
      [{ videoId: 'a', views: 900 }, { videoId: 'b', views: 800 }, { videoId: 'c', views: 700 }],
      shares,
      titles
    );
    expect(rows.map((r) => r.videoId)).toEqual(['c', 'b', 'a']); // 5, 0, unknown
  });

  it('falls back to the video id when no title resolved', () => {
    const rows = buildShareLeaderboard([{ videoId: 'z', views: 10 }], new Map([['z', 1]]), new Map());
    expect(rows[0].title).toBe('z');
  });
});

describe('fetchShareLeaderboard — selection bias (the headline bug)', () => {
  const OLD = process.env.YOUTUBE_API_KEY;
  beforeEach(() => {
    delete process.env.YOUTUBE_API_KEY; // skip title decoration (no network)
    mockConfigured.mockReturnValue(true);
    mockVideoAnalytics.mockReset();
    mockVideoShares.mockReset();
  });
  afterAll(() => {
    process.env.YOUTUBE_API_KEY = OLD;
  });

  it('includes a LOW-VIEW / HIGH-RATE song that a top-N-by-views pool would have hidden', async () => {
    // 5 big songs with a mediocre rate, plus one modest song people actually
    // forward. Ask for topN=3: under the old code the pool was the 3 biggest by
    // views, so 'gem' never even had its rate computed.
    mockVideoAnalytics.mockResolvedValueOnce({
      ok: true,
      data: [
        vid('big1', 50_000),
        vid('big2', 40_000),
        vid('big3', 30_000),
        vid('big4', 20_000),
        vid('big5', 10_000),
        vid('gem', 900), // low reach, high share-worthiness
      ],
    });
    const sharesById: Record<string, number> = {
      big1: 50, big2: 40, big3: 30, big4: 20, big5: 10,
      gem: 90, // 100 per 1k — far and away the most share-worthy song
    };
    mockVideoShares.mockImplementation((id: string) =>
      Promise.resolve({ ok: true, data: sharesById[id] })
    );

    const res = await fetchShareLeaderboard(90, { topN: 3, minViews: 100 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Every eligible song was considered, not just the top 3 by views.
    expect(res.data.candidatesConsidered).toBe(6);
    expect(mockVideoShares).toHaveBeenCalledTimes(6);

    const gem = res.data.rows.find((r) => r.videoId === 'gem');
    expect(gem).toBeDefined();
    expect(gem!.sharesPer1k).toBeCloseTo(100, 1);

    // And it is the top song by rate — the whole point of the metric.
    const byRate = [...res.data.rows].sort((a, b) => (b.sharesPer1k ?? -1) - (a.sharesPer1k ?? -1));
    expect(byRate[0].videoId).toBe('gem');
  });

  it('applies a min-views floor so a 3-view song cannot fake a huge rate', async () => {
    mockVideoAnalytics.mockResolvedValueOnce({
      ok: true,
      data: [vid('real', 5000), vid('noise', 3)], // 1 share on 3 views = 333/1k of nothing
    });
    mockVideoShares.mockImplementation((id: string) =>
      Promise.resolve({ ok: true, data: id === 'real' ? 25 : 1 })
    );

    const res = await fetchShareLeaderboard(90, { topN: 20, minViews: 100 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.rows.map((r) => r.videoId)).toEqual(['real']);
    expect(res.data.minViews).toBe(100);
    expect(mockVideoShares).toHaveBeenCalledTimes(1); // never even queried the noise song
  });

  it('caps the candidate pool so the API fan-out stays bounded', async () => {
    mockVideoAnalytics.mockResolvedValueOnce({
      ok: true,
      data: Array.from({ length: 200 }, (_, i) => vid(`v${i}`, 1000 - i)),
    });
    mockVideoShares.mockResolvedValue({ ok: true, data: 1 });

    const res = await fetchShareLeaderboard(90, { topN: 10, minViews: 1, maxCandidates: 25 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.candidatesConsidered).toBe(25);
    expect(mockVideoShares).toHaveBeenCalledTimes(25); // NOT 200
  });

  it('returns at most topN rows for display', async () => {
    mockVideoAnalytics.mockResolvedValueOnce({
      ok: true,
      data: Array.from({ length: 12 }, (_, i) => vid(`v${i}`, 1000)),
    });
    mockVideoShares.mockResolvedValue({ ok: true, data: 5 });

    const res = await fetchShareLeaderboard(90, { topN: 4, minViews: 100 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.rows).toHaveLength(4);
    expect(res.data.candidatesConsidered).toBe(12); // but all 12 were measured
  });
});

describe('fetchShareLeaderboard — failure is not zero', () => {
  const OLD = process.env.YOUTUBE_API_KEY;
  beforeEach(() => {
    delete process.env.YOUTUBE_API_KEY;
    mockConfigured.mockReturnValue(true);
    mockVideoAnalytics.mockReset();
    mockVideoShares.mockReset();
  });
  afterAll(() => {
    process.env.YOUTUBE_API_KEY = OLD;
  });

  it('surfaces a failed shares call as null + reports it, instead of silently ranking it last as 0', async () => {
    mockVideoAnalytics.mockResolvedValueOnce({
      ok: true,
      data: [vid('ok1', 5000), vid('throttled', 4000)],
    });
    mockVideoShares.mockImplementation((id: string) =>
      id === 'throttled'
        ? Promise.resolve({ ok: false, error: 'Analytics API 429: rateLimitExceeded' })
        : Promise.resolve({ ok: true, data: 30 })
    );

    const res = await fetchShareLeaderboard(90, { topN: 10, minViews: 100 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const bad = res.data.rows.find((r) => r.videoId === 'throttled')!;
    expect(bad.shares).toBeNull();
    expect(bad.sharesPer1k).toBeNull();
    expect(res.data.failedVideoIds).toEqual(['throttled']);
  });

  it('treats a REAL zero as zero (distinct from a failure)', async () => {
    mockVideoAnalytics.mockResolvedValueOnce({ ok: true, data: [vid('quiet', 5000)] });
    mockVideoShares.mockResolvedValue({ ok: true, data: 0 });

    const res = await fetchShareLeaderboard(90, { topN: 10, minViews: 100 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.rows[0]).toMatchObject({ shares: 0, sharesPer1k: 0 });
    expect(res.data.failedVideoIds).toEqual([]);
  });

  it('survives a rejected (throwing) shares call rather than failing the whole report', async () => {
    mockVideoAnalytics.mockResolvedValueOnce({
      ok: true,
      data: [vid('ok1', 5000), vid('boom', 4000)],
    });
    mockVideoShares.mockImplementation((id: string) =>
      id === 'boom' ? Promise.reject(new Error('socket hang up')) : Promise.resolve({ ok: true, data: 7 })
    );

    const res = await fetchShareLeaderboard(90, { topN: 10, minViews: 100 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.rows.find((r) => r.videoId === 'boom')!.shares).toBeNull();
    expect(res.data.failedVideoIds).toEqual(['boom']);
  });
});

describe('fetchShareLeaderboard — upstream errors', () => {
  beforeEach(() => {
    mockConfigured.mockReturnValue(true);
    mockVideoAnalytics.mockReset();
    mockVideoShares.mockReset();
  });

  it('propagates a not-configured failure without calling upstream', async () => {
    mockConfigured.mockReturnValue(false);
    const res = await fetchShareLeaderboard();
    expect(res).toMatchObject({ ok: false });
    expect(mockVideoAnalytics).not.toHaveBeenCalled();
  });

  it('propagates a failed video-analytics fetch', async () => {
    mockVideoAnalytics.mockResolvedValueOnce({ ok: false, error: 'Analytics API 503' });
    const res = await fetchShareLeaderboard();
    expect(res).toMatchObject({ ok: false, error: 'Analytics API 503' });
  });

  it('returns an empty leaderboard (not an error) when no song clears the floor', async () => {
    mockVideoAnalytics.mockResolvedValueOnce({ ok: true, data: [vid('tiny', 5)] });
    const res = await fetchShareLeaderboard(90, { minViews: 100 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.rows).toEqual([]);
    expect(res.data.candidatesConsidered).toBe(0);
    expect(mockVideoShares).not.toHaveBeenCalled();
  });
});
