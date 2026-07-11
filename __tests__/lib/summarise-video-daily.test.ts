import { summariseVideoDaily } from '@/lib/youtube-dashboard';
import type { DailyAnalyticsRow } from '@/lib/youtube-analytics';

const day = (n: number, views: number, subs = 0, min = 0): DailyAnalyticsRow => ({
  date: `2026-06-${String(n).padStart(2, '0')}`,
  views,
  subscribersGained: subs,
  estimatedMinutesWatched: min,
});

describe('summariseVideoDaily', () => {
  it('totals views/subs/watch, finds the best day, and computes 7-vs-prior-7', () => {
    // 16 ascending days, views = 1..16, subs on even days, watch = views*2.
    const rows = Array.from({ length: 16 }, (_, i) => day(i + 1, i + 1, i % 2, (i + 1) * 2));
    const s = summariseVideoDaily(rows);

    expect(s.totalViews).toBe(136); // 1+…+16
    expect(s.totalWatchMinutes).toBe(272); // 2*(1+…+16)
    expect(s.bestDay).toEqual({ date: '2026-06-16', views: 16 });
    expect(s.last7Views).toBe(91); // views 10..16
    expect(s.prev7Views).toBe(42); // views 3..9
  });

  it('handles an empty series without dividing or throwing', () => {
    expect(summariseVideoDaily([])).toEqual({
      totalViews: 0,
      totalSubscribers: 0,
      totalWatchMinutes: 0,
      bestDay: null,
      last7Views: 0,
      prev7Views: 0,
    });
  });
});
