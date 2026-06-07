/**
 * youtube-shorts — classify channel items as Shorts vs long-form videos.
 *
 * YouTube's RSS/Data feeds don't flag Shorts, and the only signal available at
 * render time (without an extra per-video request) is the duration the feed
 * already attaches. YouTube caps Shorts at 3 minutes, so we treat a known
 * duration ≤ 180s as a Short. For this channel (songs run 4–6 min) that cleanly
 * separates the sub-minute Shorts; an item with unknown duration defaults to a
 * regular video so it never disappears from the main grid.
 */

/** YouTube's maximum Short length, in seconds. */
export const SHORTS_MAX_DURATION_SECONDS = 180;

/** Parse an ISO-8601 duration (PT#H#M#S) to seconds; null if unparseable. */
export function iso8601DurationToSeconds(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const [, h, min, s] = m;
  if (h === undefined && min === undefined && s === undefined) return null; // bare "PT"
  return Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0);
}

/** A feed item is a Short when its known duration is ≤ the Shorts ceiling. */
export function isShort(video: { duration?: string }): boolean {
  const seconds = iso8601DurationToSeconds(video.duration);
  return seconds !== null && seconds <= SHORTS_MAX_DURATION_SECONDS;
}

export interface PartitionedVideos<T> {
  shorts: T[];
  videos: T[];
}

/** Split a feed into Shorts and long-form videos, preserving order in each. */
export function partitionShorts<T extends { duration?: string }>(all: T[]): PartitionedVideos<T> {
  const shorts: T[] = [];
  const videos: T[] = [];
  for (const item of all) {
    (isShort(item) ? shorts : videos).push(item);
  }
  return { shorts, videos };
}
