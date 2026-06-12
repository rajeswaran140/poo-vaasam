/**
 * GET /api/admin/youtube/digest?days=28
 *
 * Weekly digest + anomaly signal for the channel: week-over-week growth, a
 * view-trend anomaly classification (distinguishes a real decline from a stall
 * that's usually counter-lag), and this week's top videos. Admin-gated; 503
 * when Analytics OAuth isn't configured. Powers both the dashboard card and a
 * scheduled alert job.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import {
  fetchDailySeries,
  fetchVideoAnalytics,
  isYouTubeAnalyticsConfigured,
} from '@/lib/youtube-analytics';
import { buildDigest } from '@/lib/youtube-digest';

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

  const daysRaw = Number(request.nextUrl.searchParams.get('days') ?? '28');
  const days = Number.isFinite(daysRaw) ? Math.max(14, Math.min(90, daysRaw)) : 28;

  const [seriesRes, videosRes] = await Promise.all([
    fetchDailySeries(days),
    fetchVideoAnalytics(7),
  ]);

  if (!seriesRes.ok) {
    return NextResponse.json({ success: false, error: seriesRes.error }, { status: 502 });
  }

  const weekVideos = videosRes.ok ? videosRes.data : [];
  const digest = buildDigest(seriesRes.data, weekVideos);

  return NextResponse.json({ success: true, days, ...digest });
}
