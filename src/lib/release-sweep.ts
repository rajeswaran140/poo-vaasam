/**
 * Pure logic behind the weekly release sweep — no network, no DynamoDB.
 *
 * The sweep script itself is I/O, but two decisions inside it change how every
 * video gets graded, so they live here where they can be tested:
 *
 *   - the ISO-8601 duration parse, which decides `isShort`. Get it wrong and a
 *     7-minute song is graded against the Shorts rules, or a Short escapes them.
 *   - the quota cost model. `captions.list` costs 50 units, not 1; reading it as
 *     1 burned an entire 10,000-unit day on 2026-07-29. The sweep refuses to
 *     start rather than repeat that, so the arithmetic deciding "refuse" has to
 *     be right.
 */

/** Longest a video can be and still be a Short. */
export const SHORT_MAX_SECONDS = 180;

/** Documented YouTube Data API costs, in quota units. */
export const COST_VIDEOS_LIST = 1;
export const COST_CAPTIONS_LIST = 50;
export const COST_PLAYLIST_PAGE = 1;

export const DAILY_QUOTA_BUDGET = 10_000;

/**
 * How much of the day this sweep may take. Well under the budget on purpose —
 * the snapshot cron and any ad-hoc work share the same 10,000, and a job that
 * can starve everything else is worse than a job that skips a week.
 */
export const MAX_SWEEP_UNITS = 2_000;

/**
 * Parse an ISO-8601 duration to seconds.
 *
 * Returns 0 for anything unparseable rather than throwing: an unreadable
 * duration should make a video fall out of the Shorts rules, not abort a sweep
 * that still has other videos to check.
 */
export function parseIsoDuration(iso: string | null | undefined): number {
  if (!iso || typeof iso !== 'string') return 0;
  const m = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso);
  if (!m) return 0;
  const [, d, h, min, s] = m;
  const total =
    Number(d ?? 0) * 86_400 + Number(h ?? 0) * 3_600 + Number(min ?? 0) * 60 + Number(s ?? 0);
  return Number.isFinite(total) ? Math.floor(total) : 0;
}

/** A duration of 0 means "unknown", which is NOT a Short. */
export function isShortDuration(seconds: number): boolean {
  return seconds > 0 && seconds <= SHORT_MAX_SECONDS;
}

/**
 * Quota cost of checking one video, given how many playlists are probed.
 *
 * `playlistPages` is pages, not playlists — a playlist past 50 items costs a
 * page per 50. The All Songs playlist has 54, which is exactly the off-by-one
 * that made a video look absent from it twice.
 */
export function costPerVideo(playlistPages: number): number {
  const pages = Number.isFinite(playlistPages) && playlistPages > 0 ? Math.floor(playlistPages) : 0;
  return COST_VIDEOS_LIST + COST_CAPTIONS_LIST + pages * COST_PLAYLIST_PAGE;
}

export interface SweepPlan {
  videos: number;
  estimatedUnits: number;
  affordable: boolean;
  /** Largest video count that would fit under the cap. */
  maxAffordableVideos: number;
}

/** Decide whether a sweep of `videos` videos may run. */
export function planSweep(
  videos: number,
  playlistPages: number,
  capUnits: number = MAX_SWEEP_UNITS
): SweepPlan {
  const n = Number.isFinite(videos) && videos > 0 ? Math.floor(videos) : 0;
  const per = costPerVideo(playlistPages);
  const estimatedUnits = n * per;
  return {
    videos: n,
    estimatedUnits,
    affordable: estimatedUnits <= capUnits,
    maxAffordableVideos: per > 0 ? Math.floor(capUnits / per) : 0,
  };
}

/**
 * Is this caption track an auto-generated one?
 *
 * Kept as a named predicate because the sweep's whole reason for recurring is
 * that YouTube REGENERATES these after deletion — one reappeared on a Tamil
 * Short the day after a catalogue-wide cleanup.
 */
export function isAutoCaption(track: { trackKind?: string }): boolean {
  return track.trackKind === 'asr';
}
