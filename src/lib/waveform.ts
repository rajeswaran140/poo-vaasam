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

/**
 * Resample a peaks array to exactly `buckets` values, taking the MAX of each
 * source span.
 *
 * Max, not mean: a waveform's job is to show you where the loud moments are so
 * you can seek to them. Averaging buries a short transient — a plosive, a clipped
 * consonant — which on a mastering player is precisely the thing being hunted.
 *
 * Returns [] for a non-positive bucket count so a zero-width canvas cannot throw.
 */
export function resamplePeaks(peaks: readonly number[], buckets: number): number[] {
  const n = Math.floor(buckets);
  if (n <= 0 || peaks.length === 0) return [];
  if (peaks.length === n) return [...peaks];
  const out = new Array<number>(n);
  const span = peaks.length / n;
  for (let i = 0; i < n; i++) {
    const from = Math.floor(i * span);
    const to = Math.min(peaks.length, Math.max(from + 1, Math.floor((i + 1) * span)));
    let max = 0;
    for (let j = from; j < to; j++) if (peaks[j] > max) max = peaks[j];
    out[i] = max;
  }
  return out;
}

/** Bar count for a canvas of `width` CSS px — one bar per 3px, per the spec. */
export function bucketsForWidth(width: number, pxPerBar = 3): number {
  return Math.max(0, Math.floor(Math.max(0, width) / pxPerBar));
}

/**
 * Human-readable position for `aria-valuetext`.
 *
 * A bare aria-valuenow on a seek bar is announced as a naked number ("73"),
 * which tells a screen-reader user nothing. This says "01:13 of 03:48".
 */
export function describePosition(position: number, duration: number): string {
  return `${formatTime(position)} of ${formatTime(duration)}`;
}

/** Keyboard seek offsets for a media slider, in seconds. Home/End are absolute. */
export const SEEK_STEP_SECONDS = 5;
export const SEEK_PAGE_SECONDS = 30;

/**
 * Where a key press should move the playhead, or null when the key is not a
 * seek key (so the caller can leave the event alone rather than swallowing it).
 */
export function seekTargetForKey(
  key: string,
  current: number,
  duration: number
): number | null {
  const clamp = (t: number) => Math.min(Math.max(0, t), Math.max(0, duration));
  switch (key) {
    case 'ArrowRight': return clamp(current + SEEK_STEP_SECONDS);
    case 'ArrowLeft': return clamp(current - SEEK_STEP_SECONDS);
    case 'PageUp': return clamp(current + SEEK_PAGE_SECONDS);
    case 'PageDown': return clamp(current - SEEK_PAGE_SECONDS);
    case 'Home': return 0;
    case 'End': return clamp(duration);
    default: return null;
  }
}
