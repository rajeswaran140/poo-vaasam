/** @jest-environment node */
/**
 * UNIT TESTS — pure weekly-digest + anomaly helpers.
 */
import {
  summarizeWeekOverWeek,
  detectViewAnomaly,
  buildDigest,
  type DailyPoint,
} from '@/lib/youtube-digest';
import type { VideoAnalyticsRow } from '@/lib/youtube-analytics';

const day = (date: string, views: number, subs = 0, mins = 0): DailyPoint => ({
  date,
  views,
  subscribersGained: subs,
  estimatedMinutesWatched: mins,
});

// 14 days: prior week ~100 views total, current week ~200 total.
const series14: DailyPoint[] = [
  ...Array.from({ length: 7 }, (_, i) => day(`2026-06-${String(i + 1).padStart(2, '0')}`, 10, 1, 20)),
  ...Array.from({ length: 7 }, (_, i) => day(`2026-06-${String(i + 8).padStart(2, '0')}`, 20, 2, 40)),
];

const av = (videoId: string, views: number, subscribersGained: number): VideoAnalyticsRow => ({
  videoId,
  views,
  subscribersGained,
  estimatedMinutesWatched: views,
  averageViewDuration: 60,
});

describe('summarizeWeekOverWeek', () => {
  it('computes last-7 vs prior-7 with delta %', () => {
    const wow = summarizeWeekOverWeek(series14);
    expect(wow.views.current).toBe(140); // 7×20
    expect(wow.views.prior).toBe(70); // 7×10
    expect(wow.views.deltaPct).toBe(100);
    expect(wow.subscribersGained.current).toBe(14);
    expect(wow.watchTimeMinutes.current).toBe(280);
  });
  it('returns null delta when there is no prior baseline', () => {
    const wow = summarizeWeekOverWeek(series14.slice(-7)); // only current week
    expect(wow.views.prior).toBe(0);
    expect(wow.views.deltaPct).toBeNull();
  });
});

describe('detectViewAnomaly', () => {
  it('flags insufficient history', () => {
    expect(detectViewAnomaly([1, 2, 3]).status).toBe('insufficient');
  });
  it('detects a stall and warns about counter-lag', () => {
    const a = detectViewAnomaly([50, 60, 55, 48, 52, 50, 0, 0, 1]);
    expect(a.status).toBe('stalled');
    expect(a.message).toMatch(/counter|lag/i);
  });
  it('detects cooling (down but not stalled)', () => {
    expect(detectViewAnomaly([100, 90, 100, 95, 100, 40, 35, 38]).status).toBe('cooling');
  });
  it('detects surging', () => {
    expect(detectViewAnomaly([10, 12, 11, 9, 10, 60, 70, 65]).status).toBe('surging');
  });
  it('reads steady traffic as normal', () => {
    expect(detectViewAnomaly([30, 32, 28, 31, 29, 30, 31, 30]).status).toBe('normal');
  });
});

describe('buildDigest', () => {
  const videos = [av('a', 500, 5), av('b', 800, 2), av('c', 100, 9)];
  it('assembles growth, anomaly, top lists, and a headline', () => {
    const d = buildDigest(series14, videos);
    expect(d.weekOverWeek.views.deltaPct).toBe(100);
    expect(d.topByViews[0].videoId).toBe('b'); // most views
    expect(d.topBySubs[0].videoId).toBe('c'); // most subs gained
    // recent(20) vs baseline(~13.6, includes the ramp) = 1.47x -> below the 1.6x surge bar
    expect(d.anomaly.status).toBe('normal');
    expect(typeof d.headline).toBe('string');
    expect(d.headline.length).toBeGreaterThan(0);
  });
  it('headline leads with a stall warning when stalled', () => {
    const stalled = [
      ...Array.from({ length: 11 }, (_, i) => day(`2026-06-${String(i + 1).padStart(2, '0')}`, 40, 0, 80)),
      ...Array.from({ length: 3 }, (_, i) => day(`2026-06-${String(i + 12).padStart(2, '0')}`, 0, 0, 0)),
    ];
    expect(buildDigest(stalled, videos).headline).toMatch(/stalled/i);
  });
});
