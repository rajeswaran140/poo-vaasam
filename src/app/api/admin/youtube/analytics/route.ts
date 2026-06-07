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
import { SITE } from '@/config/site';
import { YtRecsRepository } from '@/infrastructure/database/YtRecsRepository';

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

  // Recommendations are READ FROM THE CACHE (regenerated only via
  // POST /api/admin/youtube/recommendations) — the LLM never runs in this route,
  // so it can't blow the Amplify request ceiling.
  let recommendations: { ok: true; data: string[] } | null = null;
  if (wantRecs) {
    const cached = await new YtRecsRepository().get(SITE.youtube.channelId).catch(() => null);
    if (cached) recommendations = { ok: true, data: cached.recommendations };
  }

  return NextResponse.json({
    success: true,
    days,
    channel,
    videos,
    recommendations,
  });
}
