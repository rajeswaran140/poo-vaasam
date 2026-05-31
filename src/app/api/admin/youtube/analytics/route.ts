/**
 * GET /api/admin/youtube/analytics?days=28
 *
 * Owner-scoped YouTube Analytics + AI recommendations. Admin-gated.
 * 503 when OAuth env vars aren't set so the dashboard banner can guide
 * the one-time setup.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import {
  fetchChannelAnalyticsSnapshot,
  fetchVideoAnalytics,
  isYouTubeAnalyticsConfigured,
} from '@/lib/youtube-analytics';
import { fetchChannelVideoStats, isYouTubeApiConfigured } from '@/lib/youtube-api';
import { SITE } from '@/config/site';
import { generateYouTubeRecommendations } from '@/services/ai/youtube-recommendations';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  if (!isYouTubeAnalyticsConfigured()) {
    return NextResponse.json(
      { success: false, error: 'YOUTUBE_OAUTH_* env vars not configured' },
      { status: 503 }
    );
  }

  const daysParam = Number(request.nextUrl.searchParams.get('days') ?? '28');
  const days = Number.isFinite(daysParam) ? Math.max(1, Math.min(90, daysParam)) : 28;
  const wantRecs = request.nextUrl.searchParams.get('recs') !== '0';

  const [channel, videos] = await Promise.all([
    fetchChannelAnalyticsSnapshot(days),
    fetchVideoAnalytics(days),
  ]);

  // Look up titles via the public Data API (already wired in Phase 1) so AI
  // recommendations can name songs instead of just video IDs.
  let titles: Record<string, string> = {};
  if (wantRecs && channel.ok && videos.ok && isYouTubeApiConfigured()) {
    const vids = await fetchChannelVideoStats(SITE.youtube.channelId, 50);
    titles = Object.fromEntries(vids.map((v) => [v.id, v.title]));
  }

  // AI recs are best-effort — failure here shouldn't 500 the whole route.
  let recommendations: { ok: true; data: string[] } | { ok: false; error: string } | null = null;
  if (wantRecs && channel.ok && videos.ok) {
    recommendations = await generateYouTubeRecommendations({
      channel: channel.data,
      videos: videos.data,
      titles,
    });
  }

  return NextResponse.json({
    success: true,
    days,
    channel,
    videos,
    recommendations,
  });
}
