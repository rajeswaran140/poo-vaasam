/** @jest-environment node */
/**
 * Tests for src/lib/youtube-forecast.ts. The statistical helpers are checked
 * against independently-derived reference values (Cauchy tail = 0.5, standard
 * t-critical values, hand-computed Welch t/df), not against the code's own
 * output — so a regression in the math actually fails here.
 */

import {
  gammaln,
  betai,
  studentTTwoSided,
  estimateSubscriberRate,
  forecastToTarget,
  assessChange,
  detectLevelShift,
  analyzeChannel,
  MIN_FORECAST_DAYS,
  type SeriesPoint,
} from '@/lib/youtube-forecast';

/** Build a series with the given per-day net-subscriber values (views optional). */
function series(netSubs: number[], views?: number[]): SeriesPoint[] {
  return netSubs.map((n, i) => ({
    // deterministic ascending dates from a fixed anchor
    date: `2026-06-${String(1 + i).padStart(2, '0')}`,
    views: views ? views[i] : 1000,
    netSubscribers: n,
  }));
}

describe('numeric helpers', () => {
  it('gammaln matches known values', () => {
    expect(gammaln(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 6); // 0.57236…
    expect(gammaln(1)).toBeCloseTo(0, 6);
    expect(gammaln(5)).toBeCloseTo(Math.log(24), 6); // Γ(5)=4!=24
  });

  it('betai I_0.5(0.5,0.5) = 0.5 (arcsine symmetry)', () => {
    expect(betai(0.5, 0.5, 0.5)).toBeCloseTo(0.5, 6);
    expect(betai(2, 3, 0)).toBe(0);
    expect(betai(2, 3, 1)).toBe(1);
  });

  it('studentTTwoSided matches t-table crit values', () => {
    // Cauchy (df=1): P(|T|>1) = 0.5 exactly.
    expect(studentTTwoSided(1, 1)).toBeCloseTo(0.5, 4);
    // df=10, t=2.228139 is the 0.025 upper crit → two-sided 0.05.
    expect(studentTTwoSided(2.228139, 10)).toBeCloseTo(0.05, 3);
    // df=10, t=2.0 → two-sided ≈ 0.0734.
    expect(studentTTwoSided(2.0, 10)).toBeCloseTo(0.0734, 3);
    // t=0 → p=1.
    expect(studentTTwoSided(0, 5)).toBeCloseTo(1, 6);
  });
});

describe('estimateSubscriberRate', () => {
  it('returns null below the minimum window', () => {
    expect(estimateSubscriberRate(series([10, 10, 10, 10]))).toBeNull(); // 4 < MIN
    expect(MIN_FORECAST_DAYS).toBe(5);
  });

  it('flat pace → rate = mean, zero std-err, flat trend', () => {
    const r = estimateSubscriberRate(series(Array(14).fill(10)))!;
    expect(r.ratePerDay).toBe(10);
    expect(r.stdErr).toBe(0);
    expect(r.trendDirection).toBe('flat');
    expect(r.sampleDays).toBe(14);
  });

  it('monotonic decline → declining trend, negative slope', () => {
    // 20,19,…,7 over 14 days
    const r = estimateSubscriberRate(series(Array.from({ length: 14 }, (_, i) => 20 - i)))!;
    expect(r.trendSlope).toBeCloseTo(-1, 6);
    expect(r.trendDirection).toBe('declining');
    expect(r.ratePerDay).toBeCloseTo(13.5, 6);
  });

  it('only looks at the trailing window', () => {
    const r = estimateSubscriberRate(series([...Array(30).fill(1), ...Array(14).fill(50)]), 14)!;
    expect(r.ratePerDay).toBe(50);
  });
});

describe('forecastToTarget', () => {
  const asOf = '2026-07-14';

  it('constant pace → central = fast = slow, correct ETA date', () => {
    const f = forecastToTarget(series(Array(14).fill(10)), { current: 922, target: 1000, asOf })!;
    expect(f.reachable).toBe(true);
    expect(f.remaining).toBe(78);
    expect(f.etaDays).toBe(8); // ceil(78/10)
    expect(f.etaDaysFast).toBe(8);
    expect(f.etaDaysSlow).toBe(8);
    expect(f.etaDate).toBe('2026-07-22'); // 2026-07-14 + 8
    expect(f.caveat).toBeNull();
  });

  it('already at/over target → 0 days', () => {
    const f = forecastToTarget(series(Array(14).fill(10)), { current: 1000, target: 1000, asOf })!;
    expect(f.reachable).toBe(true);
    expect(f.etaDays).toBe(0);
    expect(f.etaDate).toBe(asOf);
  });

  it('non-positive pace → honestly not reachable (no ∞/negative ETA)', () => {
    const f = forecastToTarget(series(Array(14).fill(-1)), { current: 900, target: 1000, asOf })!;
    expect(f.reachable).toBe(false);
    expect(f.etaDays).toBeNull();
    expect(f.etaDaysSlow).toBeNull();
    expect(f.caveat).toMatch(/not reachable/i);
  });

  it('declining pace attaches a lean-slower caveat', () => {
    const f = forecastToTarget(series(Array.from({ length: 14 }, (_, i) => 20 - i)), {
      current: 900,
      target: 1000,
      asOf,
    })!;
    expect(f.caveat).toMatch(/declining/i);
  });

  it('band ordering: fast ≤ central ≤ slow when there is variance', () => {
    const noisy = [8, 12, 10, 14, 6, 11, 9, 13, 7, 10, 12, 8, 11, 9];
    const f = forecastToTarget(series(noisy), { current: 922, target: 1000, asOf })!;
    expect(f.etaDaysFast).toBeLessThanOrEqual(f.etaDays!);
    expect(f.etaDays!).toBeLessThanOrEqual(f.etaDaysSlow!);
  });

  it('slow end of the band drops to null when the pessimistic pace is ≤0', () => {
    const wild = Array.from({ length: 14 }, (_, i) => (i % 2 === 0 ? 20 : -16)); // mean 2, huge spread
    const f = forecastToTarget(series(wild), { current: 900, target: 1000, asOf })!;
    expect(f.reachable).toBe(true);
    expect(f.rate.ratePerDay).toBeCloseTo(2, 6);
    expect(f.etaDays).toBe(50); // ceil(100/2)
    expect(f.etaDaysSlow).toBeNull();
  });

  it('returns null without enough history', () => {
    expect(forecastToTarget(series([10, 10, 10]), { current: 1, target: 2, asOf })).toBeNull();
  });
});

describe('assessChange (Welch t)', () => {
  it('hand-computed Welch t and df for two 3-point windows', () => {
    // prior=[6,8,10] (mean8,var4), recent=[10,12,14] (mean12,var4)
    const s = series([6, 8, 10, 10, 12, 14]);
    const a = assessChange(s, { metric: 'netSubscribers', recentDays: 3, priorDays: 3 })!;
    expect(a.recentMean).toBe(12);
    expect(a.priorMean).toBe(8);
    expect(a.deltaPct).toBeCloseTo(50, 6);
    expect(a.tStat).toBeCloseTo(2.4495, 3);
    expect(a.df).toBeCloseTo(4, 6);
    // t=2.449 < crit(0.05,df4)=2.776 → NOT significant.
    expect(a.significant).toBe(false);
    expect(a.direction).toBe('flat');
  });

  it('flags a large, low-variance jump as significant', () => {
    const s = series([10, 12, 11, 9, 13, 100, 110, 105, 108, 102]);
    const a = assessChange(s, { metric: 'netSubscribers', recentDays: 5, priorDays: 5 })!;
    expect(a.significant).toBe(true);
    expect(a.direction).toBe('up');
    expect(a.pValue).toBeLessThan(0.001);
  });

  it('constant-but-different windows → significant without dividing by zero', () => {
    const s = series([5, 5, 5, 20, 20, 20]);
    const a = assessChange(s, { metric: 'netSubscribers', recentDays: 3, priorDays: 3 })!;
    expect(a.pValue).toBe(0);
    expect(a.significant).toBe(true);
    expect(a.direction).toBe('up');
    expect(a.deltaPct).toBeCloseTo(300, 6);
  });

  it('null when a window is too small', () => {
    expect(assessChange(series([1, 2, 3]), { recentDays: 1, priorDays: 2 })).toBeNull();
  });

  it('defaults to the views metric', () => {
    const s = series([0, 0, 0, 0, 0, 0], [10, 10, 10, 90, 90, 90]);
    const a = assessChange(s, { recentDays: 3, priorDays: 3 })!;
    expect(a.metric).toBe('views');
    expect(a.recentMean).toBe(90);
  });
});

describe('detectLevelShift', () => {
  it('locates the breakout day', () => {
    const views = [100, 110, 95, 105, 100, 98, 1000, 1100, 1050, 980, 1020, 1010];
    const shift = detectLevelShift(series(Array(views.length).fill(0), views), { metric: 'views' })!;
    expect(shift.index).toBe(6);
    expect(shift.date).toBe(series(Array(views.length).fill(0), views)[6].date);
    expect(shift.afterMean).toBeGreaterThan(shift.beforeMean);
    expect(shift.significant).toBe(true);
  });

  it('null when the series is too short to split', () => {
    expect(detectLevelShift(series([0, 0, 0, 0], [1, 2, 3, 4]), { minSegment: 3 })).toBeNull();
  });
});

describe('analyzeChannel composition', () => {
  it('bundles forecast + change reads + reach shift', () => {
    const views = [100, 110, 95, 105, 100, 98, 1000, 1100, 1050, 980, 1020, 1010, 1005, 990];
    const subs = Array(14).fill(10);
    const out = analyzeChannel(series(subs, views), {
      current: 922,
      target: 1000,
      asOf: '2026-07-14',
    });
    expect(out.current).toBe(922);
    expect(out.forecast?.etaDays).toBe(8);
    expect(out.viewsChange?.metric).toBe('views');
    expect(out.subsChange?.metric).toBe('netSubscribers');
    expect(out.reachShift?.index).toBe(6);
  });
});
