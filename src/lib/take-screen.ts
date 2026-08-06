/**
 * Screening generated takes — removing the ones that CANNOT work, before a
 * human listens to them.
 *
 * WHY. ~2,500 takes were generated to ship ~40-50 songs: roughly 55 listened to
 * per release, ~440 listening decisions a month. That is the real bottleneck in
 * the pipeline, and none of the tooling touched it — mastering, publishing and
 * rendering all begin AFTER a good take exists.
 *
 * ⚠️ THIS JUDGES VIABILITY, NEVER TASTE. Every rule here is a measurement or an
 * arithmetic consequence of one, and each answers "can this take be used at
 * all?" — not "is it any good?". A take with a baked-in fade cannot be Part A
 * of a join however beautiful the melody; a take whose master is forced into
 * dynamic normalisation will be compressed however well it is sung. Those are
 * refusals that can be made without hearing anything. Everything that survives
 * still needs the ear; the point is only that the ear is spent on candidates.
 *
 * The same contract as the rest of the module: it must be possible to check
 * every claim. An opinion about a melody would be unfalsifiable, so there
 * isn't one.
 */

/**
 * Flat enough to be worth a second listen — an OBSERVATION, never a refusal.
 *
 * ⚠️ THIS WAS A BLOCKER AND IT WAS WRONG. The 2.3-5.0 range it came from was
 * measured on finished full-length MP3s months ago, then applied to raw
 * sections. Run against real audio 2026-08-06 it rejected வானவில்லே **Part B
 * (LRA 1.6) — half of a song that shipped**. Two mistakes in one rule:
 *
 *   1. LRA is not comparable across programme LENGTHS. A 4-minute section has
 *      less room to vary than a 7-minute song: Part A 2.5 + Part B 1.6
 *      assembled to 2.2.
 *   2. The catalogue floor had already moved — வானவில்லே ships at 2.2, below
 *      the range the threshold was built on.
 *
 * So LRA is reported and never blocks. A screen that discards good work is
 * worse than no screen, because the discarding is invisible.
 */
export const LOW_LRA_NOTE = 2.2;

/** The delivery ceiling every master is held to. */
export const TRUE_PEAK_CEILING_DBTP = -1;

/** SUNO arrives -14.1 to -14.6 LUFS. Outside this band suggests a failed render. */
export const EXPECTED_LUFS_RANGE: readonly [number, number] = [-20, -8];

/** Longer than this at the head is dead air, not an intro breath. */
export const MAX_HEAD_SILENCE_SEC = 2;

/** A take this far from the intended length is a truncation or a runaway. */
export const DURATION_TOLERANCE = 0.25;

/** What the take is FOR — a fade is only disqualifying on a section that joins. */
export type TakeRole = 'song' | 'lead-in';

/** Everything the screen needs. All optional: an unmeasured field is never a refusal. */
export interface TakeMeasurements {
  file: string;
  durationSec?: number | null;
  integratedLufs?: number | null;
  truePeakDbtp?: number | null;
  lra?: number | null;
  leadingSilenceSec?: number | null;
  trailingSilenceSec?: number | null;
  /** How far the last second sits below the four before it. See master-analysis. */
  tailDropLu?: number | null;
}

/** `note` neither blocks nor asks for a fix — it is something worth knowing. */
export type FindingSeverity = 'blocker' | 'fixable' | 'note';

export interface ScreenFinding {
  severity: FindingSeverity;
  code: string;
  detail: string;
}

export interface ScreenResult {
  file: string;
  verdict: 'shortlist' | 'reject' | 'unmeasured';
  findings: ScreenFinding[];
}

/**
 * The true peak the MASTER will land on if loudnorm applies a single static
 * gain — which is the only mode that preserves dynamics.
 *
 * A linear gain moves every sample equally, so the output peak is simply the
 * input peak plus the gain needed to reach target. When that lands above the
 * ceiling ffmpeg silently falls back to DYNAMIC normalisation, which compresses
 * — the exact failure the dynamics proof was built to detect after the fact.
 * Predicting it lets the take be rejected before it is ever mastered.
 */
export function predictedLinearOutputPeak(
  integratedLufs: number,
  truePeakDbtp: number,
  targetLufs: number,
): number {
  return Math.round((truePeakDbtp + (targetLufs - integratedLufs)) * 100) / 100;
}

/**
 * Screen one take.
 *
 * `unmeasured` is its own verdict, never a rejection: a file ffmpeg could not
 * read has not failed, it simply has not been assessed. Treating unknown as bad
 * is how a screen quietly discards good work.
 */
export function screenTake(
  m: TakeMeasurements,
  opts: { role?: TakeRole; targetLufs?: number; expectedDurationSec?: number | null } = {},
): ScreenResult {
  const role = opts.role ?? 'song';
  const target = opts.targetLufs ?? -14;
  const findings: ScreenFinding[] = [];

  const num = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

  if (!num(m.durationSec) && !num(m.integratedLufs)) {
    return { file: m.file, verdict: 'unmeasured', findings: [] };
  }

  // 1. Will mastering be forced to COMPRESS this take?
  if (num(m.integratedLufs) && num(m.truePeakDbtp)) {
    const predicted = predictedLinearOutputPeak(m.integratedLufs, m.truePeakDbtp, target);
    if (predicted > TRUE_PEAK_CEILING_DBTP) {
      findings.push({
        severity: 'blocker',
        code: 'forces-dynamic',
        detail:
          `A linear gain to ${target} LUFS would put the peak at ${predicted.toFixed(2)} dBTP, above the ` +
          `${TRUE_PEAK_CEILING_DBTP} ceiling — so loudnorm will fall back to dynamic mode and COMPRESS it. ` +
          `Re-roll rather than master this take.`,
      });
    }
  }

  // 2. Flat — worth knowing, never a rejection. See LOW_LRA_NOTE.
  if (num(m.lra) && m.lra < LOW_LRA_NOTE) {
    findings.push({
      severity: 'note',
      code: 'low-range',
      detail:
        `Loudness range ${m.lra.toFixed(1)} LU — flat, but sections legitimately measure lower than whole ` +
        `songs (வானவில்லே Part B was 1.6 and shipped). Judge by ear; nothing downstream restores dynamics.`,
    });
  }

  // 3. A failed render rather than a quiet one.
  if (num(m.integratedLufs)) {
    const [lo, hi] = EXPECTED_LUFS_RANGE;
    if (m.integratedLufs < lo || m.integratedLufs > hi) {
      findings.push({
        severity: 'blocker',
        code: 'level-outlier',
        detail:
          `Integrated loudness ${m.integratedLufs.toFixed(1)} LUFS is outside ${lo}..${hi} — generations ` +
          `normally arrive near -14. This usually means a broken or near-silent render.`,
      });
    }
  }

  // 4. Truncation or runaway, when the intended length is known.
  if (num(m.durationSec) && num(opts.expectedDurationSec) && opts.expectedDurationSec > 0) {
    const ratio = m.durationSec / opts.expectedDurationSec;
    if (Math.abs(ratio - 1) > DURATION_TOLERANCE) {
      findings.push({
        severity: 'blocker',
        code: 'duration-outlier',
        detail:
          `${m.durationSec.toFixed(0)}s against an expected ~${opts.expectedDurationSec.toFixed(0)}s — ` +
          `${ratio < 1 ? 'truncated' : 'overran'}.`,
      });
    }
  }

  // 5. A baked-in fade — disqualifying ONLY for a section that must crossfade.
  if (num(m.tailDropLu) && m.tailDropLu >= 3) {
    findings.push(
      role === 'lead-in'
        ? {
            severity: 'blocker',
            code: 'baked-in-fade',
            detail:
              `The tail already fades (${m.tailDropLu} LU over the last second). Crossfading into a fade ` +
              `double-attenuates the seam, and a baked-in fade cannot be removed. Re-roll this section.`,
          }
        : {
            severity: 'fixable',
            code: 'ends-with-fade',
            detail: `Ends with a fade (${m.tailDropLu} LU) — normal for a full song, but unusable as Part A of a join.`,
          },
    );
  }

  // 6. Dead air — a trim, not a rejection.
  if (num(m.leadingSilenceSec) && m.leadingSilenceSec > MAX_HEAD_SILENCE_SEC) {
    findings.push({
      severity: 'fixable',
      code: 'head-silence',
      detail: `${m.leadingSilenceSec.toFixed(2)}s of silence at the head — trim before mastering.`,
    });
  }
  if (num(m.trailingSilenceSec) && m.trailingSilenceSec > MAX_HEAD_SILENCE_SEC) {
    findings.push({
      severity: 'fixable',
      code: 'tail-silence',
      detail: `${m.trailingSilenceSec.toFixed(2)}s of silence at the tail — trim before mastering.`,
    });
  }

  const blocked = findings.some((f) => f.severity === 'blocker');
  return { file: m.file, verdict: blocked ? 'reject' : 'shortlist', findings };
}

export interface ScreenSummary {
  total: number;
  shortlisted: number;
  rejected: number;
  unmeasured: number;
  /** How many takes the screen removed from the listening pile. */
  savedFromListening: number;
  byCode: Record<string, number>;
}

/** Aggregate a run, so the value of the screen is itself measurable. */
export function summariseScreen(results: ScreenResult[]): ScreenSummary {
  const byCode: Record<string, number> = {};
  for (const r of results) {
    for (const f of r.findings) {
      if (f.severity === 'blocker') byCode[f.code] = (byCode[f.code] ?? 0) + 1;
    }
  }
  const rejected = results.filter((r) => r.verdict === 'reject').length;
  return {
    total: results.length,
    shortlisted: results.filter((r) => r.verdict === 'shortlist').length,
    rejected,
    unmeasured: results.filter((r) => r.verdict === 'unmeasured').length,
    savedFromListening: rejected,
    byCode,
  };
}
