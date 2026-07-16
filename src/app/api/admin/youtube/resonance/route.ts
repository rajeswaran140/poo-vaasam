/**
 * GET /api/admin/youtube/resonance?window=<days>&limit=<n>
 *
 * The RESONANCE lens on the catalogue — ranks songs by per-viewer ADVOCACY
 * (shares / likes / subscriber-conversion / comments per 1,000 views), NOT
 * reach. It surfaces the low-view-but-deeply-resonant songs (the motivation
 * lane) that the views-weighted Outlier Score buries. Same tested ranking
 * engine (rankOutliers) with the RESONANCE_WEIGHTS preset.
 *
 * Admin-gated. Needs the Data API (titles + Shorts filter) and YouTube
 * Analytics (the per-video engagement counts) → 503 when either is off. Shorts
 * are excluded. One bulk engagement report — no per-video loop.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { SITE } from '@/config/site';
import { fetchChannelVideoStats, isYouTubeApiConfigured } from '@/lib/youtube-api';
import { isYouTubeAnalyticsConfigured, fetchVideoEngagement } from '@/lib/youtube-analytics';
import { isShort } from '@/lib/youtube-shorts';
import { loadVideoThemeMap } from '@/lib/video-theme-map';
import { rankOutliers, summarizeByTheme, RESONANCE_WEIGHTS, type SongSignals } from '@/lib/youtube-outliers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_WINDOW = 90;
const MAX_WINDOW = 400;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

function clampInt(raw: string | null, def: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  if (!isYouTubeApiConfigured()) {
    return NextResponse.json({ success: false, error: 'YOUTUBE_API_KEY not configured' }, { status: 503 });
  }
  if (!isYouTubeAnalyticsConfigured()) {
    return NextResponse.json({ success: false, error: 'YouTube Analytics OAuth not configured' }, { status: 503 });
  }

  const params = request.nextUrl.searchParams;
  const window = clampInt(params.get('window'), DEFAULT_WINDOW, 1, MAX_WINDOW);
  const limit = clampInt(params.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);

  const engRes = await fetchVideoEngagement(window);
  if (!engRes.ok) {
    return NextResponse.json({ success: false, error: engRes.error }, { status: 502 });
  }

  const [videos, themeMap] = await Promise.all([
    fetchChannelVideoStats(SITE.youtube.channelId, limit).catch(() => []),
    loadVideoThemeMap(),
  ]);
  const meta = new Map(videos.map((v) => [v.id, v]));

  // Long-form songs only, per-1k advocacy signals from the bulk engagement report.
  const songs: SongSignals[] = [];
  let shortsExcluded = 0;
  for (const e of engRes.data) {
    const v = meta.get(e.videoId);
    if (!v) continue; // not in the catalogue window
    if (isShort(v)) {
      shortsExcluded++;
      continue;
    }
    const per1k = (n: number) => (e.views > 0 ? (n / e.views) * 1000 : 0);
    songs.push({
      videoId: e.videoId,
      title: v.title,
      theme: themeMap.get(e.videoId) ?? null,
      likesPer1k: per1k(e.likes),
      sharesPer1k: per1k(e.shares),
      subsPer1k: per1k(e.subscribersGained),
      engagement: per1k(e.comments),
    });
  }

  const ranked = rankOutliers(songs, { weights: RESONANCE_WEIGHTS, outlierThreshold: 1.5 });
  const themeSummary = summarizeByTheme(ranked, songs);
  const themesJoined = themeMap.size > 0;

  return NextResponse.json({
    success: true,
    window,
    themesJoined,
    channel: { ranked: ranked.length },
    songs: ranked,
    themeSummary,
    caveats: [
      'RESONANCE ranks by per-viewer advocacy (shares/likes/subs/comments per 1k views) — deliberately NOT by reach, so low-view songs that deeply resonate rank high.',
      `Shorts are excluded${shortsExcluded > 0 ? ` (${shortsExcluded} filtered out)` : ''}; long-form songs only.`,
      themesJoined ? 'Themes joined from the catalogue.' : 'Theme rollup unavailable — grouped under "(untagged)".',
    ],
  });
}
