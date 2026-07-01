/**
 * GET /api/admin/youtube/geography?videoId=ID&days=90
 *
 * Owner-scoped audience geography for one video: views / watch-time /
 * average-view-% by country, decorated with country names + flags and each
 * country's share of the geo-attributed views.
 *
 * Admin-gated. 503 when the Analytics OAuth env vars aren't set; 400 when no
 * videoId is given. A brand-new or very-low-view upload returns no rows
 * (hasData:false) — that's expected (YouTube's geography reporting threshold),
 * not an error.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { fetchVideoGeography, isYouTubeAnalyticsConfigured } from '@/lib/youtube-analytics';
import { summarizeGeography } from '@/lib/youtube-geography';
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
  const daysRaw = Number(params.get('days') ?? '90');
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(365, daysRaw)) : 90;

  const res = await fetchVideoGeography(videoId, days);
  if (!res.ok) {
    return NextResponse.json({ success: false, error: res.error }, { status: 502 });
  }

  const summary = summarizeGeography(res.data);
  return NextResponse.json({
    success: true,
    videoId,
    days,
    hasData: summary.rows.length > 0,
    ...summary,
  });
}
