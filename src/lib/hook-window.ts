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
  /**
   * Start the clip this many seconds BEFORE the detected hook onset, so it rises
   * INTO the peak instead of opening on it. Retention curves on the channel's
   * Shorts show viewers hold the first ~5s then fall off a cliff when a clip
   * front-loads the loudest moment and then deflates; a short lead-in keeps the
   * energy building through the first seconds. Clamped so it never reaches back
   * into the skipped intro. Default 0 (open exactly on the peak — legacy).
   */
  leadInSec?: number;
  /**
   * Skip this fraction of the track's TAIL, so a clip never opens on the outro.
   *
   * Why this is needed at all: the catalogue is mastered to -14 LUFS with a low
   * loudness range (LRA 2.3-5.0), which leaves barely 0.6-1.3 LU between the
   * loudest window and the median one — measured 2026-07-28 across four songs,
   * where 10-41% of ALL candidate windows sat within 0.5 LU of the winner. With
   * the field that flat, the tiny extra fullness of a FINAL chorus is enough to
   * win, so the peak drifts to the back of the track (three of four picks landed
   * at 61-85% in, one ending 25s from the end — i.e. in the outro). An
   * outro-opening Short is wrong under ANY hook-detection strategy, so this is a
   * guard on the output, not a fix for the energy heuristic.
   *
   * Relaxed automatically when it would leave no legal window (short tracks):
   * a late window beats no window.
   */
  outroSkipFrac?: number;
}

/** Default tail fraction excluded from hook selection (12% of track length). */
export const DEFAULT_OUTRO_SKIP_FRAC = 0.12;

/**
 * Pick the most energetic `windowSec` window — the chorus/hook heuristic — then
 * optionally shift the start earlier by `leadInSec` so the clip builds into the
 * hook. Returns null only for empty input / non-positive window. Always returns
 * a valid window for a real track (falls back to the earliest legal start).
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
  const latestStartRaw = Math.max(0, Math.min(minStart, total - windowSec) === minStart
    ? Math.max(minStart, total - windowSec)
    : total - windowSec);

  // Pull the latest legal start back so the window also ENDS before the outro.
  // Relaxes to the unguarded bound when the track is too short to honour both
  // (otherwise a 40s track with a 29s window would have no candidates at all).
  const outroSkipFrac = Math.min(Math.max(opts.outroSkipFrac ?? DEFAULT_OUTRO_SKIP_FRAC, 0), 0.5);
  const guardedLatestStart = total * (1 - outroSkipFrac) - windowSec;
  const latestStart = guardedLatestStart >= minStart
    ? Math.min(latestStartRaw, guardedLatestStart)
    : latestStartRaw;

  const avgOver = (start: number) => {
    const win = sorted.filter((x) => x.t >= start && x.t < start + windowSec);
    return win.length ? win.reduce((sum, x) => sum + x.lufs, 0) / win.length : null;
  };

  let bestStart: number | null = null;
  let bestAvg = -Infinity;
  for (const s of sorted) {
    const start = s.t;
    if (start < minStart || start > latestStart) continue;
    const avg = avgOver(start);
    if (avg === null) continue;
    if (avg > bestAvg) { bestAvg = avg; bestStart = start; }
  }

  if (bestStart !== null) {
    // Shift the start earlier so the clip approaches the peak; clamp to minStart.
    const leadIn = Math.max(0, opts.leadInSec ?? 0);
    const start = Math.max(minStart, bestStart - leadIn);
    const avg = avgOver(start) ?? bestAvg;
    return { start, end: start + windowSec, avgLufs: avg };
  }

  // Track shorter than minStart+window (or all samples filtered out): clip from
  // the earliest legal point.
  const start = Math.max(0, Math.min(minStart, total - windowSec));
  return { start, end: Math.min(total, start + windowSec), avgLufs: 0 };
}
