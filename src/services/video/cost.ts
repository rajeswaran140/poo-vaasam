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

/** Flat planning estimate for one storyboard draft call (the figure the UI shows). */
export const DRAFT_ESTIMATE_USD = 0.15;

/** The storyboarder's max_tokens: no draft can bill more output than this. */
export const DRAFT_MAX_OUTPUT_TOKENS = 6000;
/** System prompt + tool schema + framing, in tokens (rounded up). */
export const DRAFT_PROMPT_OVERHEAD_TOKENS = 1500;

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

/**
 * What a draft reserves against the cap (M1): bounded by the lyrics length —
 * ~2 characters per input token plus the prompt overhead — and the output
 * ceiling. ⚠️ Tamil script can tokenise denser than 2 chars/token, so the real
 * input cost can exceed this; the overshoot is bounded by the 8000-char lyrics
 * limit (a few cents) and is recorded as spend at settle.
 */
export function draftReserveUsd(lyrics: string): number {
  return draftCostUsd(Math.ceil(lyrics.length / 2) + DRAFT_PROMPT_OVERHEAD_TOKENS, DRAFT_MAX_OUTPUT_TOKENS);
}

/** The price the Draft button shows: the flat estimate when it covers the reservation, else the reservation. */
export function draftLabelUsd(lyrics: string, estimateUsd: number = DRAFT_ESTIMATE_USD): number {
  return Math.max(estimateUsd, draftReserveUsd(lyrics));
}
