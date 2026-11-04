/**
 * Visual Story Studio — cost model.
 *
 * Grok rates are from xAI's pricing table, 2026-11-04. They are UNVERIFIED
 * against billing until Phase 4 (see GROK_RATES_VERIFIED_AT).
 *
 * Client-safe: no server SDK imports.
 */

import type { ShotMode } from '@/types/visualStory';

export { DEFAULT_BUDGET_USD_CAP } from '@/types/visualStory';

export interface RateCard {
  flatUsd: number;
  perSecondUsd: number;
}

type ProviderId = 'fake' | 'grok';

export const RATE_CARDS: Record<ProviderId, Record<ShotMode, RateCard>> = {
  fake: {
    STILL: { flatUsd: 0, perSecondUsd: 0 },
    MOTION: { flatUsd: 0, perSecondUsd: 0 },
    HERO: { flatUsd: 0, perSecondUsd: 0 },
  },
  grok: {
    // grok-image: $0.02 per image; duration does not apply.
    STILL: { flatUsd: 0.02, perSecondUsd: 0 },
    // grok-imagine-video-1.5-lite: $0.020 per second.
    MOTION: { flatUsd: 0, perSecondUsd: 0.02 },
    // grok-imagine-video-1.5: $0.080 per second.
    HERO: { flatUsd: 0, perSecondUsd: 0.08 },
  },
};

/** Set in Phase 4 once the rates are checked against real billing. */
export const GROK_RATES_VERIFIED_AT: string | null = null;

/** Flat planning estimate for one storyboard draft call. */
export const DRAFT_ESTIMATE_USD = 0.15;

/** Sonnet list price, USD per million tokens. */
export const SONNET_USD_PER_MTOK = { input: 3, output: 15 } as const;

export function estimateCostUsd(providerId: string, mode: ShotMode, durationSec: number): number {
  if (!Object.prototype.hasOwnProperty.call(RATE_CARDS, providerId)) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  const card = RATE_CARDS[providerId as ProviderId][mode];
  return card.flatUsd + card.perSecondUsd * durationSec;
}

export function draftCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens * SONNET_USD_PER_MTOK.input + outputTokens * SONNET_USD_PER_MTOK.output) /
    1_000_000
  );
}
