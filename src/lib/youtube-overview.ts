/**
 * Studio-parity Overview: totals for a window, plus the period-over-period
 * delta ("113% more than previous 28 days").
 *
 * Pure and clock-free (`now` is injected) so every window and delta is unit
 * tested, and so an LLM narrator can only ever DESCRIBE these numbers — the
 * same rule the forecast layer follows.
 *
 * HISTORY IS SHORTER THAN THE RANGE SELECTOR SUGGESTS. The channel's real
 * series begins 2026-05-22; anything earlier simply does not exist upstream
 * (Analytics returns no rows, and the 129 zero-filled placeholder rows that
 * used to sit in front of it were deleted 2026-07-28 precisely so no caller
 * could average them in by accident).
 *
 * A period-over-period comparison needs TWICE the window: 28d needs 56 days of
 * history, 90d needs 180. With ~67 days available, 7d and 28d are computable
 * and 90d/365d are not. Rather than quietly return a partial or zero-padded
 * number — which looks like a real answer and is not — `resolveWindow` reports
 * `insufficientHistory` and says how many days are missing, so the UI can
 * disable the option and name the date it becomes available.
 */

import type { SubscriberAnchor } from '@/config/youtube-subscriber-anchor';

export const RANGE_DAYS = { '7d': 7, '28d': 28, '90d': 90, '365d': 365 } as const;
export type RangeKey = keyof typeof RANGE_DAYS;

/**
 * What the range selector actually offers.
 *
 * 365d is deliberately ABSENT: with real data starting 2026-05-22 it is not
 * computable until 2028-05-20, and a two-year-out "available from" tooltip is
 * noise rather than information. 90d IS offered — it clears 2026-11-17, close
 * enough that showing it disabled with a date is useful. Reintroduce 365d when
 * it comes within about a quarter of viable. RANGE_DAYS keeps all four so the
 * maths stays available to callers that ask explicitly.
 */
export const SELECTABLE_RANGES: readonly RangeKey[] = ['7d', '28d', '90d'] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

const toIso = (d: Date): string => d.toISOString().slice(0, 10);
const parse = (iso: string): number => Date.parse(`${iso}T00:00:00.000Z`);
const shift = (iso: string, days: number): string => toIso(new Date(parse(iso) + days * DAY_MS));
/** Inclusive day count between two ISO dates. */
export const daysBetween = (from: string, to: string): number =>
  Math.round((parse(to) - parse(from)) / DAY_MS) + 1;

export interface Window {
  from: string;
  to: string;
  days: number;
}

export interface ResolvedWindow {
  range: RangeKey | 'custom';
  current: Window;
  previous: Window;
  /** True when `previous` reaches back before real data begins. */
  insufficientHistory: boolean;
  /** How many more days of history the comparison needs. 0 when satisfied. */
  missingDays: number;
  /**
   * The date this range becomes computable, given the data start. Null when it
   * already is. Lets the UI say "available from 2026-08-20" instead of just
   * disabling the option with no explanation.
   */
  availableFrom: string | null;
}

/**
 * Build the current and comparison windows for a range.
 *
 * `dataEnd` is the last day with finalized data (NOT today — Analytics lags),
 * and `dataStart` is the first day that exists at all.
 */
export function resolveWindow(
  range: RangeKey,
  dataStart: string,
  dataEnd: string
): ResolvedWindow {
  const days = RANGE_DAYS[range];
  const current: Window = { from: shift(dataEnd, -(days - 1)), to: dataEnd, days };
  const previous: Window = {
    from: shift(current.from, -days),
    to: shift(current.from, -1),
    days,
  };

  const missingDays = Math.max(0, Math.round((parse(dataStart) - parse(previous.from)) / DAY_MS));
  const insufficientHistory = missingDays > 0;

  return {
    range,
    current,
    previous,
    insufficientHistory,
    missingDays,
    // dataEnd must advance by `missingDays` before the comparison window clears
    // the start of real data.
    availableFrom: insufficientHistory ? shift(dataEnd, missingDays) : null,
  };
}

export interface DailyPoint {
  date: string;
  views: number;
  estimatedMinutesWatched: number;
  subscribersGained: number;
  subscribersLost: number;
}

export interface MetricDelta {
  value: number;
  previous: number;
  /** Null when the previous period is zero — NOT Infinity, and not 100. */
  deltaPct: number | null;
}

/** Percentage change, refusing to invent a number from a zero baseline. */
export function deltaPct(value: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return ((value - previous) / previous) * 100;
}

const sumIn = (points: DailyPoint[], w: Window, pick: (p: DailyPoint) => number): number =>
  points.reduce((acc, p) => (p.date >= w.from && p.date <= w.to ? acc + (pick(p) || 0) : acc), 0);

export interface OverviewMetrics {
  views: MetricDelta;
  watchTimeHours: MetricDelta;
  subscribersNet: MetricDelta & { gained: number; lost: number };
}

/** Totals for both windows plus their deltas. */
export function summariseOverview(points: DailyPoint[], resolved: ResolvedWindow): OverviewMetrics {
  const { current, previous } = resolved;

  const build = (pick: (p: DailyPoint) => number, round?: (n: number) => number): MetricDelta => {
    const raw = sumIn(points, current, pick);
    const rawPrev = sumIn(points, previous, pick);
    const value = round ? round(raw) : raw;
    const prev = round ? round(rawPrev) : rawPrev;
    return { value, previous: prev, deltaPct: deltaPct(raw, rawPrev) };
  };

  const gained = sumIn(points, current, (p) => p.subscribersGained);
  const lost = sumIn(points, current, (p) => p.subscribersLost);
  const netPrev =
    sumIn(points, previous, (p) => p.subscribersGained) -
    sumIn(points, previous, (p) => p.subscribersLost);

  return {
    views: build((p) => p.views),
    watchTimeHours: build(
      (p) => p.estimatedMinutesWatched / 60,
      (n) => Math.round(n * 10) / 10
    ),
    subscribersNet: {
      value: gained - lost,
      previous: netPrev,
      deltaPct: deltaPct(gained - lost, netPrev),
      gained,
      lost,
    },
  };
}

export interface ExactSubscribers {
  count: number;
  /** The day the figure is accurate TO — not "now". */
  asOf: string;
  anchorDate: string;
  /** Days of accumulation since the anchor; drift grows with this. */
  daysSinceAnchor: number;
}

/**
 * Reconstruct an exact subscriber count by accumulating daily net change onto a
 * known-exact anchor.
 *
 * The result is exact AS OF the last finalized day, not as of now: Analytics
 * lags 48–72h, so the trailing days simply are not in the series yet. Callers
 * must label it with `asOf` rather than implying live precision.
 *
 * Returns null when there is no usable anchor, rather than guessing.
 */
export function deriveExactSubscribers(
  anchor: SubscriberAnchor | null,
  points: DailyPoint[],
  throughDate: string
): ExactSubscribers | null {
  if (!anchor) return null;

  // AN ANCHOR NEWER THAN THE FINALIZED SERIES IS THE NORMAL STATE, not an error.
  // Studio is exact TODAY while Analytics still lags 2-3 days, so every
  // re-anchor lands ahead of `throughDate` and stays there for days. Returning
  // null there would blank the tile precisely when the figure is at its most
  // trustworthy, and accumulating backwards would subtract days the anchor
  // already includes. Correct handling is: accumulate nothing, and report the
  // count as accurate AS OF THE ANCHOR'S OWN DATE.
  const net = points.reduce(
    (acc, p) =>
      // Days strictly AFTER the anchor (it already includes its own day) and no
      // later than the finalized series. Empty when the anchor is ahead.
      p.date > anchor.date && p.date <= throughDate
        ? acc + (p.subscribersGained || 0) - (p.subscribersLost || 0)
        : acc,
    0
  );
  const asOf = throughDate > anchor.date ? throughDate : anchor.date;
  return {
    count: anchor.count + net,
    asOf,
    anchorDate: anchor.date,
    daysSinceAnchor: Math.max(0, daysBetween(anchor.date, asOf) - 1),
  };
}

/**
 * Is the newest data older than today? Analytics lags 48-72h, so this is
 * normally TRUE and the UI must say "estimates, subject to revision" rather
 * than implying the window runs to today.
 */
export function isPartial(dataEnd: string, today: string): boolean {
  return dataEnd < today;
}

/**
 * Windows for an explicit from/to range (§8's `custom`). The comparison period
 * is the equally-long span immediately before it.
 */
export function resolveCustomWindow(from: string, to: string, dataStart: string): ResolvedWindow {
  const days = daysBetween(from, to);
  const current: Window = { from, to, days };
  const previous: Window = { from: shift(from, -days), to: shift(from, -1), days };
  const missingDays = Math.max(0, Math.round((parse(dataStart) - parse(previous.from)) / DAY_MS));
  return {
    range: 'custom',
    current,
    previous,
    insufficientHistory: missingDays > 0,
    missingDays,
    availableFrom: missingDays > 0 ? shift(to, missingDays) : null,
  };
}
