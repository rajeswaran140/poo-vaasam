/** @jest-environment node */
/**
 * Guards added 2026-08-02 after auditing the Catalogue Outlier Finder against
 * the live catalogue. The robust-statistics core was sound; the SIGNAL
 * DEFINITIONS were not, and both faults made brand-new songs outrank proven
 * ones:
 *
 *   1. viewsPerDay (the highest-weighted signal) had no minimum-age guard, so a
 *      1-day-old song's launch velocity was compared against a mature song's
 *      decayed lifetime average. Measured: z=22.4 for a 1-day-old vs z=12.5 for
 *      the channel's biggest song — the day-old one ranked first.
 *   2. Per-1k rates were computed at any view count. Measured: ONE comment on a
 *      39-view song = 25.6/1k (z=15.8); TWELVE comments on 48,791 views =
 *      0.25/1k (z=-0.9).
 *   3. Raw z-scores on heavy-tailed view data spanned -0.6 to 16.2.
 *
 * These tests encode the real numbers, so a regression reproduces the exact
 * failure rather than an abstraction of it.
 */
import {
  deriveSignals,
  rankOutliers,
  modifiedZScores,
  MIN_VELOCITY_AGE_DAYS,
  MIN_RATE_VIEWS,
  LOG_SCALED_SIGNALS,
  type RawVideoStats,
} from '@/lib/youtube-outliers';

const AS_OF = '2026-07-31';
const daysBefore = (n: number) => {
  const d = new Date(`${AS_OF}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
};
const raw = (over: Partial<RawVideoStats> & { videoId: string }): RawVideoStats => ({
  title: 'song',
  publishedAt: daysBefore(120),
  views: 10_000,
  comments: 10,
  subscribersGained: 30,
  retention: 45,
  ctr: null,
  growth30d: null,
  ...over,
});

describe('velocity guard — a song too young to have a durable rate', () => {
  it('gives no viewsPerDay below the minimum age', () => {
    const s = deriveSignals(raw({ videoId: 'newsong', publishedAt: daysBefore(1), views: 1694 }), AS_OF);
    expect(s.viewsPerDay).toBeNull();
  });

  it('gives viewsPerDay once the song is old enough', () => {
    const s = deriveSignals(raw({ videoId: 'mature', publishedAt: daysBefore(50), views: 48_791 }), AS_OF);
    expect(s.viewsPerDay).toBeCloseTo(48_791 / 50, 1);
  });

  it('the boundary itself qualifies', () => {
    const s = deriveSignals(raw({ videoId: 'edge', publishedAt: daysBefore(MIN_VELOCITY_AGE_DAYS), views: 3000 }), AS_OF);
    expect(s.viewsPerDay).not.toBeNull();
  });

  it('THE REGRESSION: a 1-day-old song no longer outranks the catalogue leader', () => {
    const songs = [
      raw({ videoId: 'dayold', publishedAt: daysBefore(1), views: 1694, comments: 5, subscribersGained: 1 }),
      raw({ videoId: 'leader', publishedAt: daysBefore(50), views: 48_791, comments: 12, subscribersGained: 197 }),
      raw({ videoId: 'mid1', publishedAt: daysBefore(60), views: 24_930, comments: 8, subscribersGained: 86 }),
      raw({ videoId: 'mid2', publishedAt: daysBefore(70), views: 15_934, comments: 6, subscribersGained: 51 }),
      raw({ videoId: 'small', publishedAt: daysBefore(90), views: 1_948, comments: 2, subscribersGained: 5 }),
    ].map((r) => deriveSignals(r, AS_OF));
    const ranked = rankOutliers(songs);
    const dayOld = ranked.find((r) => r.videoId === 'dayold')!;
    const leader = ranked.find((r) => r.videoId === 'leader')!;
    expect(leader.rank).toBeLessThan(dayOld.rank);
    expect(dayOld.breakdown.map((b) => b.key)).not.toContain('viewsPerDay');
  });
});

describe('rate floor — one comment on a tiny video is not a signal', () => {
  it('suppresses per-1k rates below the view floor', () => {
    const s = deriveSignals(raw({ videoId: 'tiny', views: 39, comments: 1, subscribersGained: 1 }), AS_OF);
    expect(s.engagement).toBeNull();
    expect(s.subsPer1k).toBeNull();
  });

  it('keeps them at or above the floor', () => {
    const s = deriveSignals(raw({ videoId: 'ok', views: MIN_RATE_VIEWS, comments: 1 }), AS_OF);
    expect(s.engagement).toBeCloseTo((1 / MIN_RATE_VIEWS) * 1000, 6);
  });

  it('THE REGRESSION: a single comment on 39 views no longer beats 12 on 48,791', () => {
    const songs = [
      raw({ videoId: 'tiny', publishedAt: daysBefore(1), views: 39, comments: 1, subscribersGained: 1 }),
      raw({ videoId: 'leader', publishedAt: daysBefore(50), views: 48_791, comments: 12, subscribersGained: 197 }),
      raw({ videoId: 'mid', publishedAt: daysBefore(60), views: 24_930, comments: 8, subscribersGained: 86 }),
    ].map((r) => deriveSignals(r, AS_OF));
    const ranked = rankOutliers(songs);
    expect(ranked.find((r) => r.videoId === 'leader')!.rank).toBeLessThan(
      ranked.find((r) => r.videoId === 'tiny')!.rank
    );
  });

  it('a floor-suppressed song is scored on what remains, not marked as terrible', () => {
    // null must never be read as "zero, i.e. the worst in the catalogue".
    const songs = [
      raw({ videoId: 'tiny', publishedAt: daysBefore(1), views: 39, comments: 1, retention: 60 }),
      raw({ videoId: 'a', publishedAt: daysBefore(60), views: 10_000, comments: 10, retention: 30 }),
      raw({ videoId: 'b', publishedAt: daysBefore(60), views: 12_000, comments: 12, retention: 35 }),
    ].map((r) => deriveSignals(r, AS_OF));
    const tiny = rankOutliers(songs).find((r) => r.videoId === 'tiny')!;
    expect(tiny.breakdown.map((b) => b.key)).toEqual(['retention']);
    expect(tiny.score).toBeGreaterThan(0); // highest retention of the three
  });
});

describe('log scaling — taming the heavy tail', () => {
  it('log-scales counts and rates but never bounded percentages', () => {
    expect(LOG_SCALED_SIGNALS.has('viewsPerDay')).toBe(true);
    expect(LOG_SCALED_SIGNALS.has('subsPer1k')).toBe(true);
    expect(LOG_SCALED_SIGNALS.has('retention')).toBe(false);
    expect(LOG_SCALED_SIGNALS.has('ctr')).toBe(false);
    expect(LOG_SCALED_SIGNALS.has('growth30d')).toBe(false);
  });

  it('compresses an extreme z that raw scoring would produce', () => {
    const heavy = [100, 120, 130, 140, 150, 160, 50_000];
    const rawZ = Math.max(...modifiedZScores(heavy));
    const logZ = Math.max(...modifiedZScores(heavy.map((v) => Math.log1p(v))));
    expect(rawZ).toBeGreaterThan(50);
    expect(logZ).toBeLessThan(rawZ / 5);
  });

  it('reports the RAW value in the breakdown, never the logarithm', () => {
    const songs = [
      raw({ videoId: 'a', publishedAt: daysBefore(50), views: 48_791 }),
      raw({ videoId: 'b', publishedAt: daysBefore(50), views: 5_000 }),
      raw({ videoId: 'c', publishedAt: daysBefore(50), views: 1_000 }),
    ].map((r) => deriveSignals(r, AS_OF));
    const a = rankOutliers(songs).find((r) => r.videoId === 'a')!;
    const vpd = a.breakdown.find((b) => b.key === 'viewsPerDay')!;
    expect(vpd.value).toBeCloseTo(48_791 / 50, 1); // ≈976/day, not ~6.9
  });

  it('preserves ordering — compression must not reshuffle the catalogue', () => {
    const xs = [10, 50, 200, 900, 5_000];
    const z = modifiedZScores(xs.map((v) => Math.log1p(v)));
    for (let i = 1; i < z.length; i++) expect(z[i]).toBeGreaterThan(z[i - 1]);
  });
});
