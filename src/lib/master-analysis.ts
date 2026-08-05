/**
 * Analysing a source BEFORE anything is decided about it.
 *
 * The module already measures — it just does it after the operator has chosen a
 * trim, a fade and a seam. Running the measurements first turns three decisions
 * that were made by ear into decisions made from evidence:
 *
 *  1. IS THE TAIL ALREADY FADING? A SUNO section-final generation arrives with
 *     its own fade often enough to matter, and a baked-in fade cannot be undone
 *     without dynamics processing that smears a choir. That makes it a RE-ROLL,
 *     not something to fix in post — but only if you notice before you spend a
 *     master and a crossfade on it. This is the one finding that changes what
 *     you do rather than what you know.
 *  2. WHERE IS THE DEAD AIR? SUNO exports almost always carry silence at the
 *     head and tail. Finding it by ear is the slowest part of the trim.
 *  3. DO THE TWO PARTS MATCH IN LEVEL? Joining raw preserves whatever mismatch
 *     the two generations arrived with, and a single master over the assembled
 *     song normalises the whole programme rather than fixing an imbalance
 *     between its halves.
 *
 * DELIBERATELY NOT AN LLM. Every claim here is a measurement or an arithmetic
 * consequence of one, which is the same contract the rest of the module keeps —
 * and the reason its verdicts can be trusted. An opinion about whether a song
 * "sounds good" would be unfalsifiable in a tool whose whole value is that its
 * statements are checkable.
 *
 * Pure and I/O-free: the worker runs ffmpeg, this reads the logs and decides
 * what they mean.
 */

/** ffmpeg's silencedetect threshold. -50 dB is below a room floor, above dither. */
export const SILENCE_THRESHOLD_DB = -50;

/** Shorter than this is a gap between phrases, not dead air worth trimming. */
export const SILENCE_MIN_SECONDS = 0.4;

/**
 * How much quieter the final second must be than the seconds before it for the
 * tail to count as already fading.
 *
 * 3 dB is a halving of power — audible, and well past the drift of a sustained
 * note or a reverb tail that simply stops. Below this a "fade" claim would fire
 * on any song that ends softly, which is most of them.
 */
export const FADE_DROP_DB = 3;

/** A level difference smaller than this between two parts is inaudible. */
export const LEVEL_MATCH_TOLERANCE_LU = 1;

export interface SilenceSpan {
  startSec: number;
  endSec: number;
}

/** ffmpeg args for silence detection. One pass, no decode of the output. */
export function buildSilenceArgs(inPath: string): string[] {
  return [
    '-hide_banner', '-nostats',
    '-i', inPath,
    '-af', `silencedetect=noise=${SILENCE_THRESHOLD_DB}dB:d=${SILENCE_MIN_SECONDS}`,
    '-f', 'null', '-',
  ];
}

/**
 * ffmpeg args for a loudness-over-time series.
 *
 * ebur128 prints a momentary reading every 100 ms, which is what makes a
 * decaying tail visible as a shape rather than a single number. The same pass
 * also yields the integrated loudness used for the two-part level comparison,
 * so Part A and Part B each cost ONE decode rather than two.
 */
export function buildTimelineArgs(inPath: string): string[] {
  return ['-hide_banner', '-nostats', '-i', inPath, '-af', 'ebur128', '-f', 'null', '-'];
}

/**
 * Silence spans from a silencedetect log.
 *
 * A trailing silence prints `silence_start` with no matching `silence_end` —
 * the file ends inside it — so an unclosed span is closed at the duration
 * rather than dropped. Dropping it would miss the most common case there is:
 * dead air at the end of a SUNO export.
 */
export function parseSilences(log: string, durationSec: number): SilenceSpan[] {
  const spans: SilenceSpan[] = [];
  let open: number | null = null;
  for (const line of log.split('\n')) {
    const start = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (start) {
      open = Math.max(0, Number(start[1]));
      continue;
    }
    const end = /silence_end:\s*(-?[\d.]+)/.exec(line);
    if (end && open !== null) {
      spans.push({ startSec: open, endSec: Number(end[1]) });
      open = null;
    }
  }
  if (open !== null && Number.isFinite(durationSec) && durationSec > open) {
    spans.push({ startSec: open, endSec: durationSec });
  }
  return spans;
}

/** Dead air at the head — only a span that actually starts at the beginning. */
export function leadingSilenceSec(spans: SilenceSpan[]): number {
  const first = spans.find((s) => s.startSec <= 0.05);
  return first ? Math.round((first.endSec - first.startSec) * 100) / 100 : 0;
}

/** Dead air at the tail — only a span that runs to the end of the file. */
export function trailingSilenceSec(spans: SilenceSpan[], durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  const last = spans.find((s) => Math.abs(s.endSec - durationSec) <= 0.05);
  return last ? Math.round((last.endSec - last.startSec) * 100) / 100 : 0;
}

export interface TimelinePoint {
  tSec: number;
  momentaryLufs: number;
}

/**
 * The momentary-loudness series from an ebur128 log.
 *
 * Readings of -120 or below are ebur128's "silence" floor rather than a
 * measurement, so they are dropped: leaving them in would drag the tail average
 * down and report a fade on a file that simply ends.
 */
export function parseTimeline(log: string): TimelinePoint[] {
  const points: TimelinePoint[] = [];
  for (const line of log.split('\n')) {
    // Real ebur128 output puts TARGET between t: and M: —
    //   `t: 0.0999792  TARGET:-23 LUFS    M:-120.7 S:-120.7 ...`
    // and prints M with no space after the colon. A regex expecting only
    // whitespace between the two matched NOTHING on real audio, which made the
    // tail check silently unjudgeable on every file. Caught by running the real
    // ffmpeg against a real source; no fixture would have found it.
    const m = /t:\s*([\d.]+).*?M:\s*(-?[\d.]+)/.exec(line);
    if (!m) continue;
    const momentaryLufs = Number(m[2]);
    if (momentaryLufs <= -120) continue;
    points.push({ tSec: Number(m[1]), momentaryLufs });
  }
  return points;
}

export type FadeState = 'fading' | 'steady' | 'unknown';

/**
 * What this file's tail is FOR, which decides whether a fade is a problem.
 *
 * `lead-in`  — it hands over to another section at a crossfade. A baked-in fade
 *              here double-attenuates the seam, so it is actionable: re-roll.
 * `ending`   — it is the end of the song (a final section, or a standalone
 *              master). Fading out is how songs end; warning about it would
 *              fire on nearly every file and train the operator to ignore this
 *              panel. Measured 2026-08-05 on real SUNO output: both parts of
 *              வானவில்லே fade at the tail (12.6 LU and 18 LU), and only Part A's
 *              mattered.
 */
export type TailRole = 'lead-in' | 'ending';

export interface FadeVerdict {
  state: FadeState;
  /** How far the final second sits below the seconds before it, in LU. */
  dropLu: number | null;
  message: string;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Is this source's tail already fading out?
 *
 * Compares the last second against the four seconds before it, ignoring any
 * trailing silence — a file that ends with dead air would otherwise always
 * read as fading, when what it actually needs is a trim.
 *
 * Says `unknown` rather than guessing when there is not enough audio to judge.
 * A false "steady" would send a faded take into a crossfade, which is the exact
 * outcome this exists to prevent.
 */
export function tailDropLu(points: TimelinePoint[], trailingSilence = 0): number | null {
  const audible = trailingSilence > 0 && points.length
    ? points.filter((p) => p.tSec <= points[points.length - 1].tSec - trailingSilence)
    : points;
  if (audible.length < 20) return null;
  const end = audible[audible.length - 1].tSec;
  const last = audible.filter((p) => p.tSec > end - 1);
  const before = audible.filter((p) => p.tSec > end - 5 && p.tSec <= end - 1);
  if (!last.length || before.length < 10) return null;
  const lu = (ps: TimelinePoint[]) => ps.map((p) => p.momentaryLufs);
  return Math.round((mean(lu(before)) - mean(lu(last))) * 10) / 10;
}

/**
 * The verdict, from the single number the worker stored.
 *
 * Split from the measurement deliberately: the WORKER computes `tailDropLu`
 * (it has the audio), the APP decides what the number means. So the threshold
 * and the wording can be tuned without a Lambda redeploy — which in this module
 * is the difference between a one-line change and a trap.
 */
export function fadeVerdictFromDrop(drop: number | null, role: TailRole = 'ending'): FadeVerdict {
  if (drop === null || !Number.isFinite(drop)) {
    return { state: 'unknown', dropLu: null, message: 'Not enough audio to judge the tail.' };
  }
  if (drop < FADE_DROP_DB) {
    return {
      state: 'steady',
      dropLu: drop,
      message:
        role === 'lead-in'
          ? `The tail holds its level (last second within ${Math.abs(drop)} LU of the four before it) — good crossfade material.`
          : `The ending holds its level to the last second (within ${Math.abs(drop)} LU).`,
    };
  }
  // A fade is only a PROBLEM on the side that leads into a seam. On a final
  // section — or a standalone song — fading out is how songs end, and warning
  // about it would fire on almost every file this module ever sees.
  return role === 'lead-in'
    ? {
        state: 'fading',
        dropLu: drop,
        message:
          `Part A already fades out — its last second sits ${drop} LU below the four before it. ` +
          `A baked-in fade cannot be removed, and crossfading into one double-attenuates the seam, ` +
          `so the join will dip. Re-roll this section rather than fixing it here.`,
      }
    : {
        state: 'fading',
        dropLu: drop,
        message: `Ends with a fade (${drop} LU over the last second) — normal for a final section.`,
      };
}

/** Measure and judge in one step. The worker uses the two halves separately. */
export function fadeVerdict(points: TimelinePoint[], trailingSilence = 0, role: TailRole = 'ending'): FadeVerdict {
  return fadeVerdictFromDrop(tailDropLu(points, trailingSilence), role);
}

export interface LevelVerdict {
  matched: boolean;
  deltaLu: number | null;
  message: string;
}

/**
 * Do the two parts arrive at the same level?
 *
 * A single master over the joined song normalises the WHOLE programme, so a
 * mismatch between halves survives mastering intact — the louder section simply
 * stays louder. Fixing it means matching before the join, which is a decision
 * this reports rather than makes.
 */
export function levelVerdict(partALufs: number | null, partBLufs: number | null): LevelVerdict {
  if (partALufs === null || partBLufs === null || !Number.isFinite(partALufs) || !Number.isFinite(partBLufs)) {
    return { matched: false, deltaLu: null, message: 'Both parts must be measured to compare their level.' };
  }
  const delta = Math.round((partBLufs - partALufs) * 10) / 10;
  if (Math.abs(delta) <= LEVEL_MATCH_TOLERANCE_LU) {
    return { matched: true, deltaLu: delta, message: `The two parts are within ${Math.abs(delta)} LU — no matching needed.` };
  }
  const louder = delta > 0 ? 'B' : 'A';
  return {
    matched: false,
    deltaLu: delta,
    message:
      `Part ${louder} is ${Math.abs(delta)} LU louder. Mastering the joined song normalises the whole ` +
      `programme, so this difference survives it — match the parts before joining if the step is audible.`,
  };
}

/**
 * The trim this analysis suggests: cut the dead air, leave the music alone.
 *
 * Returns null when there is nothing to propose, so the UI can stay quiet
 * rather than offering a no-op. Fades are deliberately NOT proposed — where a
 * song should start fading is a musical decision, and the module has no basis
 * for one.
 */
export function proposedTrim(params: {
  leadingSilenceSec: number;
  trailingSilenceSec: number;
  durationSec: number;
}): { trimStartSec: number; trimEndSec: number | null } | null {
  const { durationSec } = params;
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null;

  // A hair of silence is not worth an edit, and trimming exactly to the first
  // sample risks clipping the attack.
  const head = params.leadingSilenceSec >= SILENCE_MIN_SECONDS ? Math.max(0, params.leadingSilenceSec - 0.05) : 0;
  const tail = params.trailingSilenceSec >= SILENCE_MIN_SECONDS ? params.trailingSilenceSec - 0.05 : 0;
  const end = tail > 0 ? Math.round((durationSec - tail) * 100) / 100 : null;

  if (head <= 0 && end === null) return null;
  return { trimStartSec: Math.round(head * 100) / 100, trimEndSec: end };
}
