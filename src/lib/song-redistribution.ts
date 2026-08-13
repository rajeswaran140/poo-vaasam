/**
 * REDISTRIBUTION SCORE — "which song deserves another push, rather than another song?"
 *
 * Raj's framing (2026-08-13): a song with strong listener response but weak
 * distribution is a candidate for REDISTRIBUTION, not replacement. It answers
 * the question his loyalty framework was built around —
 * **"the song failed" vs "the song wasn't distributed enough."**
 *
 * WHY THIS IS NOT THE OUTLIER FINDER. `youtube-outliers.ts` ranks
 * `viewsPerDay` as higher-is-better (weight 0.25 in DEFAULT_WEIGHTS), so a
 * high-quality low-reach song scores BADLY there — it is precisely the song
 * that lens hides. This is the inverse: quality MINUS reach.
 *
 *     redistribution = quality(z) − reach(z)
 *
 * Both terms come from `rankOutliers`, run twice with different weightings, so
 * every guard that lens already earned is inherited rather than re-derived:
 * robust median/MAD z-scores, renormalisation over present signals, dropping
 * signals with no spread, log-compression of heavy tails.
 *
 * ⚠️ RETENTION IS SCORED WITHIN THEME, and that is load-bearing. Love songs on
 * this channel retain 51-62% while family / grief / philosophical retain 22-36%
 * ([[feedback_tamilagaval_channel_status_framing]]). Scoring retention globally
 * would mark every non-love song as low quality and systematically bury the
 * resonance lane — the exact songs this tool exists to surface. So a song's
 * retention is compared to its OWN theme's median before scoring.
 *
 * ⚠️ NOT A NEW WEEKLY METRIC. The Monday loyalty digest is frozen
 * ([[feedback_tamilagaval_loyalty_framework]]). This is a per-song tool run on
 * demand; it must not be folded into that digest.
 *
 * Pure and deterministic — no clock, no I/O, no LLM. `asOf` is passed in.
 */

import {
  rankOutliers,
  MIN_VELOCITY_AGE_DAYS,
  MIN_RATE_VIEWS,
  median,
  type SongSignals,
  type SignalWeights,
} from '@/lib/youtube-outliers';

/**
 * QUALITY: how well the song lands on the people who reach it. Deliberately
 * carries NO viewsPerDay — reach is the other half of the subtraction, and
 * including it on both sides would cancel the signal we are looking for.
 *
 * Weights mirror Raj's sketch (retention × subs/1k × engagement) with the two
 * advocacy rates added, since a share is the strongest "this moved me" signal
 * the API exposes.
 */
export const QUALITY_WEIGHTS: SignalWeights = {
  viewsPerDay: 0,
  subsPer1k: 0.3,
  retention: 0.3,
  ctr: 0,
  engagement: 0.1, // comments per 1k
  growth30d: 0,
  likesPer1k: 0.1,
  sharesPer1k: 0.2,
};

/** REACH: how much distribution the song is currently getting. */
export const REACH_WEIGHTS: SignalWeights = {
  viewsPerDay: 1,
  subsPer1k: 0,
  retention: 0,
  ctr: 0,
  engagement: 0,
  growth30d: 0,
  likesPer1k: 0,
  sharesPer1k: 0,
};

/** A song must clear both floors before its rates mean anything. */
export interface RedistributionInput extends SongSignals {
  /** Lifetime views — below MIN_RATE_VIEWS the per-1k rates are noise. */
  views: number;
  /** Days since publication — below MIN_VELOCITY_AGE_DAYS reach is launch velocity. */
  ageDays: number;
}

export interface RedistributionResult {
  videoId: string;
  title: string;
  theme: string | null;
  /** quality − reach. Positive = better received than distributed. */
  score: number;
  quality: number;
  reach: number;
  rank: number;
  /** Plain-language reason, built from the numbers — never an LLM. */
  why: string;
}

/** Songs excluded before scoring, each with the reason. */
export interface Ineligible {
  videoId: string;
  title: string;
  reason: 'too-young' | 'too-few-views';
}

/**
 * Replace each song's retention with its distance from its OWN theme's median,
 * so a 34% grief song and a 58% love song are judged against their own kind.
 *
 * A theme needs `minPerTheme` songs to have a usable median; below that the
 * song keeps its raw retention (there is nothing better to compare it to) and
 * the global distribution absorbs it. Songs with no theme are left alone.
 */
export function themeRelativeRetention<T extends SongSignals>(
  songs: readonly T[],
  minPerTheme = 3
): T[] {
  const byTheme = new Map<string, number[]>();
  for (const s of songs) {
    if (!s.theme || typeof s.retention !== 'number') continue;
    const arr = byTheme.get(s.theme) ?? [];
    arr.push(s.retention);
    byTheme.set(s.theme, arr);
  }
  const medians = new Map<string, number>();
  for (const [theme, xs] of byTheme) {
    if (xs.length >= minPerTheme) medians.set(theme, median(xs));
  }
  return songs.map((s) => {
    if (!s.theme || typeof s.retention !== 'number') return { ...s };
    const m = medians.get(s.theme);
    return m === undefined ? { ...s } : { ...s, retention: s.retention - m };
  });
}

/** Split the catalogue into songs old and watched enough to judge, and the rest. */
export function partitionEligible(songs: readonly RedistributionInput[]): {
  eligible: RedistributionInput[];
  ineligible: Ineligible[];
} {
  const eligible: RedistributionInput[] = [];
  const ineligible: Ineligible[] = [];
  for (const s of songs) {
    if (s.ageDays < MIN_VELOCITY_AGE_DAYS) {
      ineligible.push({ videoId: s.videoId, title: s.title, reason: 'too-young' });
    } else if (s.views < MIN_RATE_VIEWS) {
      ineligible.push({ videoId: s.videoId, title: s.title, reason: 'too-few-views' });
    } else {
      eligible.push(s);
    }
  }
  return { eligible, ineligible };
}

/** One sentence naming what is actually unusual about this song. */
function explain(quality: number, reach: number, theme: string | null): string {
  const t = theme ? `${theme} song` : 'song';
  if (quality > 0 && reach < 0) {
    return `Well received but under-distributed — this ${t} converts above the catalogue norm while getting below-average reach.`;
  }
  if (quality > 0 && reach >= 0) {
    return `Strong on both response and reach — already working; redistribution would add less here.`;
  }
  if (quality <= 0 && reach < 0) {
    return `Low reach AND below-norm response — pushing this one harder is unlikely to pay off.`;
  }
  return `Widely distributed but below-norm response — reach is not the constraint.`;
}

/**
 * Rank the catalogue by how much MORE distribution a song deserves than it is
 * getting. Highest score first; rank 1 = the strongest "rediscover this" case.
 */
export function rankRedistribution(
  songs: readonly RedistributionInput[]
): { ranked: RedistributionResult[]; ineligible: Ineligible[] } {
  const { eligible, ineligible } = partitionEligible(songs);
  if (!eligible.length) return { ranked: [], ineligible };

  const adjusted = themeRelativeRetention(eligible);
  const quality = rankOutliers(adjusted, { weights: QUALITY_WEIGHTS });
  const reach = rankOutliers(adjusted, { weights: REACH_WEIGHTS });
  const reachById = new Map(reach.map((r) => [r.videoId, r.score]));

  const ranked = quality
    .map((q) => {
      const r = reachById.get(q.videoId) ?? 0;
      return {
        videoId: q.videoId,
        title: q.title,
        theme: q.theme,
        score: q.score - r,
        quality: q.score,
        reach: r,
        rank: 0,
        why: explain(q.score, r, q.theme),
      };
    })
    .sort((a, b) => b.score - a.score || a.videoId.localeCompare(b.videoId))
    .map((x, i) => ({ ...x, rank: i + 1 }));

  return { ranked, ineligible };
}

/**
 * The headline the dashboard shows: the single best redistribution candidate,
 * or null when nothing qualifies (every song already distributed in line with
 * how it is received — a legitimate answer, not a failure).
 */
export function topRediscovery(
  ranked: readonly RedistributionResult[],
  minScore = 0.5
): RedistributionResult | null {
  const best = ranked[0];
  if (!best || best.score < minScore) return null;
  // Only a song that is genuinely under-reached is worth resurfacing; a song
  // that scores well merely because everything else is worse is not.
  return best.quality > 0 && best.reach < 0 ? best : null;
}
