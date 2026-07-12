/**
 * Song share leaderboard — per-song `shares` (native YouTube Share button)
 * ranked, with a shares-per-1k-views RATE. The rate is the WhatsApp-strategy
 * signal: which songs get shared out of proportion to their views (i.e. are
 * genuinely share-worthy), independent of how much reach they got.
 *
 * A top-videos-by-shares report isn't supported by the Analytics API, so we take
 * the top songs by views and read each one's shares via a `video==` filter.
 */

import { fetchVideoAnalytics, fetchVideoShares, isYouTubeAnalyticsConfigured, type Result } from '@/lib/youtube-analytics';

export interface ShareRow {
  videoId: string;
  title: string;
  views: number;
  shares: number;
  sharesPer1k: number; // shares per 1,000 views (1 dp) — the share-worthiness rate
}

/** Pure: join per-song views + shares + titles → rows ranked by absolute shares. */
export function buildShareLeaderboard(
  videos: Array<{ videoId: string; views: number }>,
  shares: Map<string, number>,
  titles: Map<string, string>
): ShareRow[] {
  return videos
    .map((v) => {
      const s = shares.get(v.videoId) ?? 0;
      return {
        videoId: v.videoId,
        title: titles.get(v.videoId) ?? v.videoId,
        views: v.views,
        shares: s,
        sharesPer1k: v.views > 0 ? Math.round((s / v.views) * 1000 * 10) / 10 : 0,
      };
    })
    .sort((a, b) => b.shares - a.shares);
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
 * Top `topN` songs by views over the window, each decorated with its share count
 * and share rate. Shares are fetched per-video in parallel (bounded by topN).
 */
export async function fetchShareLeaderboard(daysBack = 90, topN = 20): Promise<Result<ShareRow[]>> {
  if (!isYouTubeAnalyticsConfigured()) {
    return { ok: false, error: 'YouTube Analytics OAuth not configured' };
  }
  const va = await fetchVideoAnalytics(daysBack);
  if (!va.ok) return va;

  const top = [...va.data].sort((a, b) => b.views - a.views).slice(0, topN);
  const ids = top.map((v) => v.videoId);

  const shareResults = await Promise.all(ids.map((id) => fetchVideoShares(id, daysBack)));
  const shares = new Map<string, number>();
  ids.forEach((id, i) => {
    const r = shareResults[i];
    if (r.ok) shares.set(id, r.data);
  });

  const titles = await resolveTitles(ids);
  return { ok: true, data: buildShareLeaderboard(top.map((v) => ({ videoId: v.videoId, views: v.views })), shares, titles) };
}
