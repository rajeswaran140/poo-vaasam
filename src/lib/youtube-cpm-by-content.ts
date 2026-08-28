/**
 * CPM-by-content — pure filtering + annotation + sorting for the per-video
 * playback-based CPM view. Kept separate from the analytics client so the
 * decision logic (what counts as "pending", what's noise) is testable without
 * hitting the network.
 *
 * A note on the "no averaging" rule: [[youtube-analytics]] `fetchCpmByVideo`
 * spells out why per-video CPMs must not be arithmetic-averaged across rows.
 * The renderer honours that by omitting a "Total" / "Average CPM" summary row,
 * NOT by mangling the data here — a caller that legitimately wants Σrevenue
 * over Σplaybacks can still compute it from the returned rows.
 */

import type { CpmByVideoRow } from '@/lib/youtube-analytics';

export interface CpmRowAnnotated extends CpmByVideoRow {
  title: string;
  thumbnail: string;
  publishedAt: string;
  /**
   * Videos published in the last few days often report `playbackBasedCpm=0`
   * because monetary metrics have a 24-72h reporting delay. Flagging them
   * lets the UI render "pending" rather than a misleading "$0.00".
   */
  pending: boolean;
}

export interface CpmByContentOptions {
  /**
   * Rows with fewer than this many monetized playbacks are noise — a single
   * pre-roll on a 12-view video makes the CPM meaningless. Default 100 keeps
   * only videos with enough sample size to compare.
   */
  minMonetizedPlaybacks?: number;
  /**
   * Videos younger than this on the reporting `asOf` date are candidates for
   * the "pending" flag. Default 3 days matches the YouTube Analytics
   * monetary-metric reporting window.
   */
  pendingAgeDays?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export interface VideoMetaLookup {
  get(videoId: string): { title: string; thumbnail: string; publishedAt: string } | undefined;
}

/**
 * Join raw CPM rows with video metadata, filter noise, mark pending rows, and
 * return rows sorted by CPM descending — so the highest-value audiences bubble
 * up first. A caller wanting the outliers at BOTH ends can re-sort.
 */
export function annotateAndSortCpmRows(
  rows: CpmByVideoRow[],
  meta: VideoMetaLookup,
  asOf: Date = new Date(),
  opts: CpmByContentOptions = {}
): CpmRowAnnotated[] {
  const minPlaybacks = opts.minMonetizedPlaybacks ?? 100;
  const pendingAgeDays = opts.pendingAgeDays ?? 3;

  return rows
    .filter((r) => r.monetizedPlaybacks >= minPlaybacks)
    .map((r): CpmRowAnnotated | null => {
      const m = meta.get(r.videoId);
      // Drop rows we can't identify — a bare video id in the table is worse
      // than a shorter table.
      if (!m) return null;
      const ageMs = asOf.getTime() - new Date(m.publishedAt).getTime();
      const isPending = r.playbackBasedCpm === 0 && ageMs < pendingAgeDays * DAY_MS;
      return {
        ...r,
        title: m.title,
        thumbnail: m.thumbnail,
        publishedAt: m.publishedAt,
        pending: isPending,
      };
    })
    .filter((r): r is CpmRowAnnotated => r != null)
    .sort((a, b) => {
      // Pending rows sink to the bottom regardless of CPM — a $0 pending row
      // in first place would read as "worst monetizer" and mislead.
      if (a.pending && !b.pending) return 1;
      if (!a.pending && b.pending) return -1;
      return b.playbackBasedCpm - a.playbackBasedCpm;
    });
}
