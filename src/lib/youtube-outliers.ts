/**
 * Catalogue Outlier Finder — rank Tamilagaval's OWN songs by a multi-signal,
 * weighted "Outlier Score" so the proven winners get amplified (Shorts, FB,
 * WhatsApp, website) and their title/thumbnail packaging gets cloned for new
 * uploads. Grouping the same scores by theme answers the release question:
 * "which kind of song (mother / love / nature / …) does my audience reward?"
 *
 * This adapts the vidIQ "video outlier" idea to a MUSIC channel: instead of
 * chasing trending topics (which a lyricist can't), we measure the variables
 * Raj actually controls — reach, retention, click-through, subscriber
 * conversion, engagement, long-tail growth — RELATIVE TO HIS OWN CATALOGUE.
 * An outlier is simply a song that stands well above his own norm.
 *
 * Everything here is PURE + deterministic (no clock, no I/O). `asOf` is passed
 * in (never read from a clock) so views/day is reproducible and an LLM narrator
 * can only ever DESCRIBE these numbers, never compute them. The route fetches
 * the raw per-video stats and hands them to these functions.
 *
 * Why a ROBUST score (median / MAD, not mean / std-dev): the whole point is to
 * find the song that towers over the rest, but a single viral hit would inflate
 * a mean-and-std z-score and hide everyone else. The modified z-score
 * (Iglewicz–Hoaglin) measures deviation against the MEDIAN and MAD, so one
 * breakout doesn't distort the yardstick used to judge the others.
 *
 * Honesty guards:
 *  - Missing signals don't penalize a song: CTR and shares are Studio-only and
 *    often absent from the API, so each song's weights are RENORMALIZED over the
 *    signals it actually has. A song with no CTR is judged on the rest.
 *  - Signals with no spread across the catalogue (every song identical) carry no
 *    outlier information and are dropped, rather than diluting every score.
 *  - A one-song catalogue has no "norm" to be an outlier of → every z is 0.
 *  - All six signals are oriented "higher = better"; feed rates, not raw counts,
 *    for the per-1k / per-day signals (deriveSignals does this).
 */

// ── signal model ────────────────────────────────────────────────────────────────

/** The six weighted signals. All are oriented so that HIGHER is better. */
export type SignalKey =
  | 'viewsPerDay'
  | 'subsPer1k' // subscriber conversion: subscribers gained per 1,000 views
  | 'retention' // averageViewPercentage (0–100)
  | 'ctr' // impressions click-through rate (0–100); Studio-only, may be absent
  | 'engagement' // comments per 1,000 views
  | 'growth30d'; // long-tail: how much a song keeps growing after its first 30 days

export const SIGNAL_KEYS: readonly SignalKey[] = [
  'viewsPerDay',
  'subsPer1k',
  'retention',
  'ctr',
  'engagement',
  'growth30d',
] as const;

/** Per-song signal values. A null/undefined signal is treated as "not measured". */
export interface SongSignals {
  videoId: string;
  title: string;
  theme?: string | null;
  viewsPerDay?: number | null;
  subsPer1k?: number | null;
  retention?: number | null;
  ctr?: number | null;
  engagement?: number | null;
  growth30d?: number | null;
}

export type SignalWeights = Record<SignalKey, number>;

/** Raj's weighting (2026-07-15). Need not sum to 1 — normalized internally. */
export const DEFAULT_WEIGHTS: SignalWeights = {
  viewsPerDay: 0.25,
  subsPer1k: 0.2,
  retention: 0.2,
  ctr: 0.2,
  engagement: 0.1,
  growth30d: 0.05,
};

/** Composite z at/above which a song is called an outlier (robust SDs above norm). */
export const DEFAULT_OUTLIER_THRESHOLD = 2.0;

// ── robust statistics ───────────────────────────────────────────────────────────

/** MAD→σ consistency constant for normal data (1/0.67449). */
const MAD_TO_SIGMA = 1.4826;
/** MeanAbsDev→σ consistency constant for normal data (√(π/2)). */
const MEANAD_TO_SIGMA = 1.2533;

/** Median of a non-empty numeric array. Returns NaN for an empty array. */
export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median absolute deviation from the median. 0 when ≥ half the values tie. */
export function mad(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

/**
 * Robust modified z-scores for one signal across the catalogue (Iglewicz–Hoaglin).
 * Uses MAD; falls back to the mean absolute deviation when MAD is 0 (i.e. a
 * majority of songs tie but a few differ), and to all-zeros when there is no
 * spread at all. Higher raw value → higher z.
 */
export function modifiedZScores(xs: number[]): number[] {
  const n = xs.length;
  if (n === 0) return [];
  const m = median(xs);
  const madv = mad(xs);
  let scale = madv * MAD_TO_SIGMA;
  if (scale === 0) {
    const meanAd = xs.reduce((s, x) => s + Math.abs(x - m), 0) / n;
    scale = meanAd * MEANAD_TO_SIGMA;
  }
  if (scale === 0) return xs.map(() => 0); // no spread → no outlier information
  return xs.map((x) => (x - m) / scale);
}

// ── ranking ─────────────────────────────────────────────────────────────────────

export interface SignalBreakdown {
  key: SignalKey;
  value: number; // the raw signal value
  z: number; // robust modified z across the catalogue
  weight: number; // effective (renormalized) weight this song gave the signal
}

export interface RankedSong {
  videoId: string;
  title: string;
  theme: string | null;
  /** Weighted mean of the present, informative signals' robust z-scores. */
  score: number;
  rank: number; // 1 = strongest outlier
  isOutlier: boolean;
  /** Per-signal detail for every signal that was present + informative. */
  breakdown: SignalBreakdown[];
}

export interface RankOptions {
  weights?: SignalWeights;
  outlierThreshold?: number;
}

function signalValue(song: SongSignals, key: SignalKey): number | null {
  const v = song[key];
  return v == null || !Number.isFinite(v) ? null : v;
}

/**
 * Rank a catalogue by composite Outlier Score (desc). Each signal is turned into
 * a robust z-score across the whole catalogue; a song's score is the
 * weight-renormalized mean of the z-scores for the signals it actually has that
 * also carry spread. Ties keep input order (stable). Empty input → [].
 */
export function rankOutliers(songs: SongSignals[], opts: RankOptions = {}): RankedSong[] {
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const threshold = opts.outlierThreshold ?? DEFAULT_OUTLIER_THRESHOLD;
  if (songs.length === 0) return [];

  // Per signal: gather the songs that HAVE it, compute robust z over just those,
  // and record whether the signal carried any spread (informative).
  const zByKey = new Map<SignalKey, Map<number, number>>(); // key → (songIndex → z)
  const informative = new Set<SignalKey>();
  for (const key of SIGNAL_KEYS) {
    const idxs: number[] = [];
    const vals: number[] = [];
    songs.forEach((song, i) => {
      const v = signalValue(song, key);
      if (v != null) {
        idxs.push(i);
        vals.push(v);
      }
    });
    if (vals.length === 0) continue;
    const zs = modifiedZScores(vals);
    if (zs.some((z) => z !== 0)) informative.add(key);
    const map = new Map<number, number>();
    idxs.forEach((songIdx, j) => map.set(songIdx, zs[j]));
    zByKey.set(key, map);
  }

  const ranked: Omit<RankedSong, 'rank'>[] = songs.map((song, i) => {
    const breakdown: SignalBreakdown[] = [];
    let weightSum = 0;
    let weighted = 0;
    for (const key of SIGNAL_KEYS) {
      if (!informative.has(key)) continue;
      const z = zByKey.get(key)?.get(i);
      const value = signalValue(song, key);
      if (z == null || value == null) continue;
      const w = weights[key] ?? 0;
      if (w <= 0) continue;
      weightSum += w;
      weighted += w * z;
      breakdown.push({ key, value, z, weight: w });
    }
    // Renormalize the effective weights so the score is a proper weighted mean.
    if (weightSum > 0) {
      for (const b of breakdown) b.weight = b.weight / weightSum;
    }
    const score = weightSum > 0 ? weighted / weightSum : 0;
    return {
      videoId: song.videoId,
      title: song.title,
      theme: song.theme ?? null,
      score,
      isOutlier: score >= threshold,
      breakdown,
    };
  });

  // Stable sort by score desc: decorate with original index to break ties.
  return ranked
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.score - a.r.score || a.i - b.i)
    .map(({ r }, idx) => ({ ...r, rank: idx + 1 }));
}

// ── theme rollup ─────────────────────────────────────────────────────────────────

export interface ThemeSummary {
  theme: string;
  count: number;
  meanScore: number;
  /** Mean of each present raw signal across the theme's songs (nulls ignored). */
  meanSignals: Partial<Record<SignalKey, number>>;
  outlierCount: number;
}

/**
 * Roll ranked songs up by theme so Raj can decide what to release next:
 * "mother songs strongest? nature songs best CTR?". Songs with no theme fall
 * under the '(untagged)' group. Sorted by mean score desc (theme name as
 * tie-break) so the strongest-performing themes lead.
 */
export function summarizeByTheme(ranked: RankedSong[], songs: SongSignals[]): ThemeSummary[] {
  const byId = new Map(songs.map((s) => [s.videoId, s]));
  const groups = new Map<string, RankedSong[]>();
  for (const r of ranked) {
    const theme = r.theme && r.theme.trim() !== '' ? r.theme : '(untagged)';
    const arr = groups.get(theme) ?? [];
    arr.push(r);
    groups.set(theme, arr);
  }

  const summaries: ThemeSummary[] = [];
  for (const [theme, members] of groups) {
    const meanScore = members.reduce((s, m) => s + m.score, 0) / members.length;
    const meanSignals: Partial<Record<SignalKey, number>> = {};
    for (const key of SIGNAL_KEYS) {
      const vals = members
        .map((m) => signalValue(byId.get(m.videoId) ?? ({} as SongSignals), key))
        .filter((v): v is number => v != null);
      if (vals.length > 0) {
        meanSignals[key] = vals.reduce((s, v) => s + v, 0) / vals.length;
      }
    }
    summaries.push({
      theme,
      count: members.length,
      meanScore,
      meanSignals,
      outlierCount: members.filter((m) => m.isOutlier).length,
    });
  }
  return summaries.sort((a, b) => b.meanScore - a.meanScore || a.theme.localeCompare(b.theme));
}

// ── theme join ────────────────────────────────────────────────────────────────

/**
 * Index resolved (videoId → theme) pairs into a lookup the route uses to stamp
 * each YouTube video with its catalogue theme (so summarizeByTheme groups by a
 * real theme instead of '(untagged)'). Theme resolution — the DB override vs the
 * curated map — happens upstream (config/song-themes); this only indexes the
 * results. Skips entries with no videoId or no theme; first entry wins on a
 * duplicate id (deterministic).
 */
export function indexThemesByVideo(
  entries: Array<{ youtubeVideoId?: string | null; theme?: string | null }>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of entries) {
    const id = e.youtubeVideoId?.trim();
    if (!id || map.has(id)) continue;
    if (e.theme != null && e.theme !== '') map.set(id, e.theme);
  }
  return map;
}

// ── deriving rate signals from raw counts ─────────────────────────────────────────

/** Raw per-video counts the route pulls from the YouTube Data API. */
export interface RawVideoStats {
  videoId: string;
  title: string;
  theme?: string | null;
  publishedAt: string; // ISO 8601
  views: number;
  subscribersGained?: number | null; // from Analytics (per-video); optional
  comments?: number | null;
  // Pass-through analytics signals (not derivable from raw counts):
  retention?: number | null; // averageViewPercentage
  ctr?: number | null;
  growth30d?: number | null;
}

/** Whole days between an ISO instant and a YYYY-MM-DD date, floored, min 1. */
export function ageInDays(publishedAtIso: string, asOf: string): number {
  const pub = new Date(publishedAtIso).getTime();
  const as = new Date(`${asOf}T23:59:59.999Z`).getTime();
  if (!Number.isFinite(pub) || !Number.isFinite(as)) return 1;
  const days = Math.floor((as - pub) / 86_400_000);
  return Math.max(1, days);
}

/**
 * Long-tail / durability ratio for the growth30d signal = a song's RECENT
 * views/day ÷ its LIFETIME views/day. >1 means it's still pulling views faster
 * than its own lifetime average (a durable slow-burn); <1 means it spiked early
 * and cooled (the exact thing this signal is meant to penalize). Returns null
 * for songs younger than `minAgeDays` — a song still in its first month has no
 * "tail" to measure yet, so it must not be scored as if it did.
 */
export function longTailRatio(opts: {
  recentViews: number;
  recentWindowDays: number;
  lifetimeViews: number;
  ageDays: number;
  minAgeDays?: number;
}): number | null {
  const minAge = opts.minAgeDays ?? 60;
  if (opts.ageDays < minAge || opts.ageDays <= 0 || opts.lifetimeViews <= 0) return null;
  const lifetimePerDay = opts.lifetimeViews / opts.ageDays;
  if (lifetimePerDay <= 0) return null;
  const recentPerDay = opts.recentViews / Math.min(opts.recentWindowDays, opts.ageDays);
  return recentPerDay / lifetimePerDay;
}

/**
 * Turn raw per-video counts into the rate signals the score needs (views/day,
 * subs-per-1k, comments-per-1k), passing retention/ctr/growth30d through. `asOf`
 * is the date the counts are current as of — passed in, never clocked — so
 * views/day is reproducible.
 */
export function deriveSignals(raw: RawVideoStats, asOf: string): SongSignals {
  const age = ageInDays(raw.publishedAt, asOf);
  const views = Math.max(0, raw.views);
  const per1k = (n: number | null | undefined) =>
    n == null ? null : views > 0 ? (n / views) * 1000 : 0;
  return {
    videoId: raw.videoId,
    title: raw.title,
    theme: raw.theme ?? null,
    viewsPerDay: views / age,
    subsPer1k: per1k(raw.subscribersGained),
    engagement: per1k(raw.comments),
    retention: raw.retention ?? null,
    ctr: raw.ctr ?? null,
    growth30d: raw.growth30d ?? null,
  };
}
