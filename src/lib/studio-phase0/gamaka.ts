/**
 * Gamaka (pitch movement) for the listening test. The dev box measures the
 * stem's real pitch track and stores it per note as `detuneCurve` (cents,
 * evenly spaced across the note). The render applies it as `detune`
 * automation, to hear whether pitch curves on samples sound mechanical.
 */
import type { Note } from './model';

/** Centred moving average. Keeps the length and the first and last values. */
export function smoothCurve(cents: number[], window: number): number[] {
  const half = Math.floor(Math.max(1, window) / 2);
  if (half === 0 || cents.length < 3) return [...cents];
  return cents.map((_, i) => {
    if (i === 0 || i === cents.length - 1) return cents[i];
    const lo = Math.max(0, i - half);
    const hi = Math.min(cents.length - 1, i + half);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += cents[j];
    return sum / (hi - lo + 1);
  });
}

/** The note's curve ready for `setValueCurveAtTime`, or null when it has none. */
export function curveForNote(note: Note): Float32Array | null {
  const c = note.detuneCurve;
  return c && c.length >= 2 ? Float32Array.from(c) : null;
}
