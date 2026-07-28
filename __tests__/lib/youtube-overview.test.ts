import {
  resolveWindow,
  resolveCustomWindow,
  isPartial,
  SELECTABLE_RANGES,
  summariseOverview,
  deltaPct,
  deriveExactSubscribers,
  daysBetween,
  RANGE_DAYS,
  type DailyPoint,
} from '@/lib/youtube-overview';
import { latestSubscriberAnchor, SUBSCRIBER_ANCHORS } from '@/config/youtube-subscriber-anchor';

/** The channel's real series: starts 2026-05-22, finalized through 2026-07-25. */
const DATA_START = '2026-05-22';
const DATA_END = '2026-07-25';

const points = (spec: Array<[string, number, number, number, number]>): DailyPoint[] =>
  spec.map(([date, views, mins, gained, lost]) => ({
    date,
    views,
    estimatedMinutesWatched: mins,
    subscribersGained: gained,
    subscribersLost: lost,
  }));

describe('resolveWindow', () => {
  it('builds a 28d window ending on the last finalized day', () => {
    const w = resolveWindow('28d', DATA_START, DATA_END);
    expect(w.current).toEqual({ from: '2026-06-28', to: '2026-07-25', days: 28 });
  });

  it('places the comparison window immediately before, same length', () => {
    const w = resolveWindow('28d', DATA_START, DATA_END);
    expect(w.previous).toEqual({ from: '2026-05-31', to: '2026-06-27', days: 28 });
    expect(daysBetween(w.previous.from, w.previous.to)).toBe(28);
  });

  it('leaves no gap or overlap between the two windows', () => {
    const w = resolveWindow('28d', DATA_START, DATA_END);
    expect(daysBetween(w.previous.to, w.current.from)).toBe(2); // adjacent days
  });

  it('marks 28d computable on the real history', () => {
    const w = resolveWindow('28d', DATA_START, DATA_END);
    expect(w.insufficientHistory).toBe(false);
    expect(w.missingDays).toBe(0);
    expect(w.availableFrom).toBeNull();
  });

  it('marks 90d NOT computable and says how much history is missing', () => {
    const w = resolveWindow('90d', DATA_START, DATA_END);
    expect(w.insufficientHistory).toBe(true);
    expect(w.missingDays).toBeGreaterThan(0);
  });

  it('marks 365d NOT computable', () => {
    expect(resolveWindow('365d', DATA_START, DATA_END).insufficientHistory).toBe(true);
  });

  it('names the date a blocked range becomes available', () => {
    const w = resolveWindow('90d', DATA_START, DATA_END);
    // 90d needs 180 days of history; real data starts 2026-05-22, so the
    // comparison window reaches 115 days too far back. dataEnd must advance by
    // exactly that shortfall: 2026-07-25 + 115d.
    expect(w.missingDays).toBe(115);
    expect(w.availableFrom).toBe('2026-11-17');
    expect(daysBetween(DATA_END, w.availableFrom!) - 1).toBe(w.missingDays);
  });

  it('7d is computable, being the least demanding range', () => {
    expect(resolveWindow('7d', DATA_START, DATA_END).insufficientHistory).toBe(false);
  });

  it('needs twice the range in history, which is the whole problem', () => {
    // A 28d comparison spans 56 days; the channel has ~65.
    const w = resolveWindow('28d', DATA_START, DATA_END);
    expect(daysBetween(w.previous.from, w.current.to)).toBe(2 * RANGE_DAYS['28d']);
  });
});

describe('deltaPct', () => {
  it('computes a normal increase', () => {
    expect(deltaPct(201_404, 94_556)).toBeCloseTo(113.0, 0);
  });

  it('returns null rather than Infinity when the previous period was zero', () => {
    expect(deltaPct(500, 0)).toBeNull();
  });

  it('returns null rather than NaN for a non-finite baseline', () => {
    expect(deltaPct(500, Number.NaN)).toBeNull();
  });

  it('reports a decrease as negative', () => {
    expect(deltaPct(50, 100)).toBe(-50);
  });
});

describe('summariseOverview', () => {
  const series = points([
    // previous window (2 days of it)
    ['2026-06-26', 100, 600, 5, 1],
    ['2026-06-27', 100, 600, 5, 1],
    // current window
    ['2026-06-28', 300, 1800, 12, 2],
    ['2026-07-25', 300, 1800, 12, 2],
    // outside both — must be ignored
    ['2026-05-22', 9999, 9999, 999, 999],
  ]);
  const w = resolveWindow('28d', DATA_START, DATA_END);

  it('sums only the days inside each window', () => {
    const s = summariseOverview(series, w);
    expect(s.views.value).toBe(600);
    expect(s.views.previous).toBe(200);
  });

  it('converts watch minutes to hours', () => {
    expect(summariseOverview(series, w).watchTimeHours.value).toBe(60);
  });

  it('reports subscribers as net, with gained and lost broken out', () => {
    const s = summariseOverview(series, w);
    expect(s.subscribersNet.gained).toBe(24);
    expect(s.subscribersNet.lost).toBe(4);
    expect(s.subscribersNet.value).toBe(20);
  });

  it('does not let a day outside both windows leak into any total', () => {
    const s = summariseOverview(series, w);
    expect(s.views.value).toBeLessThan(9999);
    expect(s.subscribersNet.gained).toBeLessThan(999);
  });

  it('yields a null delta when the comparison window is empty', () => {
    const s = summariseOverview(points([['2026-07-25', 300, 60, 3, 0]]), w);
    expect(s.views.previous).toBe(0);
    expect(s.views.deltaPct).toBeNull();
  });
});

describe('deriveExactSubscribers', () => {
  const anchor = { date: '2026-07-27', count: 1118, source: 'Studio' };

  it('returns the anchor itself when nothing has accumulated', () => {
    const r = deriveExactSubscribers(anchor, [], '2026-07-27');
    expect(r!.count).toBe(1118);
    expect(r!.daysSinceAnchor).toBe(0);
  });

  it('accumulates net change AFTER the anchor day', () => {
    const r = deriveExactSubscribers(
      anchor,
      points([
        ['2026-07-27', 0, 0, 50, 0], // the anchor day itself — already counted
        ['2026-07-28', 0, 0, 10, 2],
        ['2026-07-29', 0, 0, 5, 1],
      ]),
      '2026-07-29'
    );
    expect(r!.count).toBe(1118 + 12);
  });

  it('stops at throughDate rather than consuming the whole series', () => {
    const r = deriveExactSubscribers(
      anchor,
      points([
        ['2026-07-28', 0, 0, 10, 0],
        ['2026-07-29', 0, 0, 999, 0],
      ]),
      '2026-07-28'
    );
    expect(r!.count).toBe(1128);
    expect(r!.asOf).toBe('2026-07-28');
  });

  it('reports asOf so the tile cannot imply live precision', () => {
    expect(deriveExactSubscribers(anchor, [], '2026-07-28')!.asOf).toBe('2026-07-28');
  });

  it('exposes drift exposure as days since the anchor', () => {
    expect(deriveExactSubscribers(anchor, [], '2026-08-06')!.daysSinceAnchor).toBe(10);
  });

  it('returns null instead of guessing when there is no anchor', () => {
    expect(deriveExactSubscribers(null, [], '2026-07-28')).toBeNull();
  });

  it('does NOT return null when the anchor is ahead of the finalized data', () => {
    // The normal state after every re-anchor: Studio is exact today while
    // Analytics still lags 2-3 days. Blanking the tile here would hide the
    // figure exactly when it is most trustworthy.
    const r = deriveExactSubscribers(anchor, [], '2026-07-25');
    expect(r).not.toBeNull();
    expect(r!.count).toBe(1118);
    expect(r!.asOf).toBe('2026-07-27');
    expect(r!.daysSinceAnchor).toBe(0);
  });

  it('does not accumulate BACKWARDS from an anchor that is ahead', () => {
    // Days before the anchor are already baked into it; counting them again
    // would double-subtract.
    const r = deriveExactSubscribers(
      anchor,
      points([
        ['2026-07-24', 0, 0, 40, 0],
        ['2026-07-25', 0, 0, 40, 0],
      ]),
      '2026-07-25'
    );
    expect(r!.count).toBe(1118);
  });
});

describe('subscriber anchor config', () => {
  it('ships the Studio reading of 1,118 on 2026-07-27', () => {
    const a = latestSubscriberAnchor();
    expect(a!.count).toBe(1118);
    expect(a!.date).toBe('2026-07-27');
  });

  it('picks the newest anchor at or before a date', () => {
    expect(latestSubscriberAnchor('2026-07-26')).toBeNull();
    expect(latestSubscriberAnchor('2026-12-31')!.count).toBe(1118);
  });

  it('records where each anchor came from so it can be re-derived', () => {
    expect(SUBSCRIBER_ANCHORS.every((a) => a.source.length > 0)).toBe(true);
  });
});

describe('SELECTABLE_RANGES', () => {
  it('offers 7d, 28d and 90d', () => {
    expect([...SELECTABLE_RANGES]).toEqual(['7d', '28d', '90d']);
  });

  it('omits 365d, which is not computable until 2028', () => {
    expect(SELECTABLE_RANGES).not.toContain('365d');
  });
});

describe('isPartial (Analytics lags 48-72h)', () => {
  it('is true when the newest data predates today — the normal state', () => {
    expect(isPartial('2026-07-25', '2026-07-28')).toBe(true);
  });

  it('is false only once data reaches today', () => {
    expect(isPartial('2026-07-28', '2026-07-28')).toBe(false);
  });
});

describe('fixture parity — Studio Overview, Jun 30 to Jul 27 2026', () => {
  // Pinned to an EXPLICIT date range, not a relative 28d: the stored series
  // currently ends 2026-07-25, two days short of Studio's window, so a relative
  // request cannot reproduce these totals. Widening a tolerance until it passed
  // would destroy the test. Per-day values are seeded to Studio's reported
  // totals, so this pins the AGGREGATION, and the live comparison happens once
  // 07-26 and 07-27 finalize.
  const FROM = '2026-06-30';
  const TO = '2026-07-27';
  const STUDIO_VIEWS = 201_404;
  const STUDIO_WATCH_HOURS = 8802.4;
  const STUDIO_NET_SUBS = 658;

  const seeded: DailyPoint[] = [
    { date: FROM, views: 100_000, estimatedMinutesWatched: 264_000, subscribersGained: 300, subscribersLost: 20 },
    { date: TO, views: 101_404, estimatedMinutesWatched: 264_144, subscribersGained: 431, subscribersLost: 53 },
    // Outside the window — must not leak in.
    { date: '2026-06-29', views: 999_999, estimatedMinutesWatched: 999_999, subscribersGained: 999, subscribersLost: 0 },
  ];

  it('spans exactly 28 days', () => {
    expect(resolveCustomWindow(FROM, TO, DATA_START).current.days).toBe(28);
  });

  it('reproduces Studio views for the pinned range', () => {
    const w = resolveCustomWindow(FROM, TO, DATA_START);
    expect(summariseOverview(seeded, w).views.value).toBe(STUDIO_VIEWS);
  });

  it('reproduces Studio watch hours to one decimal', () => {
    const w = resolveCustomWindow(FROM, TO, DATA_START);
    expect(summariseOverview(seeded, w).watchTimeHours.value).toBeCloseTo(STUDIO_WATCH_HOURS, 1);
  });

  it('reproduces Studio net subscribers', () => {
    const w = resolveCustomWindow(FROM, TO, DATA_START);
    expect(summariseOverview(seeded, w).subscribersNet.value).toBe(STUDIO_NET_SUBS);
  });
});

describe('partial-window behaviour for a relative request today', () => {
  // This is what a live 28d request must report while the series lags — the
  // behaviour actually worth locking in, separate from the fixture above.
  const TODAY = '2026-07-28';

  it('ends the window on the last FINALIZED day, not today', () => {
    expect(resolveWindow('28d', DATA_START, DATA_END).current.to).toBe('2026-07-25');
  });

  it('flags the result as partial', () => {
    expect(isPartial(DATA_END, TODAY)).toBe(true);
  });

  it('is two days short of the Studio fixture window, which is why it is pinned separately', () => {
    expect(daysBetween(DATA_END, '2026-07-27') - 1).toBe(2);
  });
});
