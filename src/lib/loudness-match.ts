/**
 * Fair A/B comparison of a source vs its master. Pure — no audio, no DOM.
 *
 * The trap in any before/after audio comparison is that the louder version
 * always "sounds better" — more punch, more presence — regardless of whether it
 * is actually better. Mastering *changes loudness on purpose*, so an unmatched
 * A/B would just tell you which is louder, not whether mastering hurt or helped
 * the sound. Level-matching removes that bias so the ear judges quality alone.
 *
 * We match toward the QUIETER of the two (both gains ≤ 1). Matching to the
 * louder one would boost the quieter track above unity and could clip on
 * playback; pulling the louder one down instead is clip-safe and is what
 * mastering engineers do when they null-test.
 */

/** dB → linear amplitude. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export interface MatchGains {
  /** Multiply the source element's gain by this. */
  source: number;
  /** Multiply the master element's gain by this. */
  master: number;
  /** LUFS both are pulled to (the quieter of the two). */
  referenceLufs: number;
}

/**
 * Playback gains that bring source and master to a common loudness.
 * Returns null when either measurement is missing (matching is then
 * unavailable and the UI must fall back to true levels).
 */
export function matchGains(beforeLufs: number | null, afterLufs: number | null): MatchGains | null {
  if (typeof beforeLufs !== 'number' || typeof afterLufs !== 'number') return null;
  if (!Number.isFinite(beforeLufs) || !Number.isFinite(afterLufs)) return null;
  const ref = Math.min(beforeLufs, afterLufs);
  return {
    source: dbToGain(ref - beforeLufs), // ≤ 1
    master: dbToGain(ref - afterLufs), // ≤ 1
    referenceLufs: ref,
  };
}

/** mm:ss for a transport read-out. Negative / NaN clamps to 0:00. */
export function formatClock(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
