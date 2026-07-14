/**
 * Song share leaderboard — per-song `shares` (YouTube's native Share button)
 * with a shares-per-1k-views RATE. The rate is the share-worthiness signal:
 * which songs get forwarded out of proportion to their reach.
 *
 * A top-videos-by-shares report isn't supported by the Analytics API, so we read
 * each candidate's shares via a `video==` filter — one call per song.
 *
 * Two defects fixed in the 2026-07-14 WhatsApp audit shape this module:
 *
 *   SELECTION BIAS. The candidate pool used to be "top N *by views*", and the UI
 *   then offered to rank that pool by RATE. A low-view/high-rate song — exactly
 *   the share-worthy outlier the rate exists to surface — was filtered out
 *   before its rate was ever computed. The pool is now selected by ELIGIBILITY
 *   (a min-views floor), and `topN` only trims the DISPLAY list afterwards.
 *
 *   SILENT ZERO. A failed per-video call fell through to `?? 0`, making an API
 *   error indistinguishable from "nobody shared it" and quietly ranking the song
 *   last. Unknown is now `null` — never 0 — and the failed ids are reported so
 *   the UI can say so.
 *
 * Note this counts YouTube-side shares only (their Share dialog); copy-paste
 * forwarding isn't captured, so it's a FLOOR. It is NOT the same thing as the
 * WhatsApp referral coefficient (`lib/whatsapp-referrals`), which measures views
 * coming BACK. Outbound intent vs. return traffic — don't conflate them.
 */

import { mapWithConcurrency } from '@/lib/concurrency';
import {
  fetchVideoAnalytics,
  fetchVideoShares,
  isYouTubeAnalyticsConfigured,
  type Result,
} from '@/lib/youtube-analytics';

export interface ShareRow {
  videoId: string;
  title: string;
  views: number;
  /** null = the upstream shares call failed. NOT zero — we do not know. */
  shares: number | null;
  /** null when `shares` is unknown. */
  sharesPer1k: number | null;
}

export interface ShareLeaderboard {
  /** Display rows, ranked by absolute shares (unknowns last), trimmed to topN. */
  rows: ShareRow[];
  /** How many songs cleared the floor and were actually measured. */
  candidatesConsidered: number;
  /** The min-views floor applied to the candidate pool. */
  minViews: number;
  /** Songs whose share count could not be read — surfaced rather than shown as 0. */
  failedVideoIds: string[];
}

export interface ShareLeaderboardOptions {
  /** Max rows returned for display. Does NOT restrict what gets measured. */
  topN?: number;
  /** Views floor for candidacy — keeps a 3-view song from faking a 333/1k rate. */
  minViews?: number;
  /** Hard cap on candidates, bounding the per-video API fan-out. */
  maxCandidates?: number;
  /** Parallel upstream calls. */
  concurrency?: number;
}

const DEFAULTS = {
  topN: 20,
  minViews: 100,
  maxCandidates: 60,
  concurrency: 5,
} as const;

/** Pure: join per-song views + shares + titles → rows ranked by absolute shares. */
export function buildShareLeaderboard(
  videos: Array<{ videoId: string; views: number }>,
  shares: Map<string, number | null>,
  titles: Map<string, string>
): ShareRow[] {
  return videos
    .map((v): ShareRow => {
      const s = shares.get(v.videoId) ?? null;
      return {
        videoId: v.videoId,
        title: titles.get(v.videoId) ?? v.videoId,
        views: v.views,
        shares: s,
        sharesPer1k: s === null ? null : v.views > 0 ? Math.round((s / v.views) * 1000 * 10) / 10 : 0,
      };
    })
    .sort((a, b) => {
      // Unknowns sort below genuine zeros — an API failure must never look like
      // the quietest song on the channel.
      if (a.shares === null && b.shares === null) return 0;
      if (a.shares === null) return 1;
      if (b.shares === null) return -1;
      return b.shares - a.shares;
    });
}

/** Resolve video titles via the Data API (best-effort; falls back to the id). */
async function resolveTitles(ids: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  const key = process.env.YOUTUBE_API_KEY;
  if (!key || ids.length === 0) return m;
  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${ids.slice(0, 50).join(',')}&key=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    if (!res.ok) return m;
    const json = (await res.json()) as { items?: Array<{ id: string; snippet: { title: string } }> };
    for (const it of json.items ?? []) m.set(it.id, it.snippet.title);
  } catch {
    /* title decoration is best-effort */
  }
  return m;
}

/**
 * Every song that clears `minViews` (capped at `maxCandidates`) is measured;
 * `topN` then trims the display list. Measuring the full eligible set — not just
 * the biggest songs — is what lets the RATE ranking surface a modest song people
 * actually forward.
 */
export async function fetchShareLeaderboard(
  daysBack = 90,
  options: ShareLeaderboardOptions = {}
): Promise<Result<ShareLeaderboard>> {
  const { topN, minViews, maxCandidates, concurrency } = { ...DEFAULTS, ...options };

  if (!isYouTubeAnalyticsConfigured()) {
    return { ok: false, error: 'YouTube Analytics OAuth not configured' };
  }
  const va = await fetchVideoAnalytics(daysBack);
  if (!va.ok) return va;

  // Candidacy is by ELIGIBILITY (views floor), not by view rank. maxCandidates
  // is only a fan-out guard; when it bites we keep the biggest songs, since a
  // song below the cut has too little reach for its rate to mean much anyway.
  const candidates = va.data
    .filter((v) => v.views >= minViews)
    .sort((a, b) => b.views - a.views)
    .slice(0, maxCandidates);

  if (candidates.length === 0) {
    return {
      ok: true,
      data: { rows: [], candidatesConsidered: 0, minViews, failedVideoIds: [] },
    };
  }

  const ids = candidates.map((v) => v.videoId);
  const results = await mapWithConcurrency(ids, concurrency, (id) => fetchVideoShares(id, daysBack));

  const shares = new Map<string, number | null>();
  const failedVideoIds: string[] = [];
  ids.forEach((id, i) => {
    const r = results[i]; // undefined = the call threw; mapWithConcurrency never rejects
    if (r && r.ok) {
      shares.set(id, r.data);
    } else {
      shares.set(id, null);
      failedVideoIds.push(id);
    }
  });

  const titles = await resolveTitles(ids);
  const rows = buildShareLeaderboard(
    candidates.map((v) => ({ videoId: v.videoId, views: v.views })),
    shares,
    titles
  );

  return {
    ok: true,
    data: {
      rows: rows.slice(0, topN),
      candidatesConsidered: candidates.length,
      minViews,
      failedVideoIds,
    },
  };
}
