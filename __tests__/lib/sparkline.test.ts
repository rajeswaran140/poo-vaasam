import {
  buildScale,
  buildPath,
  provisionalFrom,
  nearestIndex,
  describeSeries,
  type SeriesPoint,
} from '@/lib/sparkline';

const pts = (...v: number[]): SeriesPoint[] =>
  v.map((value, i) => ({ date: `2026-07-${String(i + 1).padStart(2, '0')}`, value }));

describe('buildScale', () => {
  it('maps the first and last points to the horizontal extremes', () => {
    const s = buildScale(pts(1, 2, 3), 600, 80);
    expect(s.x(0)).toBe(0);
    expect(s.x(2)).toBe(600);
  });

  it('puts a single point in the middle rather than dividing by zero', () => {
    expect(buildScale(pts(5), 600, 80).x(0)).toBe(300);
  });

  it('draws a HIGHER value further up the SVG (smaller y)', () => {
    const s = buildScale(pts(10, 20), 600, 80);
    expect(s.y(20)).toBeLessThan(s.y(10));
  });

  it('does not anchor at zero — a narrow band must stay legible', () => {
    // Real shape: this channel sits at 4.3k-5.9k. A zero baseline would
    // flatten every genuine movement into a straight line.
    const s = buildScale(pts(4342, 5943), 600, 80);
    expect(s.min).toBeGreaterThan(4000);
  });

  it('survives a completely flat series without dividing by zero', () => {
    const s = buildScale(pts(7, 7, 7), 600, 80);
    expect(Number.isFinite(s.y(7))).toBe(true);
    expect(s.max).toBeGreaterThan(s.min);
  });

  it('keeps every plotted y inside the box', () => {
    const s = buildScale(pts(1, 50, 100), 600, 80);
    for (const v of [1, 50, 100]) {
      expect(s.y(v)).toBeGreaterThanOrEqual(0);
      expect(s.y(v)).toBeLessThanOrEqual(80);
    }
  });

  it('ignores non-finite values instead of poisoning the scale', () => {
    const s = buildScale([{ date: 'a', value: Number.NaN }, ...pts(10, 20)], 600, 80);
    expect(Number.isFinite(s.min)).toBe(true);
    expect(Number.isFinite(s.max)).toBe(true);
  });
});

describe('buildPath', () => {
  it('starts with a move and continues with lines', () => {
    const p = pts(1, 2, 3);
    const d = buildPath(p, buildScale(p, 600, 80));
    expect(d.startsWith('M')).toBe(true);
    expect((d.match(/L/g) ?? []).length).toBe(2);
  });

  it('returns empty for fewer than two points rather than a malformed path', () => {
    expect(buildPath(pts(1), buildScale(pts(1), 600, 80))).toBe('');
    expect(buildPath([], buildScale([], 600, 80))).toBe('');
  });

  it('can draw a slice, positioned by its ORIGINAL index', () => {
    const p = pts(1, 2, 3, 4);
    const s = buildScale(p, 600, 80);
    // A slice starting at index 2 must not restart at x=0.
    expect(buildPath(p, s, 2).startsWith('M400')).toBe(true);
  });
});

describe('provisionalFrom (never let a settling tail read as a decline)', () => {
  it('returns -1 when everything is finalized', () => {
    expect(provisionalFrom(pts(1, 2, 3))).toBe(-1);
  });

  it('starts one point EARLY so solid and dashed segments join', () => {
    const p: SeriesPoint[] = [
      { date: 'a', value: 1, isFinalized: true },
      { date: 'b', value: 2, isFinalized: true },
      { date: 'c', value: 3, isFinalized: false },
    ];
    expect(provisionalFrom(p)).toBe(1);
  });

  it('never returns a negative index when the first point is provisional', () => {
    expect(provisionalFrom([{ date: 'a', value: 1, isFinalized: false }])).toBe(0);
  });
});

describe('nearestIndex', () => {
  it('maps the extremes to the first and last points', () => {
    const p = pts(1, 2, 3, 4, 5);
    expect(nearestIndex(p, 0)).toBe(0);
    expect(nearestIndex(p, 1)).toBe(4);
  });

  it('snaps to the closest point mid-chart', () => {
    expect(nearestIndex(pts(1, 2, 3, 4, 5), 0.5)).toBe(2);
  });

  it('clamps a pointer dragged outside the chart', () => {
    const p = pts(1, 2, 3);
    expect(nearestIndex(p, -5)).toBe(0);
    expect(nearestIndex(p, 9)).toBe(2);
  });

  it('returns -1 for an empty series', () => {
    expect(nearestIndex([], 0.5)).toBe(-1);
  });
});

describe('describeSeries (screen-reader alternative)', () => {
  it('states direction and the range endpoints', () => {
    const d = describeSeries(pts(100, 200), 'Daily views');
    expect(d).toContain('up');
    expect(d).toContain('100');
    expect(d).toContain('200');
  });

  it('says down when the series falls', () => {
    expect(describeSeries(pts(200, 100), 'Daily views')).toContain('down');
  });

  it('says flat when it does not move', () => {
    expect(describeSeries(pts(5, 5), 'Daily views')).toContain('flat');
  });

  it('handles an empty series without throwing', () => {
    expect(describeSeries([], 'Daily views')).toContain('no data');
  });
});
