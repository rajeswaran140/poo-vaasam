/**
 * Visual Story Studio — cost model.
 *
 * Grok IMAGE rate is from xAI's pricing table, 2026-11-04. Grok VIDEO rates
 * are measured from xAI's own per-request usage (`cost_in_usd_ticks`) on six
 * real clips, 2026-11-10 to 2026-11-13 (see grokVideoCostUsd). Neither is
 * checked against the xAI billing console yet (see GROK_RATES_VERIFIED_AT).
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
    // Video clips are priced by grokVideoCostUsd (resolution + input images),
    // never from this card. The studio sends every clip as HERO; the 1080p
    // per-second rate here is only the upper bound for a caller without the shot.
    MOTION: { flatUsd: 0, perSecondUsd: 0.25 },
    HERO: { flatUsd: 0, perSecondUsd: 0.25 },
  },
};

export type GrokVideoResolution = '720p' | '1080p';

/**
 * xAI makes a clip with reference images (the cast's faces) at 720p at most;
 * without them the studio asks for 1080p, unless the story is set to 720p
 * (cheaper). One rule for the request body AND the price, so the two can never disagree.
 */
export function grokVideoResolution(referenceCount: number, quality: GrokVideoResolution = '1080p'): GrokVideoResolution {
  return referenceCount > 0 || quality === '720p' ? '720p' : '1080p';
}

/**
 * grok-imagine-video-1.5, USD per second of clip, by resolution. Measured from
 * xAI's usage on real clips (cost_in_usd_ticks, 1e10 ticks = $1):
 *   1080p, 1 image:  15 s → $3.76, 12 s → $3.01
 *   720p, 3 images:  15 s → $2.13; 720p, 4 images: 14 s → $2.00
 * which fit $0.25/s (1080p), $0.14/s (720p) and $0.01 per input image exactly.
 * The old flat $0.08/s was 1.8-3x low.
 */
export const GROK_VIDEO_USD_PER_SEC: Record<GrokVideoResolution, number> = { '720p': 0.14, '1080p': 0.25 };

/** Each image sent with a clip (the first frame and every reference face). */
export const GROK_INPUT_IMAGE_USD = 0.01;

export interface GrokVideoInputs {
  durationSec: number;
  /** Reference images sent (already capped at the provider's limit). */
  referenceCount: number;
  hasFirstFrame: boolean;
  /** The story's clip quality; omitted = 1080p where allowed. */
  quality?: GrokVideoResolution;
}

/** What xAI charges for one clip with these inputs. */
export function grokVideoCostUsd({ durationSec, referenceCount, hasFirstFrame, quality }: GrokVideoInputs): number {
  const images = referenceCount + (hasFirstFrame ? 1 : 0);
  const usd = GROK_VIDEO_USD_PER_SEC[grokVideoResolution(referenceCount, quality)] * durationSec + GROK_INPUT_IMAGE_USD * images;
  return Math.round(usd * 1e6) / 1e6;
}

/**
 * xAI's own figure for a finished request, from `usage.cost_in_usd_ticks`
 * (1e10 ticks = $1). Null when absent or not a sane amount, so the caller
 * falls back to the reservation (over-record rather than under-record).
 */
export function usdFromXaiTicks(ticks: unknown): number | null {
  if (typeof ticks !== 'number' || !Number.isFinite(ticks) || ticks < 0) return null;
  const usd = ticks / 1e10;
  return usd <= 100 ? Math.round(usd * 1e6) / 1e6 : null;
}

/** Set once the rates are checked against the xAI billing console (the video rates come from xAI's API usage figures). */
export const GROK_RATES_VERIFIED_AT: string | null = null;

/** Flat planning estimate for one storyboard draft call (the figure the UI shows). */
export const DRAFT_ESTIMATE_USD = 0.15;

/** The storyboarder's max_tokens for a short window; longer ones get more (draftMaxOutputTokens). */
export const DRAFT_MAX_OUTPUT_TOKENS = 6000;

/**
 * The ceiling. The SDK refuses a NON-streaming call whose max_tokens implies
 * over 10 minutes (60 min × max_tokens / 128 000, i.e. above ~21 333) unless
 * the client has its own timeout, so the draft stays under it.
 */
export const DRAFT_MAX_OUTPUT_TOKENS_CEILING = 20000;

/**
 * max_tokens for a draft of this window: no draft can bill more output than
 * this. Measured live: a 30 s window wrote 1 313-1 585 tokens for 5 shots,
 * ~250 per shot plus the characters. The prompt asks for ~7 s shots
 * (targetShotCount), ~36 tokens per second of window; 48 leaves a third
 * spare. The reservation uses the same figure.
 */
export function draftMaxOutputTokens(windowSec: number): number {
  return Math.min(DRAFT_MAX_OUTPUT_TOKENS_CEILING, Math.max(DRAFT_MAX_OUTPUT_TOKENS, Math.round(48 * windowSec)));
}
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
export function draftReserveUsd(lyrics: string, windowSec: number): number {
  return draftCostUsd(Math.ceil(lyrics.length / 2) + DRAFT_PROMPT_OVERHEAD_TOKENS, draftMaxOutputTokens(windowSec));
}

/** The price the Draft button shows: the flat estimate when it covers the reservation, else the reservation. */
export function draftLabelUsd(lyrics: string, windowSec: number, estimateUsd: number = DRAFT_ESTIMATE_USD): number {
  return Math.max(estimateUsd, draftReserveUsd(lyrics, windowSec));
}

/**
 * Storyboard check (Claude): its max_tokens. A full list (30 issues, each up
 * to ~230 tokens with its JSON) plus the summary fits; well under the SDK's
 * ~21 333 non-streaming ceiling. The reservation uses the same figure.
 */
export const CHECK_MAX_OUTPUT_TOKENS = 8000;
/** System prompt + tool schema, in tokens (rounded up). */
export const CHECK_PROMPT_OVERHEAD_TOKENS = 1200;

/**
 * What a check reserves against the cap: the message length (~2 characters a
 * token, as drafts assume — Tamil lyrics can run denser, a few cents at most)
 * plus the prompt, and the whole output ceiling. Also the price on the button.
 */
export function checkReserveUsd(messageChars: number): number {
  return draftCostUsd(Math.ceil(messageChars / 2) + CHECK_PROMPT_OVERHEAD_TOKENS, CHECK_MAX_OUTPUT_TOKENS);
}
