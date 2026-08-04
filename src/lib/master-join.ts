/**
 * Two-part assembly — joining Part A and Part B with an equal-power crossfade
 * BEFORE anything is measured or mastered.
 *
 * WHY THIS BELONGS HERE RATHER THAN IN REAPER/PREMIERE. A song generated in two
 * sections has to be spliced first and mastered ONCE. Mastering the halves
 * separately and crossfading afterwards is the failure everyone hits: integrated
 * loudness is an average over a programme, so two files that each read -14 LUFS
 * do not read -14 LUFS when joined, and the overlap — two full-level sources
 * summing — spikes. Doing the join in the pre-pass makes the correct order the
 * only order available: the join happens before pass 1, so every number the job
 * reports describes the assembled song.
 *
 * EQUAL POWER IS THE POINT, and it is the default. Measured on this box
 * (2026-08-04), at the midpoint of a 3 s crossfade between two steady tones:
 *
 *     reference (either source alone)   -21.07 dB RMS
 *     c1=qsin:c2=qsin  (equal power)    -21.08 dB   ← flat
 *     c1=tri:c2=tri    (linear)         -24.08 dB   ← 3 dB hole
 *
 * `qsin` is ffmpeg's quarter-sine curve — the same shape as Reaper's equal-power
 * crossfade and Premiere's Constant Power. A linear crossfade drops 3 dB in the
 * middle of every seam, which is heard as a dip exactly where attention is
 * highest. Hence DEFAULT_CROSSFADE_CURVE, and hence the curve being exposed at
 * all rather than hard-coded: `tri` is correct for genuinely uncorrelated
 * material, and someone will eventually want it.
 *
 * Pure and I/O-free, like master-edit: this builds the filter graph and decides
 * whether it is legal; the worker runs it.
 */

import {
  buildEditFilters,
  editedDurationSec,
  isNoOpEdit,
  parseMasterEdit,
  MIN_MASTER_SECONDS,
  NO_EDIT,
  FADE_CURVES,
  type FadeCurve,
  type MasterEdit,
} from '@/lib/master-edit';

/** Equal power. See the RMS table above — this is not a stylistic default. */
export const DEFAULT_CROSSFADE_CURVE: FadeCurve = 'qsin';

/**
 * Shorter than this is a butt-splice, and the de-click ramp in master-edit
 * already handles that case better than a degenerate crossfade would.
 */
export const MIN_OVERLAP_SECONDS = 0.25;

/**
 * Longer than this is not a seam, it is a mix. At 80 BPM in 6/8 a bar is ~1.5 s,
 * so 30 s is twenty bars — far past anything a section change needs.
 */
export const MAX_OVERLAP_SECONDS = 30;

export interface MasterJoin {
  /** Part B's key in the mastering workspace. Part A is the job's own s3Key. */
  partBKey: string;
  /** Crossfade length in seconds. The joined length is A + B - this. */
  overlapSec: number;
  curve: FadeCurve;
  /**
   * Trim/fade applied to Part B before the crossfade — in practice a head trim,
   * to land B's first downbeat on the seam. Null means use B whole.
   *
   * Part A's own edit is the job's existing `edit` field, so the two halves are
   * described by the same vocabulary.
   */
  editB: MasterEdit | null;
}

/** `join: null` is the ordinary single-source master, not an error. */
export type JoinParseResult =
  | { ok: true; join: MasterJoin | null }
  | { ok: false; error: string };

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Validate an untrusted join payload. Mirrors parseMasterEdit: the route and the
 * worker both call it, because the Lambda is Event-invoked and the route is not
 * the only thing that can reach it.
 *
 * NOTE this does NOT check that partBKey is inside the mastering workspace —
 * that is `isMasteringKey`'s job and the caller's, because getting it wrong is a
 * bucket-scope problem rather than a shape problem, and it must be re-checked in
 * the worker against its own rules.
 */
export function parseMasterJoin(input: unknown): JoinParseResult {
  if (input === undefined || input === null) return { ok: true, join: null };
  if (typeof input !== 'object') return { ok: false, error: 'join must be an object' };

  const raw = input as Record<string, unknown>;

  if (typeof raw.partBKey !== 'string' || !raw.partBKey.trim()) {
    return { ok: false, error: 'join.partBKey is required' };
  }
  if (!isFiniteNumber(raw.overlapSec)) {
    return { ok: false, error: 'join.overlapSec must be a number' };
  }
  if (raw.overlapSec < MIN_OVERLAP_SECONDS || raw.overlapSec > MAX_OVERLAP_SECONDS) {
    return {
      ok: false,
      error: `join.overlapSec must be between ${MIN_OVERLAP_SECONDS} and ${MAX_OVERLAP_SECONDS} seconds`,
    };
  }

  const curve = raw.curve === undefined ? DEFAULT_CROSSFADE_CURVE : raw.curve;
  if (!FADE_CURVES.includes(curve as FadeCurve)) {
    return { ok: false, error: `join.curve must be one of ${FADE_CURVES.join(', ')}` };
  }

  let editB: MasterEdit | null = null;
  if (raw.editB !== undefined && raw.editB !== null) {
    const parsed = parseMasterEdit(raw.editB);
    if (!parsed.ok) return { ok: false, error: `join.editB: ${parsed.error}` };
    editB = isNoOpEdit(parsed.edit) ? null : parsed.edit;
  }

  return {
    ok: true,
    join: { partBKey: raw.partBKey, overlapSec: raw.overlapSec, curve: curve as FadeCurve, editB },
  };
}

/** How long the assembled song will be. The overlap is shared, not added. */
export function joinedDurationSec(partASec: number, partBSec: number, overlapSec: number): number {
  return Math.max(0, partASec + partBSec - overlapSec);
}

/**
 * The check that needs the real files, run once the worker has probed both.
 *
 * The load-bearing rule is that the overlap cannot exceed either part: ffmpeg's
 * acrossfade consumes `d` seconds from the tail of the first input and the head
 * of the second, so an overlap longer than a part produces either an error or a
 * silently truncated join — and a silently truncated join is the bad one,
 * because it still returns a file and still masters cleanly.
 */
export function validateJoinAgainstSources(
  join: MasterJoin,
  editA: MasterEdit | null,
  partASec: number,
  partBSec: number,
): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(partASec) || partASec <= 0 || !Number.isFinite(partBSec) || partBSec <= 0) {
    return { ok: false, error: 'the duration of both parts must be readable to place a crossfade' };
  }

  const aLen = editedDurationSec(editA ?? NO_EDIT, partASec);
  const bLen = editedDurationSec(join.editB ?? NO_EDIT, partBSec);

  if (join.overlapSec >= aLen) {
    return {
      ok: false,
      error: `the ${join.overlapSec}s crossfade is longer than Part A (${aLen.toFixed(2)}s after trimming)`,
    };
  }
  if (join.overlapSec >= bLen) {
    return {
      ok: false,
      error: `the ${join.overlapSec}s crossfade is longer than Part B (${bLen.toFixed(2)}s after trimming)`,
    };
  }

  const joined = joinedDurationSec(aLen, bLen, join.overlapSec);
  if (joined < MIN_MASTER_SECONDS) {
    return {
      ok: false,
      error: `the joined master would be ${joined.toFixed(2)}s — shorter than the ${MIN_MASTER_SECONDS}s minimum`,
    };
  }
  return { ok: true };
}

/** ffmpeg wants plain decimals; keep them short and free of float noise. */
const ffNum = (seconds: number): string => String(Math.round(seconds * 1000) / 1000);

/** The label the assembled stream carries out of the graph. */
export const JOIN_OUTPUT_LABEL = 'joined';

/**
 * The `-filter_complex` graph for a two-part assembly.
 *
 * Each part gets its own edit chain first — so Part A's tail trim and Part B's
 * head trim both happen BEFORE the crossfade, which is the only ordering where
 * the overlap lands where the admin placed it. A part with no edit passes
 * through `anull` rather than being referenced bare, so the graph has the same
 * shape either way and is readable in a log.
 *
 * ⚠️ The de-click ramps from master-edit still apply to each part's cut edges,
 * including the two edges that meet at the seam. That is harmless and
 * deliberate: those 10 ms ramps sit INSIDE the crossfade region, where the
 * curve has already taken that side to near-silence, so they are inaudible
 * there — and they are still needed on the OUTER edges (Part A's head, Part B's
 * tail), which no crossfade touches.
 */
export function buildJoinFilterComplex(params: {
  editA: MasterEdit | null;
  partASec: number;
  join: MasterJoin;
  partBSec: number;
}): string {
  const { editA, partASec, join, partBSec } = params;

  const chainA = buildEditFilters(editA ?? NO_EDIT, partASec);
  const chainB = buildEditFilters(join.editB ?? NO_EDIT, partBSec);

  const legA = `[0:a]${chainA.length ? chainA.join(',') : 'anull'}[a]`;
  const legB = `[1:a]${chainB.length ? chainB.join(',') : 'anull'}[b]`;
  const cross =
    `[a][b]acrossfade=d=${ffNum(join.overlapSec)}:c1=${join.curve}:c2=${join.curve}` +
    `[${JOIN_OUTPUT_LABEL}]`;

  return [legA, legB, cross].join(';');
}
