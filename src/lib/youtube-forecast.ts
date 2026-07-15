/**
 * YouTube channel forecasting + change-significance — the statistical layer that
 * reads the daily METRICSNAP series (see youtube-metrics-history) and answers the
 * two questions the dashboard keeps asking by eye (and getting wrong):
 *
 *   1. "When do I cross <target> subscribers?"        → forecastToTarget()
 *   2. "Is this dip/spike REAL or just daily noise?"  → assessChange()
 *      (+ detectLevelShift() to find WHEN reach actually shifted)
 *
 * Everything here is PURE + deterministic (no clock, no I/O) so it unit-tests
 * exactly and so an LLM narrator can only ever DESCRIBE these numbers, never
 * compute them. `asOf` is passed in rather than read from a clock for the same
 * reason. The route (api/admin/youtube/forecast) fetches the series + the live
 * subscriber count and hands them to these functions.
 *
 * Honesty guards:
 *  - Refuses to forecast on too few days (MIN_FORECAST_DAYS) — a 3-day window
 *    invents a trend.
 *  - If the net-subscriber pace is ≤ 0, reports NOT reachable rather than a
 *    nonsense "∞ days" or a negative ETA.
 *  - Surfaces a declining-pace caveat so a cooling surge isn't read as a steady
 *    climb (the exact mistake behind the "we're 8 days out!" over-optimism).
 *  - Significance uses a real two-sided Student-t p-value, not a hand-waved
 *    "looks big" threshold.
 */

/** Minimal shape the stats need; DailyMetricPoint is structurally compatible. */
export interface SeriesPoint {
  date: string; // YYYY-MM-DD
  views: number;
  netSubscribers: number;
}

/** Below this many days we refuse to forecast — the trend would be noise. */
export const MIN_FORECAST_DAYS = 5;
/** Default trailing window for the pace estimate. */
export const DEFAULT_RATE_WINDOW = 14;
/** 95% two-sided z for the rate confidence band. */
const Z_95 = 1.959964;

// ── numeric helpers (Numerical-Recipes incomplete beta → Student-t p) ──────────

/** Log Γ(x). Lanczos approximation. */
export function gammaln(x: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += cof[j] / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-12;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a,b). */
export function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x)
  );
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Two-sided Student-t p-value: P(|T_df| > |t|). */
export function studentTTwoSided(t: number, df: number): number {
  if (df <= 0 || !Number.isFinite(t)) return NaN;
  const x = df / (df + t * t);
  return betai(df / 2, 0.5, x);
}

// ── descriptive stats ──────────────────────────────────────────────────────────

function mean(xs: number[]): number {
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}
/** Sample variance (n−1). 0 for n<2. */
function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1);
}

export interface RateEstimate {
  ratePerDay: number; // mean daily net subs over the window
  stdErr: number; // standard error of that mean
  sampleDays: number;
  trendSlope: number; // OLS slope (Δ subs/day per day); <0 = decelerating
  trendDirection: 'rising' | 'flat' | 'declining';
}

/**
 * Estimate the current net-subscriber pace from the trailing `window` days,
 * plus whether that pace is itself trending up or down (OLS slope, kept only
 * when statistically distinguishable from flat at ~95%).
 */
export function estimateSubscriberRate(
  series: SeriesPoint[],
  window: number = DEFAULT_RATE_WINDOW
): RateEstimate | null {
  const pts = series.slice(-window);
  const n = pts.length;
  if (n < MIN_FORECAST_DAYS) return null;

  const y = pts.map((p) => p.netSubscribers);
  const ratePerDay = mean(y);
  const stdErr = Math.sqrt(variance(y) / n);

  // OLS slope of net subs vs day-index 0..n-1.
  const xs = y.map((_, i) => i);
  const mx = mean(xs);
  const my = ratePerDay;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (y[i] - my);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;

  // Slope significance: t = slope / SE(slope), df = n−2.
  let sse = 0;
  const intercept = my - slope * mx;
  for (let i = 0; i < n; i++) {
    const fit = intercept + slope * xs[i];
    sse += (y[i] - fit) ** 2;
  }
  let direction: RateEstimate['trendDirection'] = 'flat';
  if (n > 2 && sxx > 0) {
    const resVar = sse / (n - 2);
    const slopeSe = Math.sqrt(resVar / sxx);
    if (slopeSe === 0) {
      // Perfect fit: trust the sign only if the slope is non-trivial.
      if (Math.abs(slope) > 1e-9) direction = slope > 0 ? 'rising' : 'declining';
    } else {
      const tSlope = slope / slopeSe;
      if (Math.abs(tSlope) >= 2) direction = slope > 0 ? 'rising' : 'declining';
    }
  }

  return { ratePerDay, stdErr, sampleDays: n, trendSlope: slope, trendDirection: direction };
}

export interface Forecast {
  target: number;
  current: number;
  remaining: number;
  reachable: boolean;
  etaDays: number | null; // central estimate
  etaDaysFast: number | null; // optimistic end of the 95% pace band
  etaDaysSlow: number | null; // pessimistic end (null if the slow pace is ≤0)
  etaDate: string | null; // asOf + etaDays (central)
  rate: RateEstimate;
  caveat: string | null;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Forecast the days/date to reach `target` subscribers from `current`, with a
 * 95% band derived from the uncertainty in the estimated daily pace. `asOf` is
 * the YYYY-MM-DD the `current` count is true as of (the band and date anchor
 * off it). Returns null if there isn't enough history to estimate a pace.
 */
export function forecastToTarget(
  series: SeriesPoint[],
  opts: { current: number; target: number; asOf: string; window?: number }
): Forecast | null {
  const rate = estimateSubscriberRate(series, opts.window ?? DEFAULT_RATE_WINDOW);
  if (!rate) return null;

  const remaining = opts.target - opts.current;
  const base = {
    target: opts.target,
    current: opts.current,
    remaining,
    rate,
  };

  // Already there.
  if (remaining <= 0) {
    return {
      ...base,
      reachable: true,
      etaDays: 0,
      etaDaysFast: 0,
      etaDaysSlow: 0,
      etaDate: opts.asOf,
      caveat: null,
    };
  }

  // No forward progress at the current pace → honestly not reachable.
  if (rate.ratePerDay <= 0) {
    return {
      ...base,
      reachable: false,
      etaDays: null,
      etaDaysFast: null,
      etaDaysSlow: null,
      etaDate: null,
      caveat:
        'Net subscriber pace is ≤ 0 over the window — the target is not reachable at the current trend.',
    };
  }

  const fastRate = rate.ratePerDay + Z_95 * rate.stdErr;
  const slowRate = rate.ratePerDay - Z_95 * rate.stdErr;
  const etaDays = Math.ceil(remaining / rate.ratePerDay);
  const etaDaysFast = Math.ceil(remaining / fastRate);
  const etaDaysSlow = slowRate > 0 ? Math.ceil(remaining / slowRate) : null;

  let caveat: string | null = null;
  if (rate.trendDirection === 'declining') {
    caveat =
      'Pace is declining over the window — lean toward the slower end of the range.';
  } else if (rate.trendDirection === 'rising') {
    caveat = 'Pace is rising over the window — the faster end is plausible.';
  }

  return {
    ...base,
    reachable: true,
    etaDays,
    etaDaysFast,
    etaDaysSlow,
    etaDate: addDays(opts.asOf, etaDays),
    caveat,
  };
}

// ── change significance ─────────────────────────────────────────────────────────

export type ChangeMetric = 'views' | 'netSubscribers';

export interface ChangeAssessment {
  metric: ChangeMetric;
  recentDays: number;
  priorDays: number;
  recentMean: number;
  priorMean: number;
  deltaPct: number | null; // null when priorMean is 0 (can't divide)
  tStat: number;
  df: number;
  pValue: number;
  significant: boolean; // pValue < alpha
  direction: 'up' | 'down' | 'flat'; // 'flat' when not significant
}

/**
 * Welch's two-sample t-test on the most recent `recentDays` vs the `priorDays`
 * immediately before them, for the chosen metric. Answers "is the change real?"
 * with a real p-value rather than eyeballing. Returns null if either window is
 * too small to have a variance.
 */
export function assessChange(
  series: SeriesPoint[],
  opts?: {
    metric?: ChangeMetric;
    recentDays?: number;
    priorDays?: number;
    alpha?: number;
  }
): ChangeAssessment | null {
  const metric = opts?.metric ?? 'views';
  const recentDays = opts?.recentDays ?? 7;
  const priorDays = opts?.priorDays ?? 7;
  const alpha = opts?.alpha ?? 0.05;

  const val = (p: SeriesPoint) => (metric === 'views' ? p.views : p.netSubscribers);
  const recent = series.slice(-recentDays).map(val);
  const prior = series.slice(-(recentDays + priorDays), -recentDays).map(val);
  if (recent.length < 2 || prior.length < 2) return null;

  const m1 = mean(recent);
  const m2 = mean(prior);
  const v1 = variance(recent);
  const v2 = variance(prior);
  const n1 = recent.length;
  const n2 = prior.length;

  const seSq = v1 / n1 + v2 / n2;
  // Both windows constant (no variance): decide purely on whether means differ.
  if (seSq === 0) {
    const equal = m1 === m2;
    return {
      metric,
      recentDays: n1,
      priorDays: n2,
      recentMean: m1,
      priorMean: m2,
      deltaPct: m2 === 0 ? null : ((m1 - m2) / m2) * 100,
      tStat: equal ? 0 : Infinity,
      df: n1 + n2 - 2,
      pValue: equal ? 1 : 0,
      significant: !equal,
      direction: equal ? 'flat' : m1 > m2 ? 'up' : 'down',
    };
  }

  const t = (m1 - m2) / Math.sqrt(seSq);
  const df =
    seSq ** 2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1));
  const pValue = studentTTwoSided(t, df);
  const significant = pValue < alpha;

  return {
    metric,
    recentDays: n1,
    priorDays: n2,
    recentMean: m1,
    priorMean: m2,
    deltaPct: m2 === 0 ? null : ((m1 - m2) / m2) * 100,
    tStat: t,
    df,
    pValue,
    significant,
    direction: significant ? (m1 > m2 ? 'up' : 'down') : 'flat',
  };
}

export interface LevelShift {
  date: string; // the first day of the AFTER segment (where the shift begins)
  index: number;
  beforeMean: number;
  afterMean: number;
  tStat: number;
  pValue: number;
  significant: boolean;
}

/**
 * Find the single most likely level shift in the series (e.g. WHEN the reach
 * breakout started) by scanning every split with ≥ minSegment days on each side
 * and keeping the one with the largest pooled-variance |t|. Answers "when did
 * things change", complementing assessChange's "did they change".
 */
export function detectLevelShift(
  series: SeriesPoint[],
  opts?: { metric?: ChangeMetric; minSegment?: number; alpha?: number }
): LevelShift | null {
  const metric = opts?.metric ?? 'views';
  const minSegment = opts?.minSegment ?? 3;
  const alpha = opts?.alpha ?? 0.05;
  const val = (p: SeriesPoint) => (metric === 'views' ? p.views : p.netSubscribers);
  const y = series.map(val);
  const n = y.length;
  if (n < minSegment * 2) return null;

  let best: LevelShift | null = null;
  let bestAbsT = -1;
  for (let k = minSegment; k <= n - minSegment; k++) {
    const before = y.slice(0, k);
    const after = y.slice(k);
    const m1 = mean(before);
    const m2 = mean(after);
    const n1 = before.length;
    const n2 = after.length;
    // Pooled-variance two-sample t (equal-variance) — robust for a level shift.
    const sp2 =
      ((n1 - 1) * variance(before) + (n2 - 1) * variance(after)) / (n1 + n2 - 2);
    if (sp2 === 0) continue; // no variance either side → skip (degenerate)
    const t = (m2 - m1) / Math.sqrt(sp2 * (1 / n1 + 1 / n2));
    if (Math.abs(t) > bestAbsT) {
      bestAbsT = Math.abs(t);
      const df = n1 + n2 - 2;
      const pValue = studentTTwoSided(t, df);
      best = {
        date: series[k].date,
        index: k,
        beforeMean: m1,
        afterMean: m2,
        tStat: t,
        pValue,
        significant: pValue < alpha,
      };
    }
  }
  return best;
}

export interface ChannelAnalysis {
  asOf: string;
  current: number;
  forecast: Forecast | null;
  viewsChange: ChangeAssessment | null;
  subsChange: ChangeAssessment | null;
  reachShift: LevelShift | null;
}

/**
 * One-shot composition for the route/narrator: time-to-target forecast plus the
 * "is the recent move real" reads for views and net subs, plus the most likely
 * reach-shift day. Pure — the caller supplies the live subscriber count + asOf.
 */
export function analyzeChannel(
  series: SeriesPoint[],
  opts: { current: number; target: number; asOf: string; window?: number }
): ChannelAnalysis {
  return {
    asOf: opts.asOf,
    current: opts.current,
    forecast: forecastToTarget(series, opts),
    viewsChange: assessChange(series, { metric: 'views' }),
    subsChange: assessChange(series, { metric: 'netSubscribers' }),
    reachShift: detectLevelShift(series, { metric: 'views' }),
  };
}
