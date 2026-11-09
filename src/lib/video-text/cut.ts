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
import { exactFps } from './freeze';

export const MIN_CUT_SEC = 1;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** The frame rate as the video really runs (23.98 → 24000/1001, …; not a number → 25). */
const fpsOr = exactFps;

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

/**
 * A handle dragged (or arrowed) to `sec`: it stops a second short of the
 * other mark instead of crossing it. Unlike markIn/markOut, which follow
 * Premiere's rule for a single I/O press (the other mark goes back to its
 * end), a drag passes through many positions, and that rule would wipe out
 * the other mark the moment the handle touched it.
 */
export function dragMark(cut: Cut | null | undefined, kind: 'in' | 'out', sec: number, durationSec: number, fps: number): Cut | null {
  const { inSec, outSec } = cutRange(cut, durationSec);
  const f = fpsOr(fps);
  const t = snapToFrame(sec, fps);
  if (kind === 'in') {
    const max = r3(Math.floor((outSec - MIN_CUT_SEC) * f + 1e-6) / f);
    return normalise(Math.max(0, Math.min(t, max)), outSec, durationSec, fps);
  }
  const min = r3(Math.ceil((inSec + MIN_CUT_SEC) * f - 1e-6) / f);
  return normalise(inSec, Math.min(durationSec, Math.max(t, min)), durationSec, fps);
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

/**
 * A cut fitted to a new video (a re-upload): kept when it still fits, else
 * shortened or dropped, and put back on the new video's frames (it may have
 * another frame rate).
 */
export function fitCutToDuration(cut: Cut | null | undefined, durationSec: number, fps: number): Cut | null {
  if (!cut) return null;
  const inSec = snapToFrame(cut.inSec, fps);
  if (inSec > lastIn(durationSec, fps)) return null;
  const outSec = cut.outSec >= durationSec ? durationSec : Math.min(durationSec, snapToFrame(cut.outSec, fps));
  if (outSec - inSec < MIN_CUT_SEC) return normalise(inSec, durationSec, durationSec, fps);
  return normalise(inSec, outSec, durationSec, fps);
}

/** Marks on this video's frames: the worker's guard for marks saved off them. Out at the end stays the end. */
export function snapCut(cut: Cut, durationSec: number, fps: number): Cut {
  const half = 0.5 / fpsOr(fps);
  return {
    inSec: snapToFrame(cut.inSec, fps),
    outSec: cut.outSec >= durationSec - half ? cut.outSec : snapToFrame(cut.outSec, fps),
  };
}
