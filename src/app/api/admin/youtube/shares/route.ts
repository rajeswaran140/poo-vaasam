/**
 * GET /api/admin/youtube/shares?days=90&topN=20
 *
 * Per-song share leaderboard: the top songs by views over the window, each with
 * its `shares` count (native YouTube Share button) and a shares-per-1k-views
 * rate. Admin-gated. 503 when the Analytics OAuth env vars aren't set.
 *
 * Shares are read per-video (a top-videos-by-shares report isn't API-supported),
 * so `topN` bounds the number of upstream calls.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { isYouTubeAnalyticsConfigured } from '@/lib/youtube-analytics';
import { fetchShareLeaderboard } from '@/lib/song-shares';

export const dynamic = 'force-dynamic';

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
  const daysRaw = Number(params.get('days') ?? '90');
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(365, daysRaw)) : 90;
  const topRaw = Number(params.get('topN') ?? '20');
  const topN = Number.isFinite(topRaw) ? Math.max(1, Math.min(50, topRaw)) : 20;

  const res = await fetchShareLeaderboard(days, topN);
  if (!res.ok) {
    return NextResponse.json({ success: false, error: res.error }, { status: 502 });
  }
  return NextResponse.json({ success: true, rows: res.data, days });
}
