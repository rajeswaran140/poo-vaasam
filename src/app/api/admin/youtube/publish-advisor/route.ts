/**
 * GET /api/admin/youtube/publish-advisor
 *
 * "Should I upload now?" as one deterministic answer. Fetches the daily series +
 * channel stats + catalogue + per-video analytics, then hands them to the pure
 * buildPublishAdvice() — the SAME derivation the dashboard page runs server-side
 * (so a refresh here and the initial dashboard render agree, and the page can
 * pass its already-fetched data instead of re-fetching). No LLM.
 *
 * Admin-gated. Needs YouTube Analytics (the daily series is the core input) →
 * 503 when off. Channel stats / catalogue / per-video analytics are best-effort
 * (subs-to-Tier-2, long-form recency, long-form retention degrade to omitted).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { SITE } from '@/config/site';
import { fetchChannelStats, fetchChannelVideoStats, isYouTubeApiConfigured } from '@/lib/youtube-api';
import { isYouTubeAnalyticsConfigured, fetchDailySeries, fetchVideoAnalytics } from '@/lib/youtube-analytics';
import { buildPublishAdvice } from '@/lib/youtube-publish-advisor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SERIES_DAYS = 28;
const RETENTION_VIDEOS = 100; // catalogue span for the long-form retention read

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  if (!isYouTubeAnalyticsConfigured()) {
    return NextResponse.json(
      { success: false, error: 'YouTube Analytics OAuth not configured' },
      { status: 503 }
    );
  }

  const dailyRes = await fetchDailySeries(SERIES_DAYS);
  if (!dailyRes.ok) {
    return NextResponse.json({ success: false, error: dailyRes.error }, { status: 502 });
  }

  const asOf = new Date().toISOString().slice(0, 10);
  let channel: { subscriberCount: number } | null = null;
  let videos: Awaited<ReturnType<typeof fetchChannelVideoStats>> = [];
  let videoAnalytics: Array<{ videoId: string; views: number; averageViewDuration: number }> | null = null;
  if (isYouTubeApiConfigured()) {
    const channelId = SITE.youtube.channelId;
    const [c, v, vaRes] = await Promise.all([
      fetchChannelStats(channelId).catch(() => null),
      fetchChannelVideoStats(channelId, RETENTION_VIDEOS).catch(() => []),
      fetchVideoAnalytics(SERIES_DAYS).catch(() => ({ ok: false as const, error: 'unavailable' })),
    ]);
    channel = c;
    videos = v;
    videoAnalytics = vaRes.ok ? vaRes.data : null;
  }

  const bundle = buildPublishAdvice({ asOf, series: dailyRes.data, channel, videos, videoAnalytics });
  return NextResponse.json({ success: true, asOf, ...bundle });
}
