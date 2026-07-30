/**
 * Waveform binning and loop-region maths — pure, no AudioBuffer or DOM.
 *
 * ⚠️ COST WARNING that shapes the whole design: these masters are WAVs. At
 * 48 kHz stereo 24-bit a seven-minute song is roughly 120 MB, and decoding one
 * in the browser holds the decoded PCM in memory as 32-bit floats — larger
 * still. So the caller MUST check `shouldRenderWaveform` before fetching, and
 * the binning below is written to run once over the samples rather than
 * building intermediate arrays.
 *
 * The waveform is a navigation aid, not an analysis tool: it exists so a
 * passage can be found and looped, which is how you check one line repeatedly
 * without dragging a scrubber by hand.
 */

/**
 * Refuse anything above this. A 7-minute 48k/24-bit stereo WAV is ~120 MB; the
 * limit sits just above that so ordinary songs work and an unexpectedly huge
 * file does not lock the tab.
 */
export const MAX_WAVEFORM_BYTES = 160 * 1024 * 1024;

export function shouldRenderWaveform(byteLength: number | null | undefined): boolean {
  if (!Number.isFinite(byteLength ?? NaN)) return false;
  return (byteLength as number) > 0 && (byteLength as number) <= MAX_WAVEFORM_BYTES;
}

/**
 * Reduce samples to `bins` peak values in 0..1.
 *
 * Peak per bin, not average: an averaged waveform of a mastered track is a
 * featureless sausage, because the loudness is deliberately even. Peaks keep
 * the transients that make a section recognisable at a glance.
 */
export function binPeaks(samples: Float32Array | number[], bins: number): number[] {
  const n = samples.length;
  const count = Math.max(1, Math.floor(bins));
  if (n === 0) return new Array(count).fill(0);
  const out = new Array<number>(count).fill(0);
  const per = n / count;
  for (let b = 0; b < count; b++) {
    const start = Math.floor(b * per);
    const end = b === count - 1 ? n : Math.floor((b + 1) * per);
    let peak = 0;
    for (let i = start; i < end; i++) {
      const v = samples[i];
      if (!Number.isFinite(v)) continue;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    out[b] = peak > 1 ? 1 : peak;
  }
  return out;
}

export interface LoopRegion {
  /** Seconds. */
  start: number;
  end: number;
}

/** Shortest loop that is actually audible as a phrase rather than a click. */
export const MIN_LOOP_SECONDS = 0.25;

/**
 * Normalise a dragged region: order the ends, clamp to the track, and reject
 * anything too short to be a phrase.
 *
 * Returns null rather than a zero-length region so the caller can treat "no
 * loop" as one case instead of guarding a degenerate one.
 */
export function normaliseLoop(
  a: number,
  b: number,
  durationSeconds: number
): LoopRegion | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(durationSeconds)) return null;
  if (durationSeconds <= 0) return null;
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.min(durationSeconds, Math.max(a, b));
  if (hi - lo < MIN_LOOP_SECONDS) return null;
  return { start: lo, end: hi };
}

/** Where a pointer at `ratio` across the waveform lands, in seconds. */
export function ratioToTime(ratio: number, durationSeconds: number): number {
  if (!Number.isFinite(ratio) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  const clamped = Math.min(1, Math.max(0, ratio));
  return clamped * durationSeconds;
}

/**
 * Should playback jump back? True once the head has reached the loop end.
 *
 * Also true when the head is BEFORE the loop start — seeking outside an active
 * loop should pull you back in, otherwise the loop silently stops applying and
 * the button lies about what it is doing.
 */
export function shouldLoopBack(currentTime: number, loop: LoopRegion | null): boolean {
  if (!loop) return false;
  if (!Number.isFinite(currentTime)) return false;
  return currentTime >= loop.end || currentTime < loop.start - 0.05;
}

/** "1:23" for a seconds value; "—" when unknown. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
