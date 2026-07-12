/** @jest-environment node */
/**
 * Tests for the song share leaderboard: the pure ranking/rate builder, and the
 * orchestration (top-by-views → per-video shares → ranked), with the analytics
 * lib mocked at the boundary.
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

describe('buildShareLeaderboard (pure)', () => {
  const videos = [
    { videoId: 'a', views: 1000 },
    { videoId: 'b', views: 200 },
    { videoId: 'c', views: 0 },
  ];
  const shares = new Map([['a', 10], ['b', 20]]); // c has no share entry
  const titles = new Map([['a', 'Song A']]);

  it('ranks by absolute shares and computes shares-per-1k', () => {
    const rows = buildShareLeaderboard(videos, shares, titles);
    expect(rows.map((r) => r.videoId)).toEqual(['b', 'a', 'c']); // 20, 10, 0
    expect(rows[0]).toMatchObject({ videoId: 'b', title: 'b', views: 200, shares: 20, sharesPer1k: 100 }); // 20/200*1000
    expect(rows[1]).toMatchObject({ videoId: 'a', title: 'Song A', shares: 10, sharesPer1k: 10 }); // 10/1000*1000
  });

  it('defaults a missing share count to 0 and guards divide-by-zero views', () => {
    const rows = buildShareLeaderboard(videos, shares, titles);
    const c = rows.find((r) => r.videoId === 'c')!;
    expect(c).toMatchObject({ shares: 0, sharesPer1k: 0, title: 'c' }); // no shares, 0 views → rate 0, title falls back to id
  });
});

describe('fetchShareLeaderboard (orchestration)', () => {
  const OLD = process.env.YOUTUBE_API_KEY;
  beforeEach(() => {
    delete process.env.YOUTUBE_API_KEY; // skip title decoration (no network) → titles fall back to ids
    mockConfigured.mockReturnValue(true);
    mockVideoAnalytics.mockReset();
    mockVideoShares.mockReset();
  });
  afterAll(() => { process.env.YOUTUBE_API_KEY = OLD; });

  it('takes the top-N by views, fetches each songs shares, and ranks by shares', async () => {
    mockVideoAnalytics.mockResolvedValueOnce({
      ok: true,
      data: [
        { videoId: 'big', views: 5000, estimatedMinutesWatched: 0, averageViewDuration: 0, subscribersGained: 0 },
        { videoId: 'small', views: 300, estimatedMinutesWatched: 0, averageViewDuration: 0, subscribersGained: 0 },
      ],
    });
    const sharesById: Record<string, number> = { big: 50, small: 40 };
    mockVideoShares.mockImplementation((id: string) => Promise.resolve({ ok: true, data: sharesById[id] }));

    const res = await fetchShareLeaderboard(90, 20);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.map((r) => r.videoId)).toEqual(['big', 'small']); // 50 > 40
      const small = res.data.find((r) => r.videoId === 'small')!;
      expect(small.sharesPer1k).toBeCloseTo(133.3, 1); // 40/300*1000 — small song, higher RATE
    }
    expect(mockVideoShares).toHaveBeenCalledTimes(2);
  });

  it('propagates a not-configured / upstream failure', async () => {
    mockConfigured.mockReturnValue(false);
    const res = await fetchShareLeaderboard();
    expect(res).toMatchObject({ ok: false });
    expect(mockVideoAnalytics).not.toHaveBeenCalled();
  });
});
