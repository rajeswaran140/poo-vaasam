import {
  fitDecay,
  residuals,
  assessImpact,
  newViewerSubsPer1k,
  MIN_EFFECT_SDS,
  type DayPoint,
} from '@/lib/release-impact';

/** A clean exponential decay: 1000 views falling 3%/day. */
function decaySeries(days: number, start = 1000, rate = 0.97): DayPoint[] {
  return Array.from({ length: days }, (_, i) => ({
    date: `2026-07-${String(i + 1).padStart(2, '0')}`,
    views: Math.round(start * rate ** i),
  }));
}

describe('fitDecay', () => {
  it('recovers a known decay rate', () => {
    const fit = fitDecay(decaySeries(30))!;
    expect(fit).not.toBeNull();
    expect(fit.dailyPct).toBeCloseTo(-3, 0);
    expect(fit.halfLifeDays).toBeCloseTo(22.8, 0);
  });

  it('returns null below three usable points', () => {
    expect(fitDecay([])).toBeNull();
    expect(fitDecay(decaySeries(2))).toBeNull();
  });

  it('drops zero-view days instead of clamping them', () => {
    // A clamped log(0) -> log(1) would drag the slope steeply negative.
    const s = decaySeries(20);
    s[10] = { ...s[10], views: 0 };
    const fit = fitDecay(s)!;
    expect(fit.dailyPct).toBeGreaterThan(-6);
    expect(fit.dailyPct).toBeLessThan(0);
  });

  it('reports no half-life for a series that is growing', () => {
    const fit = fitDecay(decaySeries(20, 1000, 1.05))!;
    expect(fit.dailyPct).toBeGreaterThan(0);
    expect(fit.halfLifeDays).toBeNull();
  });
});

describe('residuals', () => {
  it('are ~zero when the series is the trend itself', () => {
    const s = decaySeries(20);
    const rows = residuals(s, fitDecay(s)!, new Set());
    for (const r of rows) expect(Math.abs(r.residualPct)).toBeLessThan(1);
  });

  it('flags release days from the supplied set', () => {
    const s = decaySeries(10);
    const rows = residuals(s, fitDecay(s)!, new Set(['2026-07-03', '2026-07-07']));
    expect(rows.filter((r) => r.isReleaseDay).map((r) => r.date)).toEqual(['2026-07-03', '2026-07-07']);
  });
});

describe('assessImpact', () => {
  const mk = (pct: number, isReleaseDay: boolean, i: number) => ({
    date: `2026-07-${String(i + 1).padStart(2, '0')}`,
    actual: 100,
    expected: 100,
    residualPct: pct,
    isReleaseDay,
  });

  it('needs at least three of each kind', () => {
    expect(assessImpact([mk(0, true, 0), mk(0, false, 1)])).toBeNull();
  });

  it('calls a small gap inconclusive rather than clean', () => {
    // -1 vs +3.75 against wide scatter — the real Jul-Aug 2026 shape.
    const rows = [
      ...[-20, -10, 0, 5, 10, 15, -5, 8].map((p, i) => mk(p, true, i)),
      ...[-15, -8, 4, 9, 14, 18, 2, 6].map((p, i) => mk(p, false, i + 8)),
    ];
    const res = assessImpact(rows)!;
    expect(res.effectInSds).toBeLessThan(MIN_EFFECT_SDS);
    expect(res.verdict).toBe('inconclusive');
    // The wording must not let "inconclusive" be read as "proven safe".
    expect(res.summary).toMatch(/not as proof of no effect/i);
  });

  it('detects a genuine cannibalisation signal that clears the threshold', () => {
    const rows = [
      ...[-30, -28, -32, -29, -31].map((p, i) => mk(p, true, i)),
      ...[1, -1, 0, 2, -2].map((p, i) => mk(p, false, i + 5)),
    ];
    const res = assessImpact(rows)!;
    expect(res.verdict).toBe('cannibalising');
    expect(res.effectInSds).toBeGreaterThan(MIN_EFFECT_SDS);
    expect(res.differencePts).toBeLessThan(0);
  });

  it('detects the additive direction too', () => {
    const rows = [
      ...[30, 28, 32, 29, 31].map((p, i) => mk(p, true, i)),
      ...[1, -1, 0, 2, -2].map((p, i) => mk(p, false, i + 5)),
    ];
    expect(assessImpact(rows)!.verdict).toBe('additive');
  });
});

describe('newViewerSubsPer1k', () => {
  it('excludes already-subscribed views from the denominator', () => {
    // The real Jul 30 - Aug 5 week: headline 3.16, adjusted ~4.01.
    expect(newViewerSubsPer1k(97, 30678, 0)).toBeCloseTo(3.16, 1);
    expect(newViewerSubsPer1k(97, 30678, 6493)).toBeCloseTo(4.01, 1);
  });

  it('returns null when no eligible views remain', () => {
    expect(newViewerSubsPer1k(10, 500, 500)).toBeNull();
    expect(newViewerSubsPer1k(10, 500, 900)).toBeNull();
  });
});
