/**
 * One rule for a made clip against the row it sits in (design 2026-11-13 §6):
 * a row shorter than its clip TRIMS the clip's end; a row a little longer
 * plays it SLOWER, down to MIN_PLAYBACK_RATE; past that the clip is out of
 * date and Make the video makes it again. The pictures panel, the lyric
 * fitter and the render plan all ask this, so they never disagree.
 *
 * Two exceptions:
 *  - a clip a chained row continues from (its last frame is the next clip's
 *    first) is never trimmed: the seam would jump;
 *  - a clip whose length is unknown (made before 2026-11-13) is never trimmed
 *    or slowed on a guess: it fits only a whole-second row, as before.
 *
 * Pure and client-safe.
 */

/** Slower than this reads as slow motion. */
export const MIN_PLAYBACK_RATE = 0.88;

export type ClipFit =
  | { kind: 'exact' }
  | { kind: 'trim'; trimSec: number }
  | { kind: 'slow'; rate: number }
  | { kind: 'stale' };

const cents = (n: number) => Math.round(n * 100);
/** One frame at 25 fps, plus rounding: a difference this small is no trim or slow-down. */
const EXACT_WITHIN_CENTIS = 5;

export function clipFitFor(
  clipSec: number | null,
  rowSec: number,
  opts: { continuedFrom?: boolean; minRate?: number } = {}
): ClipFit {
  const minRate = opts.minRate ?? MIN_PLAYBACK_RATE;
  if (clipSec === null) return Number.isInteger(Math.round(rowSec * 1e6) / 1e6) ? { kind: 'exact' } : { kind: 'stale' };
  const c = cents(clipSec);
  const r = cents(rowSec);
  // Within a frame (25 fps) is exact: Grok's files run a frame long (14.04 s for 14 s).
  if (Math.abs(c - r) <= EXACT_WITHIN_CENTIS) return { kind: 'exact' };
  if (r < c) return opts.continuedFrom ? { kind: 'stale' } : { kind: 'trim', trimSec: (c - r) / 100 };
  const rate = Math.round((clipSec / rowSec) * 1000) / 1000;
  return rate >= minRate ? { kind: 'slow', rate } : { kind: 'stale' };
}

/** The longest row (in tenths) a clip fills without going out of date. */
export function maxRowSecFor(clipSec: number, minRate = MIN_PLAYBACK_RATE): number {
  return Math.floor(Math.round((clipSec / minRate) * 1e6) / 1e5) / 10;
}
