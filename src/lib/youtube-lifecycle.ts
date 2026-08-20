/**
 * Song Lifecycle — answers ONE question about a release:
 *
 *   "At its current age, is this song behaving unusually compared with
 *    previous TamilAgaval songs at the SAME age?"
 *
 * Not a collection of totals. Every output is age-relative.
 *
 * Two outputs are produced and MUST NOT be collapsed into one another:
 *   - ARCHETYPE       — the SHAPE of distribution over time (size-blind)
 *   - PERFORMANCE     — the SIZE, as an age-matched percentile against peers
 * A 5k-view song can share an archetype with a 54k-view song without being
 * equivalent in performance.
 *
 * Everything here is PURE and unit-tested against real catalogue fixtures in
 * __tests__/fixtures/lifecycle-songs.json. The network fetch that assembles the
 * input lives in lib/youtube-analytics.
 *
 * Honesty guards (do not fake what the API cannot give):
 *  - `impressions` / `impressionsClickThroughRate` DO NOT EXIST in the YouTube
 *    Analytics API ("Unknown identifier"); they are Studio Reach-tab only. Views
 *    per 1K impressions and CTR are therefore ABSENT here and must not be
 *    approximated from views.
 *  - A milestone whose age has not been reached returns `null`, never 0. A song
 *    inside the ~3-day analytics lag has no rows at all — that is an empty cell,
 *    not a result.
 *  - The age-matched peer pool thins as songs age. Below MIN_PEERS the percentile
 *    returns `null` rather than a number derived from three comparisons.
 *  - "Evergreen" is NOT a permitted term: the catalogue's oldest observation is
 *    ~87 days. Use persistent / late-distributing / catalogue-active.
 *
 * See docs/SONG_LIFECYCLE.md for the derivation and the backfill evidence.
 */

/** Smoothing window (days) applied before peak and wave detection. */
const SMOOTH_WINDOW = 3;
/** Minimum lifetime views before a song is scored at all. */
export const MIN_TOTAL_VIEWS = 50;
/** Minimum same-age peers before an age-matched percentile is meaningful. */
export const MIN_PEERS = 5;
/** Observable age required before CPR is reported. */
export const CPR_MIN_AGE = 14;
/** Observable age required before the D31-D90 persistence ratio is reported. */
export const CPR_31_90_MIN_AGE = 60;
/** Observable age required before a performance class is anything but 'Developing'. */
export const CLASSIFY_MIN_AGE = 28;
/** A secondary wave must exceed its preceding trough by this factor... */
const WAVE_PROMINENCE = 1.25;
/** ...and reach at least this fraction of the primary peak. */
const WAVE_MIN_PEAK_FRACTION = 0.15;
/** Long-form/Shorts boundary in seconds (a 2:18 "Short" exists in the catalogue). */
export const SHORT_MAX_SECONDS = 180;

export const MILESTONE_DAYS = [1, 3, 7, 14, 28, 60, 90] as const;
export type MilestoneDay = (typeof MILESTONE_DAYS)[number];

export type LifecycleArchetype =
  | 'Multi-wave'
  | 'Delayed breakout'
  | 'Slow burn'
  | 'Early burst-decay'
  | 'Standard decay';

export type PerformanceClass =
  | 'Breakout'
  | 'Strong'
  | 'Normal'
  | 'Slow-burn'
  | 'Weak'
  | 'Developing';

// ---- Raw input (assembled by the fetcher; all API-native numbers) ----------

export interface LifecycleDailyPoint {
  /** ISO date, YYYY-MM-DD. */
  day: string;
  views: number;
  likes?: number;
  shares?: number;
  subscribersGained?: number;
  estimatedMinutesWatched?: number;
  /** 0..100 */
  averageViewPercentage?: number;
}

export interface LifecycleInput {
  videoId: string;
  /** ISO date of publish; becomes D0. */
  publishedAt: string;
  durationSeconds: number;
  /** Last FINALIZED day in the analytics series — never "today". */
  lastFinalizedDay: string;
  daily: LifecycleDailyPoint[];
}

// ---- Output ---------------------------------------------------------------

export interface LifecycleFeatures {
  videoId: string;
  /** lastFinalizedDay − publishedAt, in days. */
  observableAge: number;
  isShort: boolean;
  totalViews: number;
  /** Daily views indexed by age: index 0 is D0. */
  series: number[];
  /** Cumulative views at each milestone; null where the age is not yet reached. */
  milestones: Record<`D${MilestoneDay}`, number | null>;
  earlyVelocity: number;
  peakDay: number;
  peakDailyViews: number;
  /** Peak daily views ÷ median daily views. */
  peakMagnitude: number;
  /** Slope of log daily views from peak to peak+14; negative = decaying. */
  postPeakDecay: number | null;
  waveCount: number;
  /** Strongest secondary wave ÷ peak. */
  waveStrength: number;
  /** Catalogue Persistence Ratio: views after D7 ÷ lifetime. Null before CPR_MIN_AGE. */
  cpr: number | null;
  /** Views D31-D90 ÷ lifetime. Null before CPR_31_90_MIN_AGE. */
  cpr31to90: number | null;
  /** Mean daily views over the last 7 finalized days ÷ peak. */
  residualVelocity: number;
  likesPer1k: number;
  sharesPer1k: number;
  subsPer1k: number;
  /** View-weighted average view percentage, or null if never reported. */
  averageViewPercentage: number | null;
}

export interface AgeMatchedResult {
  percentile: number;
  peerCount: number;
}

// ---- Helpers --------------------------------------------------------------

function daysBetween(fromIso: string, toIso: string): number {
  const MS_PER_DAY = 86_400_000;
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / MS_PER_DAY);
}

/** Trailing moving average; keeps the array length so ages stay aligned. */
export function smooth(series: number[], window = SMOOTH_WINDOW): number[] {
  return series.map((_, i) => {
    const slice = series.slice(Math.max(0, i - window + 1), i + 1);
    return slice.reduce((s, v) => s + v, 0) / slice.length;
  });
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Daily views indexed by AGE (index 0 = publish day). Days the API did not
 * return are genuine zeroes within the observed span.
 */
export function toAgeSeries(input: LifecycleInput): number[] {
  const observableAge = daysBetween(input.publishedAt, input.lastFinalizedDay);
  const series = new Array<number>(Math.max(observableAge + 1, 1)).fill(0);
  for (const point of input.daily) {
    const age = daysBetween(input.publishedAt, point.day);
    if (age >= 0 && age <= observableAge) series[age] = point.views;
  }
  return series;
}

/** Cumulative views at each milestone; null where observableAge < n. */
export function computeMilestones(
  series: number[],
  observableAge: number,
): Record<`D${MilestoneDay}`, number | null> {
  const out = {} as Record<`D${MilestoneDay}`, number | null>;
  for (const n of MILESTONE_DAYS) {
    out[`D${n}`] =
      observableAge >= n
        ? series.slice(0, n + 1).reduce((s, v) => s + v, 0)
        : null;
  }
  return out;
}

/**
 * Catalogue Persistence Ratio — views arriving after D7 as a share of lifetime.
 * Separates launch-dependent songs from catalogue assets. Validated on the
 * catalogue: long-form median 0.602 vs Shorts 0.201, a 3x separation on a format
 * distinction the metric was never told about.
 */
export function catalogPersistenceRatio(
  series: number[],
  observableAge: number,
): number | null {
  if (observableAge < CPR_MIN_AGE) return null;
  const total = series.reduce((s, v) => s + v, 0);
  if (total <= 0) return null;
  return series.slice(8).reduce((s, v) => s + v, 0) / total;
}

/** Secondary distribution waves after the primary peak. */
function detectWaves(
  smoothed: number[],
  peakIndex: number,
  peak: number,
): { waveCount: number; waveStrength: number } {
  let waveCount = 0;
  let waveStrength = 0;
  let i = peakIndex + 3;
  while (i < smoothed.length - 1) {
    const isLocalMax = smoothed[i] > smoothed[i - 1] && smoothed[i] >= smoothed[i + 1];
    if (isLocalMax) {
      const trough = Math.min(...smoothed.slice(peakIndex, i + 1));
      const prominent = trough > 0 && smoothed[i] / trough >= WAVE_PROMINENCE;
      const material = smoothed[i] >= WAVE_MIN_PEAK_FRACTION * peak;
      if (prominent && material) {
        waveCount += 1;
        waveStrength = Math.max(waveStrength, smoothed[i] / peak);
        i += 5; // don't re-count the same wave's shoulder
        continue;
      }
    }
    i += 1;
  }
  return { waveCount, waveStrength };
}

// ---- Feature computation --------------------------------------------------

export function computeFeatures(input: LifecycleInput): LifecycleFeatures | null {
  const observableAge = daysBetween(input.publishedAt, input.lastFinalizedDay);
  const series = toAgeSeries(input);
  const totalViews = series.reduce((s, v) => s + v, 0);
  if (totalViews < MIN_TOTAL_VIEWS) return null;

  const smoothed = smooth(series);
  let peakDay = 0;
  for (let i = 1; i < smoothed.length; i += 1) {
    if (smoothed[i] > smoothed[peakDay]) peakDay = i;
  }
  const peakDailyViews = smoothed[peakDay];
  const dailyMedian = median(series);

  // Decay slope: log-linear fit over the 14 days following the peak.
  let postPeakDecay: number | null = null;
  const decayWindow = series.slice(peakDay, peakDay + 15).filter((v) => v > 0);
  if (decayWindow.length >= 5) {
    const ys = decayWindow.map((v) => Math.log(v));
    const n = ys.length;
    const meanX = (n - 1) / 2;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;
    let num = 0;
    let den = 0;
    ys.forEach((y, x) => {
      num += (x - meanX) * (y - meanY);
      den += (x - meanX) ** 2;
    });
    postPeakDecay = den === 0 ? 0 : num / den;
  }

  const { waveCount, waveStrength } = detectWaves(smoothed, peakDay, peakDailyViews);

  const sum = (key: keyof LifecycleDailyPoint) =>
    input.daily.reduce((s, d) => s + ((d[key] as number | undefined) ?? 0), 0);

  const weighted = input.daily.filter(
    (d) => d.views > 0 && typeof d.averageViewPercentage === 'number' && d.averageViewPercentage > 0,
  );
  const avpTotal = weighted.reduce((s, d) => s + d.views, 0);
  const averageViewPercentage =
    avpTotal > 0
      ? weighted.reduce((s, d) => s + d.views * (d.averageViewPercentage ?? 0), 0) / avpTotal
      : null;

  const lastSeven = series.slice(-7);
  const residualVelocity =
    peakDailyViews > 0 ? lastSeven.reduce((s, v) => s + v, 0) / 7 / peakDailyViews : 0;

  return {
    videoId: input.videoId,
    observableAge,
    isShort: input.durationSeconds <= SHORT_MAX_SECONDS,
    totalViews,
    series,
    milestones: computeMilestones(series, observableAge),
    earlyVelocity: series.slice(0, 3).reduce((s, v) => s + v, 0),
    peakDay,
    peakDailyViews,
    peakMagnitude: dailyMedian > 0 ? peakDailyViews / dailyMedian : 0,
    postPeakDecay,
    waveCount,
    waveStrength,
    cpr: catalogPersistenceRatio(series, observableAge),
    cpr31to90:
      observableAge >= CPR_31_90_MIN_AGE && totalViews > 0
        ? series.slice(31, 91).reduce((s, v) => s + v, 0) / totalViews
        : null,
    residualVelocity,
    likesPer1k: (1000 * sum('likes')) / totalViews,
    sharesPer1k: (1000 * sum('shares')) / totalViews,
    subsPer1k: (1000 * sum('subscribersGained')) / totalViews,
    averageViewPercentage,
  };
}

// ---- Archetype: SHAPE only, deliberately size-blind ------------------------

/**
 * Observed distribution across 63 long-form catalogue songs (2026-08-20):
 * Multi-wave 23 · Early burst-decay 20 · Standard decay 9 · Delayed breakout 7 ·
 * Slow burn 4. All five populate; none is degenerate.
 *
 * Note "persistence" is deliberately NOT an archetype — it is a continuous
 * property measured by `cpr`, and duplicating it as a class added nothing
 * (the rule matched zero songs).
 */
export function classifyArchetype(features: LifecycleFeatures): LifecycleArchetype {
  if (features.waveCount >= 2) return 'Multi-wave';
  const earlyDailyMean = features.earlyVelocity / 3;
  if (features.peakDay >= 10 && features.peakDailyViews >= 2 * Math.max(earlyDailyMean, 1)) {
    return 'Delayed breakout';
  }
  if (features.peakDay >= 7) return 'Slow burn';
  if (features.peakDay <= 2 && features.cpr !== null && features.cpr < 0.55) {
    return 'Early burst-decay';
  }
  return 'Standard decay';
}

// ---- Performance: SIZE, age-matched ---------------------------------------

/**
 * Percentile of this song's cumulative views at its own age, against every peer's
 * cumulative views at the SAME age. Returns null when too few peers have reached
 * that age — which is the normal state past ~D75 on a catalogue this young, and
 * resolves on its own as songs age.
 */
export function ageMatchedPercentile(
  target: LifecycleFeatures,
  peers: LifecycleFeatures[],
): AgeMatchedResult | null {
  const age = target.observableAge;
  const comparable = peers
    .filter((p) => p.videoId !== target.videoId && p.observableAge >= age && p.isShort === target.isShort)
    .map((p) => p.series.slice(0, age + 1).reduce((s, v) => s + v, 0));
  if (comparable.length < MIN_PEERS) return null;
  const below = comparable.filter((v) => v < target.totalViews).length;
  return {
    percentile: (100 * below) / comparable.length,
    peerCount: comparable.length,
  };
}

/**
 * CLASSIFY, do not declare success or failure. 'Developing' means the song is not
 * old enough to classify — it is not a poor result.
 */
export function classifyPerformance(
  features: LifecycleFeatures,
  ageMatched: AgeMatchedResult | null,
): PerformanceClass | null {
  if (features.observableAge < CLASSIFY_MIN_AGE) return 'Developing';
  if (!ageMatched) return null;
  const { percentile } = ageMatched;
  if (percentile >= 90) return 'Breakout';
  if (percentile >= 70) return 'Strong';
  if (percentile >= 40) return 'Normal';
  // Below the middle but still accumulating = slow-burn, not weak.
  const stillAccumulating =
    (features.cpr !== null && features.cpr >= 0.7) || features.residualVelocity >= 0.25;
  return stillAccumulating ? 'Slow-burn' : 'Weak';
}
