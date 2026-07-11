/**
 * Opportunity Score for a tracked search query, per Raj's model:
 *
 *   Opportunity = Search-Position Weight × Intent Relevance × Conversion Potential
 *
 * - Position weight: 1.0 at #1, decaying with position; 0 when the song wasn't
 *   found in the observed window (a real gap = a real opportunity to improve).
 * - Intent relevance: how on-topic the query bucket is for the song.
 * - Conversion potential: how likely a searcher on it wants exactly this song.
 *
 * Pure + framework-free so the weights are transparent, tunable, and unit-tested.
 * All positions fed in are HUMAN-OBSERVED, never a search.list API rank.
 */

import type { TrackedQuery, QueryIntent, ConversionPotential } from '@/config/song-search-queries';

export const INTENT_RELEVANCE: Record<QueryIntent, number> = {
  father_loss: 1.0,
  english_diaspora: 0.9,
  tamil_search: 0.9,
  grief: 0.7,
  discovery: 0.5,
};

export const CONVERSION_WEIGHT: Record<ConversionPotential, number> = {
  high: 1.0,
  medium: 0.6,
  low: 0.3,
};

/**
 * 1.0 at position #1, decaying (1 / log2(position + 1)); 0 when not found
 * (position null/≤0). Monotonically non-increasing in position.
 */
export function positionWeight(position: number | null): number {
  if (position == null || position < 1) return 0;
  return 1 / Math.log2(position + 1);
}

/** Opportunity Score in [0, 1]. Higher = a higher-value place to already rank. */
export function opportunityScore(query: TrackedQuery, position: number | null): number {
  return positionWeight(position) * INTENT_RELEVANCE[query.intent] * CONVERSION_WEIGHT[query.conversion];
}

/**
 * The inverse framing that's often more actionable: the *gap* — a query with
 * high intent × conversion but a poor/absent position is where to focus next.
 * Returns the potential score if this query were ranked #1, minus the current.
 */
export function opportunityGap(query: TrackedQuery, position: number | null): number {
  const ceiling = INTENT_RELEVANCE[query.intent] * CONVERSION_WEIGHT[query.conversion]; // position #1
  return ceiling - opportunityScore(query, position);
}
