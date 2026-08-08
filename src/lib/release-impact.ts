/**
 * Release impact — is a new upload ADDITIVE or CANNIBALISING?
 *
 * Pure maths, no I/O, so the decision rule can be tested without the API.
 *
 * THE QUESTION. Raj publishes roughly every two days. The recurring worry is
 * that each upload steals distribution from the existing catalogue. The naive
 * check — compare catalogue views on release days vs quiet days — is badly
 * confounded, because releases cluster in periods when everything was higher.
 * Run raw over Jul 8 - Aug 5 2026 it reports the catalogue doing +65.6% BETTER
 * on release days, which is an artifact of the surge, not a finding.
 *
 * THE FIX. Fit an exponential decay to a FIXED cohort (songs published before a
 * cutoff, a definition that cannot drift as new songs appear), then compare
 * residuals on release days vs quiet days. Detrended, the same data gives
 * -0.99% vs +3.75%, a 4.7pt gap against a pooled sd of 14.1% — noise.
 *
 * Exponential rather than linear because view decay is multiplicative: a song
 * loses a roughly constant PERCENTAGE per day, not a constant number of views.
 * A linear fit would under-predict early and over-predict late, manufacturing
 * residuals that correlate with the calendar — and releases correlate with the
 * calendar too, so the artifact would land squarely on the thing being tested.
 */

export interface DayPoint {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  views: number;
}

export interface DecayFit {
  /** Natural-log intercept. */
  a: number;
  /** Natural-log slope per day (negative = decaying). */
  b: number;
  /** Percent change per day, e.g. -2.97. */
  dailyPct: number;
  /** Days for the cohort to halve at this rate; null if not decaying. */
  halfLifeDays: number | null;
}

/**
 * Least-squares fit of log(views) against day index.
 *
 * Zero/negative view days are DROPPED rather than clamped — log(0) is -Infinity
 * and a clamp to log(1) would invent a data point 3+ orders of magnitude below
 * the series, dragging the slope steeply negative. A channel with no views on a
 * day has no information about decay rate that day.
 */
export function fitDecay(series: DayPoint[]): DecayFit | null {
  const pts = series.filter((p) => p.views > 0);
  if (pts.length < 3) return null;
  const t = pts.map((_, i) => i);
  const y = pts.map((p) => Math.log(p.views));
  const n = t.length;
  const mt = t.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  const denom = t.reduce((s, ti) => s + (ti - mt) ** 2, 0);
  if (denom === 0) return null;
  const b = t.reduce((s, ti, i) => s + (ti - mt) * (y[i] - my), 0) / denom;
  const a = my - b * mt;
  return {
    a,
    b,
    dailyPct: (Math.exp(b) - 1) * 100,
    halfLifeDays: b < 0 ? Math.log(0.5) / b : null,
  };
}

export interface Residual {
  date: string;
  actual: number;
  expected: number;
  /** Percent above/below the fitted trend. */
  residualPct: number;
  isReleaseDay: boolean;
}

export function residuals(series: DayPoint[], fit: DecayFit, releaseDates: Set<string>): Residual[] {
  const pts = series.filter((p) => p.views > 0);
  return pts.map((p, i) => {
    const expected = Math.exp(fit.a + fit.b * i);
    return {
      date: p.date,
      actual: p.views,
      expected,
      residualPct: ((p.views - expected) / expected) * 100,
      isReleaseDay: releaseDates.has(p.date),
    };
  });
}

export type Verdict = 'additive' | 'cannibalising' | 'inconclusive';

export interface ImpactResult {
  releaseDays: number;
  quietDays: number;
  releaseMeanPct: number;
  quietMeanPct: number;
  /** Release-day mean minus quiet-day mean, in percentage points. */
  differencePts: number;
  /** Pooled standard deviation of all residuals. */
  pooledSd: number;
  /** |difference| expressed in standard deviations. */
  effectInSds: number;
  verdict: Verdict;
  summary: string;
}

/**
 * A verdict needs the gap to clear HALF a pooled standard deviation.
 *
 * Deliberately a blunt effect-size gate rather than a p-value. With ~30 daily
 * observations and one release every two days, a significance test would be
 * underpowered for anything but a huge effect, and reporting "p > 0.05" as
 * "no cannibalisation" would overstate what the data can carry. An effect-size
 * threshold says the honest thing instead: below this, the measurement cannot
 * tell the difference, which is NOT the same as proving there is none.
 */
export const MIN_EFFECT_SDS = 0.5;

export function assessImpact(rows: Residual[]): ImpactResult | null {
  const rel = rows.filter((r) => r.isReleaseDay).map((r) => r.residualPct);
  const quiet = rows.filter((r) => !r.isReleaseDay).map((r) => r.residualPct);
  if (rel.length < 3 || quiet.length < 3) return null;

  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
  const all = [...rel, ...quiet];
  const mAll = mean(all);
  const pooledSd = Math.sqrt(all.reduce((s, v) => s + (v - mAll) ** 2, 0) / all.length);

  const releaseMeanPct = mean(rel);
  const quietMeanPct = mean(quiet);
  const differencePts = releaseMeanPct - quietMeanPct;
  const effectInSds = pooledSd > 0 ? Math.abs(differencePts) / pooledSd : 0;

  let verdict: Verdict;
  let summary: string;
  if (effectInSds < MIN_EFFECT_SDS) {
    verdict = 'inconclusive';
    summary =
      `No detectable release-day effect — ${differencePts.toFixed(1)}pt gap is ` +
      `${effectInSds.toFixed(2)} sd, below the ${MIN_EFFECT_SDS} sd threshold. ` +
      `Treat as "not measurable at this sample size", not as proof of no effect.`;
  } else if (differencePts < 0) {
    verdict = 'cannibalising';
    summary =
      `Catalogue runs ${Math.abs(differencePts).toFixed(1)}pt BELOW trend on release days ` +
      `(${effectInSds.toFixed(2)} sd) — consistent with new uploads taking distribution from it.`;
  } else {
    verdict = 'additive';
    summary =
      `Catalogue runs ${differencePts.toFixed(1)}pt ABOVE trend on release days ` +
      `(${effectInSds.toFixed(2)} sd) — uploads coincide with the catalogue doing better, not worse.`;
  }
  return { releaseDays: rel.length, quietDays: quiet.length, releaseMeanPct, quietMeanPct,
           differencePts, pooledSd, effectInSds, verdict, summary };
}

/**
 * Subscriber conversion per 1,000 views, excluding views from people who are
 * ALREADY subscribed and therefore cannot subscribe again.
 *
 * The headline figure is diluted whenever the subscriber share rises — which is
 * exactly what happens as a channel matures. Measured Jun-Aug 2026 the headline
 * fell 4.29 -> 2.42 per 1k and read as decay, while subscriber-sourced views
 * went 9.7% -> 21.2% of the total; excluding them, the same weeks ended at 4.01,
 * the best since June. Always divide by the eligible denominator.
 */
export function newViewerSubsPer1k(netSubs: number, totalViews: number, subscriberViews: number): number | null {
  const eligible = totalViews - subscriberViews;
  if (!Number.isFinite(eligible) || eligible <= 0) return null;
  return (netSubs / eligible) * 1000;
}
