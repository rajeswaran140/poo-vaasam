/**
 * Hearing the seam before mastering the whole song.
 *
 * WHY THIS EXISTS. The crossfade itself is already right: `master-join` uses an
 * equal-power `qsin` curve, measured flat across the seam where a linear one
 * digs a 3 dB hole. What makes a two-part song still sound spliced is almost
 * never the curve — it is Part B's first downbeat not landing where Part A's
 * bar ends, which is a judgement no measurement makes for you.
 *
 * The join panel has always had the control for that (Part B's head trim) and
 * its own note says the admin "nudges it by ear". There was nothing to nudge
 * AGAINST: hearing the result meant mastering the entire song, listening,
 * adjusting and mastering again — a five-minute loop for a decision that needs
 * ten attempts. This renders ~20 seconds around the join and nothing else.
 *
 * ⚠️ THE PREVIEW IS THE SAME GRAPH AS THE MASTER, TRIMMED.
 * It reuses `buildJoinFilterComplex` verbatim and appends an `atrim`. That is
 * the whole point: a preview built from a *different* recipe would let the seam
 * sound right here and wrong in the delivered file, which is worse than having
 * no preview at all. Do not "optimise" this by seeking into the inputs — the
 * edits are expressed in source time, and moving the inputs moves the seam.
 *
 * ⚠️ IT IS NOT A DELIVERABLE. MP3, disposable, and never mastered — the module
 * rule is that only the lossless source is ever mastered, and a preview must
 * never become the thing that gets normalised.
 *
 * Pure and I/O-free, like master-join: this builds argument lists and decides
 * what is legal. The worker runs them.
 */

import {
  buildJoinFilterComplex,
  JOIN_OUTPUT_LABEL,
  type MasterJoin,
} from '@/lib/master-join';
import { editedDurationSec, NO_EDIT, type MasterEdit } from '@/lib/master-edit';
import { MASTERING_PREFIX, isMasteringKey } from '@/lib/mastering-storage';

/** Previews live in their own folder so a sweep can find and drop them. */
export const SEAM_PREFIX = `${MASTERING_PREFIX}seam/`;

/**
 * How much unjoined music to keep either side of the crossfade.
 *
 * Long enough to carry a bar or two at any tempo the channel uses, so the ear
 * has the groove established before the seam arrives and can tell a stumble
 * from a start. Short enough that the whole preview is a few seconds' listen
 * and can be looped without losing patience.
 */
export const SEAM_CONTEXT_SEC = 8;

/** Bitrate for the preview. Monitoring only — artefacts at 192k are irrelevant
 * to judging whether a downbeat lands. */
export const SEAM_BITRATE = '192k';

/**
 * Loudness is measured over this much of each side, ending at / starting from
 * the crossfade. Shorter than the context window on purpose: a level mismatch
 * matters where the two actually overlap.
 */
export const SEAM_LEVEL_WINDOW_SEC = 6;

/**
 * A difference this big or larger between Part A's tail and Part B's head is
 * reported as the likely cause.
 *
 * 1.5 LU is roughly where a level step stops reading as "the song got louder"
 * and starts reading as "a different recording started". Below it, nudging the
 * trim is worth doing; at or above it, no crossfade placement will hide the
 * join and the parts need matching first.
 */
export const SEAM_LEVEL_GAP_LU = 1.5;

export type SeamRefusal = 'no-part-b' | 'bad-key' | 'no-join' | 'not-measurable';

export interface SeamSpec {
  partAKey: string;
  partBKey: string;
  editA: MasterEdit | null;
  join: MasterJoin;
}

export type SeamPlan =
  | { ok: true; spec: SeamSpec; previewKey: string }
  | { ok: false; reason: SeamRefusal };

/**
 * Where the seam sits in the JOINED timeline, and the window to keep around it.
 *
 * `acrossfade=d=D` consumes the last D seconds of the first input, so in the
 * output the crossfade occupies `[aLen - D, aLen]`. Everything here is derived
 * from that one fact.
 */
export function seamWindow(params: {
  editA: MasterEdit | null;
  partASec: number;
  join: MasterJoin;
  partBSec: number;
  contextSec?: number;
}): { seamStart: number; seamEnd: number; from: number; to: number } | null {
  const { editA, partASec, join, partBSec } = params;
  const context = params.contextSec ?? SEAM_CONTEXT_SEC;
  if (!Number.isFinite(partASec) || !Number.isFinite(partBSec)) return null;
  if (partASec <= 0 || partBSec <= 0) return null;

  const aLen = editedDurationSec(editA ?? NO_EDIT, partASec);
  const bLen = editedDurationSec(join.editB ?? NO_EDIT, partBSec);
  if (aLen <= 0 || bLen <= 0) return null;

  const seamStart = Math.max(0, aLen - join.overlapSec);
  const seamEnd = aLen;
  const joined = aLen + bLen - join.overlapSec;
  return {
    seamStart,
    seamEnd,
    from: Math.max(0, seamStart - context),
    // Never past the end of the joined programme — an atrim running off the end
    // yields a preview that looks truncated when nothing is wrong.
    to: Math.min(joined, seamEnd + context),
  };
}

/**
 * A stable name for one exact set of settings.
 *
 * Deterministic so that re-requesting a preview the operator already heard
 * costs nothing, and so nudging the trim by 0.1s produces a DIFFERENT file
 * rather than overwriting the one still playing — the classic way a preview
 * lies about what it contains.
 *
 * FNV-1a rather than a crypto hash: this identifies a disposable scratch file,
 * not anything an attacker gains by colliding with, and staying dependency-free
 * keeps the module importable from anywhere.
 */
export function seamFingerprint(spec: SeamSpec): string {
  const edit = (e: MasterEdit | null) => {
    const v = e ?? NO_EDIT;
    return `${v.trimStartSec}/${v.trimEndSec ?? 'end'}/${v.fadeInSec}/${v.fadeOutSec}/${v.curve}`;
  };
  const descriptor = [
    spec.partAKey,
    spec.partBKey,
    edit(spec.editA),
    edit(spec.join.editB),
    spec.join.overlapSec,
    spec.join.curve,
  ].join('|');

  // Two passes with different offset bases, concatenated — 64 bits of name,
  // which is far past what a scratch folder needs to stay collision-free.
  return `${fnv1a(descriptor, 0x811c9dc5)}${fnv1a(descriptor, 0x01000193)}`;
}

function fnv1a(text: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** S3 key for one exact set of settings. */
export function seamPreviewKey(spec: SeamSpec): string {
  return `${SEAM_PREFIX}${seamFingerprint(spec)}.mp3`;
}

/** True if the key is a preview this module produced. */
export function isSeamPreviewKey(key: string): boolean {
  return isMasteringKey(key) && key.startsWith(SEAM_PREFIX) && key.endsWith('.mp3');
}

/**
 * Decide whether these settings can be previewed at all.
 *
 * Deliberately thin: everything about whether the JOIN is legal already lives
 * in `master-join`, and duplicating it here would create a second opinion.
 * This only checks that there is something to preview and that both keys are
 * inside the workspace.
 */
export function planSeamPreview(spec: SeamSpec): SeamPlan {
  if (!spec.join) return { ok: false, reason: 'no-join' };
  if (!spec.partBKey) return { ok: false, reason: 'no-part-b' };
  if (!isMasteringKey(spec.partAKey) || !isMasteringKey(spec.partBKey)) {
    return { ok: false, reason: 'bad-key' };
  }
  return { ok: true, spec, previewKey: seamPreviewKey(spec) };
}

export function seamRefusalMessage(reason: SeamRefusal): string {
  switch (reason) {
    case 'no-part-b': return 'Attach Part B before previewing the seam.';
    case 'no-join': return 'There is no crossfade to preview.';
    case 'bad-key': return 'Both parts must be in the mastering workspace.';
    case 'not-measurable': return 'The length of both parts must be readable to place the seam.';
  }
}

/**
 * The preview render: the REAL join graph, then an atrim around the seam.
 *
 * `asetpts=PTS-STARTPTS` after the trim so the output starts at zero — without
 * it the MP3 carries the joined timeline's timestamps and players show the clip
 * as starting three minutes in.
 */
export function buildSeamPreviewArgs(params: {
  partAPath: string;
  partBPath: string;
  editA: MasterEdit | null;
  partASec: number;
  join: MasterJoin;
  partBSec: number;
  outPath: string;
  contextSec?: number;
}): string[] | null {
  const window = seamWindow(params);
  if (!window) return null;

  const graph = buildJoinFilterComplex({
    editA: params.editA,
    partASec: params.partASec,
    join: params.join,
    partBSec: params.partBSec,
  });
  const trimmed =
    `[${JOIN_OUTPUT_LABEL}]atrim=start=${ff(window.from)}:end=${ff(window.to)},` +
    `asetpts=PTS-STARTPTS[seam]`;

  return [
    '-hide_banner', '-nostats',
    '-i', params.partAPath,
    '-i', params.partBPath,
    '-filter_complex', `${graph};${trimmed}`,
    '-map', '[seam]',
    '-c:a', 'libmp3lame', '-b:a', SEAM_BITRATE, '-ar', '48000', '-ac', '2',
    '-y', params.outPath,
  ];
}

/**
 * Measure one side of the seam — the thing the ear blames the crossfade for.
 *
 * Two files that sit 2 LU apart cannot be joined invisibly at any curve or any
 * placement: the crossfade becomes a volume ramp between two different
 * recordings. Reporting the gap turns "the seam sounds wrong" into either "move
 * the trim" or "match the parts first", which are completely different jobs.
 */
export function buildSeamLoudnessArgs(params: {
  path: string;
  startSec: number;
  seconds: number;
}): string[] {
  return [
    '-hide_banner', '-nostats',
    '-ss', ff(Math.max(0, params.startSec)), '-t', ff(Math.max(0, params.seconds)),
    '-i', params.path,
    '-af', 'ebur128=peak=true', '-f', 'null', '-',
  ];
}

/**
 * The two regions to measure, in SOURCE time for each file — the last seconds
 * of Part A as it will be used, and the first seconds of Part B as it will be
 * used. Both are expressed against their own file, because that is what ffmpeg
 * is given.
 */
export function seamLevelRegions(params: {
  editA: MasterEdit | null;
  partASec: number;
  join: MasterJoin;
  partBSec: number;
  windowSec?: number;
}): { a: { startSec: number; seconds: number }; b: { startSec: number; seconds: number } } | null {
  const { editA, partASec, join, partBSec } = params;
  const win = params.windowSec ?? SEAM_LEVEL_WINDOW_SEC;
  const aLen = editedDurationSec(editA ?? NO_EDIT, partASec);
  const bLen = editedDurationSec(join.editB ?? NO_EDIT, partBSec);
  if (aLen <= 0 || bLen <= 0) return null;

  const aStartInSource = (editA ?? NO_EDIT).trimStartSec;
  const bStartInSource = (join.editB ?? NO_EDIT).trimStartSec;
  // A's tail ends where the crossfade ends — i.e. at the end of A as used.
  const aWindow = Math.min(win, aLen);
  const bWindow = Math.min(win, bLen);
  return {
    a: { startSec: aStartInSource + aLen - aWindow, seconds: aWindow },
    b: { startSec: bStartInSource, seconds: bWindow },
  };
}

export interface SeamLevels {
  tailLufs: number | null;
  headLufs: number | null;
  gapLu: number | null;
  mismatched: boolean;
}

/**
 * Turn two integrated readings into the one sentence that changes what the
 * operator does next.
 *
 * A null reading is reported as null rather than as zero: "we could not measure
 * this" and "these are identical" must never look the same.
 */
export function summariseSeamLevels(tailLufs: number | null, headLufs: number | null): SeamLevels {
  const usable = typeof tailLufs === 'number' && Number.isFinite(tailLufs)
    && typeof headLufs === 'number' && Number.isFinite(headLufs);
  if (!usable) return { tailLufs: null, headLufs: null, gapLu: null, mismatched: false };
  const gap = Math.round(Math.abs(tailLufs - headLufs) * 10) / 10;
  return { tailLufs, headLufs, gapLu: gap, mismatched: gap >= SEAM_LEVEL_GAP_LU };
}

/** Operator-facing reading of the gap. Says what to DO, not just what it is. */
export function describeSeamLevels(levels: SeamLevels): string {
  if (levels.gapLu === null) return 'The level either side of the seam could not be measured.';
  if (!levels.mismatched) {
    return `Part A's tail and Part B's head are within ${levels.gapLu} LU — close enough that ` +
      'placement, not level, is what decides this seam.';
  }
  return `Part A's tail and Part B's head are ${levels.gapLu} LU apart. No crossfade placement ` +
    'hides a step that size — it is heard as a different recording starting. Match the parts ' +
    'before joining them.';
}

/** ffmpeg wants plain decimals; keep them short and free of float noise. */
const ff = (seconds: number): string => String(Math.round(seconds * 1000) / 1000);
