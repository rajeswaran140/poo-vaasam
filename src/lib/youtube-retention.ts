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

export interface BoundaryDrop {
  /** Elapsed ratio of the boundary being tested. */
  ratio: number;
  /** Hold just before / just after the boundary. */
  before: number | null;
  after: number | null;
  /** Loss across the boundary, in points of hold. Positive = viewers left. */
  drop: number | null;
  /** Average slope (hold lost per 1% elapsed) before and after the boundary. */
  slopeBefore: number | null;
  slopeAfter: number | null;
  /**
   * True when the boundary itself is a cliff: the loss across the window is
   * both material AND steeper than the run-up to it. Null when unknowable.
   */
  isCliff: boolean | null;
}

/**
 * Does a specific moment in the video lose the audience?
 *
 * WHY A SLOPE COMPARISON, NOT A RAW DROP. Every retention curve falls, so "10%
 * of viewers left across this window" proves nothing on its own — a video
 * shedding 10% per window everywhere is not reacting to the boundary. The
 * question is whether the fall STEEPENS there. So this measures the local slope
 * on both sides and only calls a cliff when the after-slope is materially worse
 * than the before-slope.
 *
 * Built for the paired song+instrumental format: `i_NxjvjUbkg` runs 10:08 with
 * vocals ending at 5:36 (ratio 0.553). A cliff at that ratio means the
 * instrumental half loses them; a continued gentle decline means it holds.
 *
 * `window` is the half-width in elapsed-ratio units either side of the point.
 */
export const CLIFF_MIN_DROP = 0.05; // 5 points of hold
export const CLIFF_SLOPE_FACTOR = 2; // after-slope this many times the before-slope

export function boundaryDrop(
  curve: RetentionCurve,
  ratio: number,
  window = 0.05
): BoundaryDrop {
  const empty: BoundaryDrop = {
    ratio,
    before: null,
    after: null,
    drop: null,
    slopeBefore: null,
    slopeAfter: null,
    isCliff: null,
  };
  if (!curve.length || !Number.isFinite(ratio) || window <= 0) return empty;

  const at = (r: number) => watchRatioAtRatio(curve, Math.min(1, Math.max(0, r)));
  const before = at(ratio - window);
  const after = at(ratio + window);
  const runUp = at(ratio - 2 * window);
  if (before === null || after === null) return empty;

  const drop = before - after;
  // Slope per unit elapsed ratio; the run-up window is the same width, so the
  // two are directly comparable.
  const slopeAfter = drop / window;
  const slopeBefore = runUp === null ? null : (runUp - before) / window;

  const isCliff =
    slopeBefore === null
      ? null
      : drop >= CLIFF_MIN_DROP && slopeAfter > CLIFF_SLOPE_FACTOR * Math.max(slopeBefore, 0.0001);

  return { ratio, before, after, drop, slopeBefore, slopeAfter, isCliff };
}

export interface Rebound {
  /** Largest RISE in hold found after the boundary, in points. Null if none. */
  rise: number | null;
  /** Elapsed ratio where that rise peaks. */
  atRatio: number | null;
  /** Hold at the low point the rise climbs from. */
  fromHold: number | null;
  /** True when the rise is big enough to mean deliberate seeking, not noise. */
  isSeekIn: boolean | null;
}

/**
 * Do viewers SEEK INTO the second half?
 *
 * A retention curve normally only falls — a viewer who left cannot un-leave. So
 * a sustained RISE after a point means people are jumping straight to it, and
 * that is a demand signal rather than a retention one. For the paired
 * song+instrumental format it answers Raj's real question: is anyone coming
 * back specifically for the music version, or does it only ever get spillover?
 *
 * Measured as the largest climb from any local minimum after the boundary.
 */
export const SEEK_IN_MIN_RISE = 0.02; // 2 points of hold

export function reboundAfter(curve: RetentionCurve, ratio: number): Rebound {
  const empty: Rebound = { rise: null, atRatio: null, fromHold: null, isSeekIn: null };
  const after = curve.filter((p) => p.ratio >= ratio);
  if (after.length < 2) return empty;

  let low = after[0].watchRatio;
  let best = 0;
  let bestAt = after[0].ratio;
  let bestFrom = low;
  for (const p of after) {
    if (p.watchRatio < low) low = p.watchRatio;
    const rise = p.watchRatio - low;
    if (rise > best) {
      best = rise;
      bestAt = p.ratio;
      bestFrom = low;
    }
  }
  return {
    rise: best,
    atRatio: bestAt,
    fromHold: bestFrom,
    isSeekIn: best >= SEEK_IN_MIN_RISE,
  };
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
