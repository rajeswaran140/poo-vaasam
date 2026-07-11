/**
 * GET /api/admin/youtube/video-daily?videoId=ID&days=28
 *
 * Per-song DAILY series — views / subscribers-gained / watch-minutes day by day
 * for one video, plus an at-a-glance summary (totals, best day, 7-vs-prior-7).
 * This is the intersection the dashboard was missing (it had per-song aggregate
 * and channel-wide daily, but not one song's day-by-day curve).
 *
 * Admin-gated. 503 when Analytics OAuth isn't set; 400 on a bad/missing videoId.
 * A brand-new upload returns a short/empty series (hasData:false) — expected.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { fetchVideoDailySeries, isYouTubeAnalyticsConfigured } from '@/lib/youtube-analytics';
import { summariseVideoDaily } from '@/lib/youtube-dashboard';
import { isValidYouTubeId } from '@/lib/youtube-api';

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

  const params = request.nextUrl.searchParams;
  const videoId = params.get('videoId')?.trim();
  if (!videoId) {
    return NextResponse.json({ success: false, error: 'videoId is required' }, { status: 400 });
  }
  if (!isValidYouTubeId(videoId)) {
    return NextResponse.json({ success: false, error: 'invalid videoId' }, { status: 400 });
  }
  const daysRaw = Number(params.get('days') ?? '28');
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(365, daysRaw)) : 28;

  const res = await fetchVideoDailySeries(videoId, days);
  if (!res.ok) {
    return NextResponse.json({ success: false, error: res.error }, { status: 502 });
  }

  return NextResponse.json({
    success: true,
    videoId,
    days,
    hasData: res.data.length > 0,
    summary: summariseVideoDaily(res.data),
    rows: res.data,
  });
}
