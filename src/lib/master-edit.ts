/**
 * Trim + fade for the mastering pre-pass — pure, no I/O.
 *
 * The mastering worker's three loudnorm passes are deliberately untouched by
 * this. Instead an edit produces ONE extra lossless ffmpeg pass that runs
 * BEFORE them, and everything downstream sees only its output.
 *
 * WHY THE ORDER IS FIXED. Loudness has to be measured on the program that will
 * actually ship. Trim a 40-second silent tail after normalising and the file no
 * longer sits at its target: integrated loudness is an average over the whole
 * programme, so removing part of the programme moves it. Editing first and
 * measuring second is the only ordering where the recorded `afterLufs` remains
 * true of the delivered file.
 *
 * The reverse worry — that fading to silence before measurement would drag the
 * integrated reading down — does not apply. EBU R128 integrated loudness is
 * gated (absolute -70 LUFS, relative -10 LU), so the quiet tail of a fade is
 * excluded from the measurement rather than averaged into it. That gate is
 * precisely why this ordering is safe in both directions.
 *
 * Nothing here is destructive. The source WAV in S3 is never modified; an edit
 * is a set of numbers stored on the job, so re-running with different points is
 * a new job over the same untouched source.
 */

/**
 * ffmpeg `afade` curve tokens, restricted to the ones that make musical sense.
 *
 * `tri` (linear) is the obvious default and the wrong one for a song tail: an
 * even dB-per-second ramp is heard as holding steady and then dropping off a
 * cliff at the end, because loudness perception is logarithmic. The quarter-sine
 * curve leaves the level alone early and does its work late, which is what a
 * hand-ridden fader does.
 */
export type FadeCurve = 'tri' | 'qsin' | 'esin' | 'log' | 'exp';

export const FADE_CURVES: readonly FadeCurve[] = ['tri', 'qsin', 'esin', 'log', 'exp'];

export const DEFAULT_FADE_CURVE: FadeCurve = 'qsin';

/** Longer than this is a structural edit, not a fade — refuse rather than guess. */
export const MAX_FADE_SECONDS = 30;

/** A master shorter than this is a slip of the mouse, not an intention. */
export const MIN_MASTER_SECONDS = 1;

export interface MasterEdit {
  /** Seconds into the SOURCE where the master begins. */
  trimStartSec: number;
  /** Seconds into the SOURCE where the master ends; null runs to the end. */
  trimEndSec: number | null;
  fadeInSec: number;
  fadeOutSec: number;
  curve: FadeCurve;
}

/** The identity edit — what a job carries when the admin changed nothing. */
export const NO_EDIT: MasterEdit = Object.freeze({
  trimStartSec: 0,
  trimEndSec: null,
  fadeInSec: 0,
  fadeOutSec: 0,
  curve: DEFAULT_FADE_CURVE,
});

export type ParseResult =
  | { ok: true; edit: MasterEdit }
  | { ok: false; error: string };

const isNonNegativeFinite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * True when this edit would change nothing, so the worker can skip the pre-pass
 * entirely rather than spending a decode/encode cycle copying the file.
 */
export function isNoOpEdit(edit: MasterEdit): boolean {
  return (
    edit.trimStartSec === 0 &&
    edit.trimEndSec === null &&
    edit.fadeInSec === 0 &&
    edit.fadeOutSec === 0
  );
}

/**
 * Validate an untrusted request body into a MasterEdit.
 *
 * Absent/blank input is the identity edit, not an error — every existing caller
 * omits these fields and must keep working unchanged.
 *
 * Note what is NOT checked here: whether the trim points fall inside the file.
 * That needs the source duration, which only the worker knows for certain, so
 * it lives in `validateAgainstSource`. Splitting them keeps this callable from
 * the route, which has no audio.
 */
export function parseMasterEdit(input: unknown): ParseResult {
  if (input === undefined || input === null) return { ok: true, edit: NO_EDIT };
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'edit must be an object' };
  }
  const raw = input as Record<string, unknown>;

  const trimStartSec = raw.trimStartSec === undefined ? 0 : raw.trimStartSec;
  if (!isNonNegativeFinite(trimStartSec)) {
    return { ok: false, error: 'trimStartSec must be a number ≥ 0' };
  }

  const trimEndRaw = raw.trimEndSec;
  let trimEndSec: number | null = null;
  if (trimEndRaw !== undefined && trimEndRaw !== null) {
    if (!isNonNegativeFinite(trimEndRaw)) {
      return { ok: false, error: 'trimEndSec must be a number ≥ 0, or null for the end of the file' };
    }
    trimEndSec = trimEndRaw;
  }

  if (trimEndSec !== null && trimEndSec - trimStartSec < MIN_MASTER_SECONDS) {
    return {
      ok: false,
      error: `the trimmed master would be shorter than ${MIN_MASTER_SECONDS}s — check the trim points`,
    };
  }

  const fade = (name: 'fadeInSec' | 'fadeOutSec'): number | string => {
    const value = raw[name] === undefined ? 0 : raw[name];
    if (!isNonNegativeFinite(value)) return `${name} must be a number ≥ 0`;
    if (value > MAX_FADE_SECONDS) return `${name} must be at most ${MAX_FADE_SECONDS}s`;
    return value;
  };
  const fadeInSec = fade('fadeInSec');
  if (typeof fadeInSec === 'string') return { ok: false, error: fadeInSec };
  const fadeOutSec = fade('fadeOutSec');
  if (typeof fadeOutSec === 'string') return { ok: false, error: fadeOutSec };

  const curveRaw = raw.curve === undefined ? DEFAULT_FADE_CURVE : raw.curve;
  if (typeof curveRaw !== 'string' || !FADE_CURVES.includes(curveRaw as FadeCurve)) {
    return { ok: false, error: `curve must be one of ${FADE_CURVES.join(', ')}` };
  }

  return {
    ok: true,
    edit: { trimStartSec, trimEndSec, fadeInSec, fadeOutSec, curve: curveRaw as FadeCurve },
  };
}

/**
 * Where the master actually ends, in SOURCE seconds.
 *
 * A client-supplied end past the real end of the file is clamped rather than
 * rejected: the UI derives it from a decoded duration that can round a few
 * milliseconds long, and failing a job over that would be absurd.
 */
export function resolvedEndSec(edit: MasterEdit, sourceDurationSec: number): number {
  if (edit.trimEndSec === null) return sourceDurationSec;
  return Math.min(edit.trimEndSec, sourceDurationSec);
}

/** How long the mastered file will be. */
export function editedDurationSec(edit: MasterEdit, sourceDurationSec: number): number {
  return Math.max(0, resolvedEndSec(edit, sourceDurationSec) - edit.trimStartSec);
}

/**
 * The check that needs the real file. Called by the worker once it has read the
 * source header, so a bad trim fails the job with an explanation instead of
 * producing a half-second master or an empty file.
 */
export function validateAgainstSource(
  edit: MasterEdit,
  sourceDurationSec: number,
): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(sourceDurationSec) || sourceDurationSec <= 0) {
    // Unknown duration is not fatal on its own — only an edit that depends on
    // knowing it is. A pure head trim still works without it.
    return edit.trimEndSec === null && edit.fadeOutSec === 0
      ? { ok: true }
      : { ok: false, error: 'the source duration could not be read, so a tail trim or fade-out cannot be placed' };
  }
  if (edit.trimStartSec >= sourceDurationSec) {
    return { ok: false, error: 'the trim start is at or past the end of the file' };
  }
  const duration = editedDurationSec(edit, sourceDurationSec);
  if (duration < MIN_MASTER_SECONDS) {
    return {
      ok: false,
      error: `the trimmed master would be ${duration.toFixed(2)}s — shorter than the ${MIN_MASTER_SECONDS}s minimum`,
    };
  }
  return { ok: true };
}

/** ffmpeg wants plain decimals; keep them short and free of float noise. */
function ffNum(seconds: number): string {
  return String(Math.round(seconds * 1000) / 1000);
}

/**
 * The ffmpeg filter chain for the pre-pass, in order. Empty when the edit is a
 * no-op, which the worker reads as "skip the pass".
 *
 * Fades are clamped so that together they never exceed the trimmed length —
 * overlapping fades produce a double-attenuated middle, which sounds like a
 * fault rather than an edit.
 */
export function buildEditFilters(edit: MasterEdit, sourceDurationSec: number): string[] {
  if (isNoOpEdit(edit)) return [];

  const end = resolvedEndSec(edit, sourceDurationSec);
  const duration = editedDurationSec(edit, sourceDurationSec);
  const filters: string[] = [];

  const trimsHead = edit.trimStartSec > 0;
  const trimsTail = Number.isFinite(sourceDurationSec) && end < sourceDurationSec;
  if (trimsHead || trimsTail) {
    const parts = [`atrim=start=${ffNum(edit.trimStartSec)}`];
    if (trimsTail) parts.push(`end=${ffNum(end)}`);
    filters.push(parts.join(':'));
    // atrim keeps the ORIGINAL timestamps, so without this the output starts at
    // t=trimStart and every afade `st=` below would be off by that much.
    filters.push('asetpts=PTS-STARTPTS');
  }

  // Proportional clamp: if the two fades are longer than the master, shrink both
  // rather than dropping one, so the shape the admin asked for is preserved.
  let fadeIn = edit.fadeInSec;
  let fadeOut = edit.fadeOutSec;
  const total = fadeIn + fadeOut;
  if (duration > 0 && total > duration) {
    const scale = duration / total;
    fadeIn = Math.round(fadeIn * scale * 1000) / 1000;
    fadeOut = Math.round(fadeOut * scale * 1000) / 1000;
  }

  if (fadeIn > 0) {
    filters.push(`afade=t=in:st=0:d=${ffNum(fadeIn)}:curve=${edit.curve}`);
  }
  if (fadeOut > 0 && duration > 0) {
    const startAt = Math.max(0, duration - fadeOut);
    filters.push(`afade=t=out:st=${ffNum(startAt)}:d=${ffNum(fadeOut)}:curve=${edit.curve}`);
  }

  return filters;
}

/** The chain as a single `-af` argument, or null when there is nothing to do. */
export function buildEditFilterArg(edit: MasterEdit, sourceDurationSec: number): string | null {
  const filters = buildEditFilters(edit, sourceDurationSec);
  return filters.length ? filters.join(',') : null;
}

/** Plain-language summary for the job report and the admin UI. */
export function describeEdit(edit: MasterEdit, sourceDurationSec: number): string {
  if (isNoOpEdit(edit)) return 'No edit — the full source, unchanged.';
  const parts: string[] = [];
  const end = resolvedEndSec(edit, sourceDurationSec);
  if (edit.trimStartSec > 0) parts.push(`starts at ${ffNum(edit.trimStartSec)}s`);
  if (Number.isFinite(sourceDurationSec) && end < sourceDurationSec) {
    parts.push(`ends at ${ffNum(end)}s`);
  }
  if (edit.fadeInSec > 0) parts.push(`${ffNum(edit.fadeInSec)}s fade in`);
  if (edit.fadeOutSec > 0) parts.push(`${ffNum(edit.fadeOutSec)}s fade out (${edit.curve})`);
  return parts.join(', ');
}
