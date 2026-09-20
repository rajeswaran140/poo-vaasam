/**
 * Recording how long a video sits unaired — so the 48-hour rule can eventually
 * be tested instead of repeated.
 *
 * **WHY THIS HAS TO BE RECORDED AT UPLOAD TIME.** Once a premiere airs, YouTube
 * **overwrites `snippet.publishedAt` with the premiere time**. The original
 * upload moment is then gone from the API, permanently — so the gap cannot be
 * reconstructed afterwards for any song that has already aired. Every past
 * release is unmeasurable. Only the ones observed while still `upcoming` can
 * ever contribute.
 *
 * **WHAT IT IS MEANT TO SETTLE.** The release checklist asserts "keep the gap
 * under 48h", and that rule rests on ONE case: QDJG1P7D0Aw sat 71.6h and took
 * 2 views in its first 89 minutes. The most recent comparable release
 * contradicts it — வெண்மதி sat 69.5h and took 46 views in its first 3.4 hours,
 * roughly twenty times better at effectively the same gap. Two anecdotes
 * pointing opposite ways is not a rule, and the channel has been advised from
 * it repeatedly.
 *
 * ⚠️ So this module records and reports. It does NOT conclude. Twenty
 * observations from now the numbers may support the rule, contradict it, or
 * show the gap explains nothing next to an 88-fold spread that is currently
 * unexplained by anything measurable. Any of those is a better answer than
 * repeating the assertion.
 */

/** A video as the Data API describes it while still unaired. */
export interface UpcomingSnapshot {
  videoId: string;
  title: string;
  /** `snippet.publishedAt` — the UPLOAD time, and only trustworthy before it airs. */
  publishedAt: string;
  /** `liveStreamingDetails.scheduledStartTime`. */
  scheduledStartTime?: string;
  /** `snippet.liveBroadcastContent` — must be 'upcoming' for this to be recordable. */
  liveBroadcastContent: string;
}

export interface PremiereObservation {
  videoId: string;
  title: string;
  uploadedAt: string;
  scheduledStartTime: string;
  gapHours: number;
  recordedAt: string;
}

/** Hours between upload and the scheduled premiere. NaN-safe: null if unreadable. */
export function gapHours(uploadedAt: string, scheduledStartTime: string): number | null {
  const a = Date.parse(uploadedAt);
  const b = Date.parse(scheduledStartTime);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const h = (b - a) / 3_600_000;
  return Number.isFinite(h) ? Math.round(h * 10) / 10 : null;
}

/**
 * An observation, or null when this video cannot contribute one.
 *
 * ⚠️ REFUSES ANYTHING NOT `upcoming`. That is the whole correctness of this
 * module: on an aired premiere `publishedAt` IS the premiere time, so recording
 * one would silently store a gap of ~0 and poison the dataset with exactly the
 * measurement the module exists to avoid. A negative gap is refused for the
 * same reason — it means the fields are not what we think they are.
 */
export function observe(v: UpcomingSnapshot, now: Date = new Date()): PremiereObservation | null {
  if (v.liveBroadcastContent !== 'upcoming') return null;
  if (!v.scheduledStartTime) return null;
  const gap = gapHours(v.publishedAt, v.scheduledStartTime);
  if (gap === null || gap < 0) return null;
  return {
    videoId: v.videoId,
    title: v.title,
    uploadedAt: v.publishedAt,
    scheduledStartTime: v.scheduledStartTime,
    gapHours: gap,
    recordedAt: now.toISOString(),
  };
}

/** The threshold the checklist asserts. Named so the report can be re-cut against another. */
export const ASSERTED_GAP_LIMIT_HOURS = 48;

export interface LaunchResult {
  observation: PremiereObservation;
  /** Views on the day it aired. Null when it has not aired, or analytics lags. */
  day0Views: number | null;
}

export interface GapReport {
  under: number[];
  over: number[];
  medianUnder: number | null;
  medianOver: number | null;
  /** Plain-language verdict, deliberately cautious about small samples. */
  verdict: string;
}

const median = (xs: number[]): number | null =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null;

/**
 * Split launches by the asserted threshold and compare.
 *
 * Says "not enough data" until BOTH sides have at least five, because the whole
 * point is to stop drawing conclusions from one or two cases — which is how the
 * 48-hour rule came to be stated as fact in the first place.
 */
export function report(results: LaunchResult[], limit = ASSERTED_GAP_LIMIT_HOURS): GapReport {
  const withViews = results.filter((r) => typeof r.day0Views === 'number');
  const under = withViews.filter((r) => r.observation.gapHours < limit).map((r) => r.day0Views as number);
  const over = withViews.filter((r) => r.observation.gapHours >= limit).map((r) => r.day0Views as number);
  const mu = median(under);
  const mo = median(over);

  let verdict: string;
  if (under.length < 5 || over.length < 5) {
    verdict =
      `Not enough data — ${under.length} under ${limit}h and ${over.length} at or over. ` +
      `Need at least 5 of each before this says anything.`;
  } else if (mu === null || mo === null) {
    verdict = 'Not enough data.';
  } else if (mu > mo * 1.5) {
    verdict = `Supports the rule: median ${mu} under ${limit}h vs ${mo} at or over.`;
  } else if (mo > mu * 1.5) {
    verdict = `CONTRADICTS the rule: median ${mo} at or over ${limit}h vs ${mu} under it.`;
  } else {
    verdict = `No clear effect: median ${mu} under ${limit}h vs ${mo} at or over. The gap is not the lever.`;
  }
  return { under, over, medianUnder: mu, medianOver: mo, verdict };
}
