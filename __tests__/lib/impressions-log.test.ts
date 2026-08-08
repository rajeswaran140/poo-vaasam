import {
  validateEntry,
  withDeltas,
  interpret,
  MAX_CTR_PERCENT,
  type ImpressionEntry,
} from '@/lib/impressions-log';

const entry = (o: Partial<ImpressionEntry> & { observedAt: string }): ImpressionEntry => ({
  scope: 'CHANNEL',
  impressions: 100_000,
  ctr: 4,
  windowDays: 28,
  ...o,
});

describe('validateEntry', () => {
  it('accepts a plausible Studio reading', () => {
    expect(validateEntry({ impressions: 100_000, ctr: 4.2, views: 5_000 })).toEqual([]);
  });

  it('rejects negative or non-finite numbers', () => {
    expect(validateEntry({ impressions: -1, ctr: 4 })).toHaveLength(1);
    expect(validateEntry({ impressions: NaN, ctr: 4 })).toHaveLength(1);
    expect(validateEntry({ impressions: 100, ctr: -0.1 })).toHaveLength(1);
  });

  it('rejects a CTR above 100 percent', () => {
    expect(validateEntry({ impressions: 100, ctr: MAX_CTR_PERCENT + 0.1 })[0].field).toBe('ctr');
  });

  it('catches CTR entered as a fraction instead of a percent', () => {
    // 0.042 passes the range check but is 100x too small; the giveaway is that
    // impressions x CTR must not exceed the views those impressions produced.
    // Here the OPPOSITE mistake: 42 (percent) on 100k impressions => 42k clicks
    // against 5k views, which is impossible.
    const issues = validateEntry({ impressions: 100_000, ctr: 42, views: 5_000 });
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe('ctr');
    expect(issues[0].message).toMatch(/percent, not a fraction/);
  });

  it('does not fire the cross-check when views are omitted', () => {
    expect(validateEntry({ impressions: 100_000, ctr: 42 })).toEqual([]);
  });

  it('tolerates a small overshoot rather than flagging rounding', () => {
    // 4% of 100k = 4,000 clicks against 3,900 views — within the 5% allowance.
    expect(validateEntry({ impressions: 100_000, ctr: 4, views: 3_900 })).toEqual([]);
  });
});

describe('withDeltas', () => {
  it('sorts newest-first regardless of input order and computes changes', () => {
    const rows = withDeltas([
      entry({ observedAt: '2026-08-01T00:00:00.000Z', impressions: 90_000, ctr: 4.5 }),
      entry({ observedAt: '2026-08-08T00:00:00.000Z', impressions: 45_000, ctr: 5.5 }),
    ]);
    expect(rows[0].entry.observedAt).toBe('2026-08-08T00:00:00.000Z');
    expect(rows[0].impressionsChangePct).toBeCloseTo(-50, 5);
    expect(rows[0].ctrChangePts).toBeCloseTo(1, 5);
    expect(rows[0].daysSincePrevious).toBe(7);
  });

  it('leaves the oldest reading without a comparison', () => {
    const rows = withDeltas([entry({ observedAt: '2026-08-01T00:00:00.000Z' })]);
    expect(rows[0].impressionsChangePct).toBeNull();
    expect(rows[0].daysSincePrevious).toBeNull();
  });

  it('does not divide by zero when the previous reading was zero', () => {
    const rows = withDeltas([
      entry({ observedAt: '2026-08-01T00:00:00.000Z', impressions: 0 }),
      entry({ observedAt: '2026-08-08T00:00:00.000Z', impressions: 500 }),
    ]);
    expect(rows[0].impressionsChangePct).toBeNull();
  });
});

describe('interpret', () => {
  const d = (impressionsChangePct: number | null, ctrChangePts: number | null) => ({
    entry: entry({ observedAt: '2026-08-08T00:00:00.000Z' }),
    impressionsChangePct,
    ctrChangePts,
    daysSincePrevious: 7,
  });

  it('names the narrowing-but-better-matched case', () => {
    expect(interpret(d(-40, 1.2))).toMatch(/better-matched/i);
  });

  it('singles out the one combination worth acting on', () => {
    expect(interpret(d(-40, -1.2))).toMatch(/worth acting on/i);
  });

  it('names broad-but-worse-matched expansion', () => {
    expect(interpret(d(40, -1.2))).toMatch(/broader/i);
  });

  it('reports both rising', () => {
    expect(interpret(d(40, 1.2))).toMatch(/both up/i);
  });

  it('treats small moves as flat', () => {
    expect(interpret(d(2, 0.1))).toMatch(/unchanged/i);
  });

  it('says so plainly on a first reading', () => {
    expect(interpret(d(null, null))).toMatch(/first reading/i);
  });
});
