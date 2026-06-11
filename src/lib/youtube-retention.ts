/**
 * Pure retention-analysis helpers for the /admin/youtube "Retention Intelligence"
 * feature.
 *
 * YouTube's audienceRetention report returns a curve of audienceWatchRatio at
 * each elapsedVideoTimeRatio (0.0 → 1.0). These helpers turn that raw curve
 * into the few numbers that actually drive a decision — how much of the
 * audience is still watching at the key early checkpoints — and classify a
 * video's opening ("hook") against a benchmark template.
 *
 * The verdict is anchored on a RATIO checkpoint (default 10% of the video),
 * NOT a fixed number of seconds, so it compares apples-to-apples across songs
 * of different lengths and against the benchmark. Seconds-based holds (15s/30s)
 * are also surfaced for human readability when a duration is known.
 *
 * Everything is pure (no network) so it is exhaustively unit-testable and runs
 * identically on server and client.
 */

export interface RetentionPoint {
  ratio: number; // elapsedVideoTimeRatio 0..1
  watchRatio: number; // audienceWatchRatio (≈1.0 at the start)
}
export type RetentionCurve = RetentionPoint[];

/** The elapsed-ratio checkpoint the hook verdict is anchored on (10% in). */
export const VERDICT_CHECKPOINT = 0.1;

export type RetentionVerdict = 'strong' | 'average' | 'weak' | 'unknown';

export interface RetentionSummary {
  hold5pct: number | null;
  hold10pct: number | null;
  hold25pct: number | null;
  hold50pct: number | null;
  holdEnd: number | null;
  hold15s: number | null; // requires a known duration
  hold30s: number | null; // requires a known duration
}

/**
 * Parse raw Analytics rows ([elapsedVideoTimeRatio, audienceWatchRatio]) into a
 * clean, ascending-by-ratio curve. Non-finite rows are dropped.
 */
export function parseRetentionRows(
  rows: ReadonlyArray<ReadonlyArray<string | number>>
): RetentionCurve {
  const pts: RetentionCurve = [];
  for (const r of rows ?? []) {
    const ratio = Number(r?.[0]);
    const watchRatio = Number(r?.[1]);
    if (Number.isFinite(ratio) && Number.isFinite(watchRatio)) pts.push({ ratio, watchRatio });
  }
  pts.sort((a, b) => a.ratio - b.ratio);
  return pts;
}

/**
 * audienceWatchRatio at an arbitrary elapsed ratio, linearly interpolated
 * between the two nearest curve points. Clamps to the curve's endpoints.
 * Returns null for an empty curve.
 */
export function watchRatioAtRatio(curve: RetentionCurve, ratio: number): number | null {
  if (!curve.length) return null;
  if (ratio <= curve[0].ratio) return curve[0].watchRatio;
  const last = curve[curve.length - 1];
  if (ratio >= last.ratio) return last.watchRatio;
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i];
    const b = curve[i + 1];
    if (ratio >= a.ratio && ratio <= b.ratio) {
      const span = b.ratio - a.ratio;
      if (span <= 0) return a.watchRatio;
      const t = (ratio - a.ratio) / span;
      return a.watchRatio + t * (b.watchRatio - a.watchRatio);
    }
  }
  return last.watchRatio;
}

/** Hold at the first N seconds, given the video's duration. Null if unknown. */
export function holdAtSeconds(
  curve: RetentionCurve,
  durationSeconds: number,
  seconds: number
): number | null {
  if (!curve.length || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  const ratio = Math.min(1, Math.max(0, seconds / durationSeconds));
  return watchRatioAtRatio(curve, ratio);
}

/** Summarize a curve into the key checkpoints (duration is optional). */
export function summarizeCurve(curve: RetentionCurve, durationSeconds?: number): RetentionSummary {
  const at = (r: number) => watchRatioAtRatio(curve, r);
  const dur = durationSeconds ?? 0;
  return {
    hold5pct: at(0.05),
    hold10pct: at(0.1),
    hold25pct: at(0.25),
    hold50pct: at(0.5),
    holdEnd: at(1),
    hold15s: dur > 0 ? holdAtSeconds(curve, dur, 15) : null,
    hold30s: dur > 0 ? holdAtSeconds(curve, dur, 30) : null,
  };
}

/**
 * Classify a video's hook from its checkpoint hold vs a benchmark's hold at the
 * same checkpoint. When no benchmark is available, fall back to absolute
 * thresholds. Returns 'unknown' when the value can't be computed.
 */
export function classifyHook(
  hold: number | null,
  benchmarkHold: number | null
): RetentionVerdict {
  if (hold == null || !Number.isFinite(hold)) return 'unknown';
  if (benchmarkHold != null && benchmarkHold > 0) {
    const r = hold / benchmarkHold;
    if (r >= 0.9) return 'strong';
    if (r >= 0.7) return 'average';
    return 'weak';
  }
  // No benchmark — absolute thresholds (template holds ~0.73 at 10%).
  if (hold >= 0.65) return 'strong';
  if (hold >= 0.45) return 'average';
  return 'weak';
}

/** Convenience: full analysis of one video's curve vs an optional benchmark. */
export interface RetentionAnalysis {
  summary: RetentionSummary;
  verdict: RetentionVerdict;
  checkpoint: number; // the ratio the verdict used
  holdAtCheckpoint: number | null;
  benchmarkHoldAtCheckpoint: number | null;
}

export function analyzeRetention(
  curve: RetentionCurve,
  opts: { durationSeconds?: number; benchmarkCurve?: RetentionCurve } = {}
): RetentionAnalysis {
  const summary = summarizeCurve(curve, opts.durationSeconds);
  const holdAtCheckpoint = watchRatioAtRatio(curve, VERDICT_CHECKPOINT);
  const benchmarkHoldAtCheckpoint = opts.benchmarkCurve
    ? watchRatioAtRatio(opts.benchmarkCurve, VERDICT_CHECKPOINT)
    : null;
  return {
    summary,
    verdict: classifyHook(holdAtCheckpoint, benchmarkHoldAtCheckpoint),
    checkpoint: VERDICT_CHECKPOINT,
    holdAtCheckpoint,
    benchmarkHoldAtCheckpoint,
  };
}
