/**
 * Playback-rate presets for auditioning — pure.
 *
 * WHY A COMPOSER NEEDS THIS AND A MASTERING ENGINEER DOES NOT. Raj writes the
 * Tamil. The distinctions that decide whether a take is usable — ழ vs ள vs ல,
 * short vs long vowels, gemination, word boundaries — are the same ones his own
 * pronunciation rubric scores, and at full speed a sung line gives you one pass
 * to judge them. At 0.75x they are audible. This is the single most useful
 * control for judging a VOCAL take, and it is useless for judging loudness,
 * which is why it was not in the mastering player until now.
 *
 * ⚠️ PITCH MUST BE PRESERVED. A naive rate change transposes the audio, and a
 * transposed vocal cannot be judged for pronunciation OR melody — every vowel
 * colour shifts. The caller must set `preservesPitch` on the media element;
 * `RATE_WARNING` is the text for the case where the browser refuses.
 */

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

export const DEFAULT_RATE: PlaybackRate = 1;

export const RATE_WARNING =
  'This browser is changing pitch along with speed — vowel colour will shift, so do not judge pronunciation at this rate.';

/** Clamp an arbitrary rate to the supported range. */
export function clampRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return DEFAULT_RATE;
  const min = PLAYBACK_RATES[0];
  const max = PLAYBACK_RATES[PLAYBACK_RATES.length - 1];
  return Math.min(max, Math.max(min, rate));
}

/** "0.75×" — and plain "1×" rather than "1.00×" for the normal case. */
export function formatRate(rate: number): string {
  const r = clampRate(rate);
  return `${Number.isInteger(r) ? r : r}×`;
}

/**
 * Is this rate slow enough that the operator is plainly examining detail?
 *
 * Used to surface the pitch-preservation note only when it matters — showing it
 * at 1× would be noise, and a warning that is always on stops being read.
 */
export function isDetailRate(rate: number): boolean {
  return clampRate(rate) < 1;
}

/** True elapsed wall-clock for a passage played at `rate`. */
export function realTimeFor(seconds: number, rate: number): number {
  const r = clampRate(rate);
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return seconds / r;
}
