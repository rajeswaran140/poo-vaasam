/**
 * The cut: Premiere-style In and Out marks. Make video exports only the part
 * between them. Pure: shared by the editor, the API and the worker.
 *
 * - Marks sit on the video's frame grid, so the first frame kept is the frame
 *   at In and the copied sound starts with it.
 * - Mark In with no Out set runs to the end; Mark Out with no In starts at 0.
 *   A mark that would leave less than MIN_CUT_SEC moves the other one back
 *   to its end of the video, as Premiere does.
 * - A cut from 0 to the end is no cut: stored as null.
 * - Text stays where it is on the song's timeline. A line outside the marks
 *   is not in the video; one crossing a mark shows for the part inside.
 */
import type { Cut } from '@/types/videoText';

export const MIN_CUT_SEC = 1;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const fpsOr = (fps: number) => (Number.isFinite(fps) && fps > 0 ? fps : 25);

/** The nearest frame start, in seconds (rounded to 1 ms). */
export function snapToFrame(sec: number, fps: number): number {
  const f = fpsOr(fps);
  return r3(Math.round(Math.max(0, sec) * f) / f);
}

/** In and Out as numbers: no cut is 0 to the end. */
export function cutRange(cut: Cut | null | undefined, durationSec: number): { inSec: number; outSec: number } {
  return cut ? { inSec: cut.inSec, outSec: Math.min(cut.outSec, durationSec) } : { inSec: 0, outSec: durationSec };
}

export const cutLength = (cut: Cut | null | undefined, durationSec: number) => {
  const { inSec, outSec } = cutRange(cut, durationSec);
  return r3(outSec - inSec);
};

/** Null when the marks cover the whole video. */
function normalise(inSec: number, outSec: number, durationSec: number, fps: number): Cut | null {
  const half = 0.5 / fpsOr(fps);
  const out = outSec >= durationSec - half ? durationSec : outSec;
  const inn = inSec <= half ? 0 : inSec;
  return inn === 0 && out === durationSec ? null : { inSec: inn, outSec: out };
}

/** The latest In that still leaves MIN_CUT_SEC before the end, on the frame grid. */
const lastIn = (durationSec: number, fps: number) =>
  Math.max(0, r3(Math.floor((durationSec - MIN_CUT_SEC) * fpsOr(fps)) / fpsOr(fps)));

export function markIn(cut: Cut | null | undefined, sec: number, durationSec: number, fps: number): Cut | null {
  const { outSec } = cutRange(cut, durationSec);
  const inSec = Math.min(snapToFrame(sec, fps), lastIn(durationSec, fps));
  // Past the Out (or too close to it): Out goes back to the end.
  const out = outSec - inSec < MIN_CUT_SEC ? durationSec : outSec;
  return normalise(inSec, out, durationSec, fps);
}

export function markOut(cut: Cut | null | undefined, sec: number, durationSec: number, fps: number): Cut | null {
  const { inSec } = cutRange(cut, durationSec);
  const outSec = Math.min(durationSec, Math.max(snapToFrame(sec, fps), Math.min(durationSec, MIN_CUT_SEC)));
  // Before the In (or too close to it): In goes back to the start.
  const inn = outSec - inSec < MIN_CUT_SEC ? 0 : inSec;
  return normalise(inn, outSec, durationSec, fps);
}

/** Why these marks cannot be exported, or null. `durationSec` is the stored video length. */
export function validateCut(cut: Cut | null | undefined, durationSec: number): string | null {
  if (!cut) return null;
  const { inSec, outSec } = cut;
  if (!Number.isFinite(inSec) || !Number.isFinite(outSec) || inSec < 0 || outSec > durationSec + 1e-6) {
    return 'The In and Out marks are outside the video — set them again.';
  }
  if (outSec - inSec < MIN_CUT_SEC - 1e-6) {
    return `The part between In and Out must be at least ${MIN_CUT_SEC} second long.`;
  }
  return null;
}

/** A cut fitted to a new video length (a re-upload): kept when it still fits, else shortened or dropped. */
export function fitCutToDuration(cut: Cut | null | undefined, durationSec: number, fps: number): Cut | null {
  if (!cut) return null;
  if (cut.inSec > lastIn(durationSec, fps)) return null;
  return normalise(cut.inSec, Math.min(cut.outSec, durationSec), durationSec, fps);
}
