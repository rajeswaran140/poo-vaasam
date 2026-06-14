/**
 * Hook-window detection for auto-generating song Shorts / WhatsApp-Status clips.
 *
 * The "hook" (chorus) is approximated as the most energetic sustained window of
 * the track — louder, fuller sections. We measure loudness with ffmpeg's
 * `ebur128` filter (one pass), parse the momentary-loudness timeline here, and
 * slide a window to find the peak (skipping the intro so we don't pick the quiet
 * opening). Pure + unit-tested; the script (scripts/generate-song-short.ts)
 * feeds it ffmpeg output and renders the chosen window.
 */

export interface LoudnessSample {
  /** Seconds into the track. */
  t: number;
  /** Momentary loudness, LUFS (higher = louder; -inf silence → -120). */
  lufs: number;
}

/**
 * Parse ffmpeg `ebur128` stderr into momentary-loudness samples. Lines look like
 *   [Parsed_ebur128_0 @ 0x…] t: 12.30  TARGET:-23 LUFS  M: -18.4 S: -20.1 …
 */
export function parseEbur128Loudness(stderr: string): LoudnessSample[] {
  const out: LoudnessSample[] = [];
  const re = /t:\s*([0-9]+\.?[0-9]*)\s.*?\bM:\s*(-?[0-9]+\.?[0-9]*|-inf)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr)) !== null) {
    const t = parseFloat(m[1]);
    const lufs = m[2] === '-inf' ? -120 : parseFloat(m[2]);
    if (Number.isFinite(t) && Number.isFinite(lufs)) out.push({ t, lufs });
  }
  return out;
}

export interface HookWindow {
  /** Window start, seconds. */
  start: number;
  /** Window end, seconds. */
  end: number;
  /** Mean loudness across the window (LUFS) — the score it won on. */
  avgLufs: number;
}

export interface PickHookOptions {
  /** Clip length, seconds. */
  windowSec: number;
  /** Skip this much of the intro so a quiet opening isn't chosen. */
  minStartSec?: number;
  /** Total track length; defaults to the last sample's timestamp. */
  totalSec?: number;
}

/**
 * Pick the most energetic `windowSec` window — the chorus/hook heuristic.
 * Returns null only for empty input / non-positive window. Always returns a
 * valid window for a real track (falls back to the earliest legal start).
 */
export function pickHookWindow(
  samples: LoudnessSample[],
  opts: PickHookOptions
): HookWindow | null {
  const { windowSec } = opts;
  if (!samples.length || windowSec <= 0) return null;

  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const total = opts.totalSec ?? sorted[sorted.length - 1].t;
  const minStart = Math.max(0, opts.minStartSec ?? 8);
  // Latest a full window can start; clamp so we never run past the track.
  const latestStart = Math.max(0, Math.min(minStart, total - windowSec) === minStart
    ? Math.max(minStart, total - windowSec)
    : total - windowSec);

  let best: HookWindow | null = null;
  for (const s of sorted) {
    const start = s.t;
    if (start < minStart || start > latestStart) continue;
    const win = sorted.filter((x) => x.t >= start && x.t < start + windowSec);
    if (!win.length) continue;
    const avg = win.reduce((sum, x) => sum + x.lufs, 0) / win.length;
    if (!best || avg > best.avgLufs) best = { start, end: start + windowSec, avgLufs: avg };
  }

  if (best) return best;
  // Track shorter than minStart+window (or all samples filtered out): clip from
  // the earliest legal point.
  const start = Math.max(0, Math.min(minStart, total - windowSec));
  return { start, end: Math.min(total, start + windowSec), avgLufs: 0 };
}
