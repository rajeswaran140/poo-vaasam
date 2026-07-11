/**
 * GET /api/admin/youtube/search-terms?videoId=ID&days=90
 *
 * The REAL YouTube-search queries that drove views — from the Analytics API
 * (owner-scoped, viewer truth), NOT the unpersonalized public `search.list`
 * ordering. `videoId` optional → channel-wide search terms.
 *
 * This is the automated "did search actually surface this, and for what terms"
 * signal. It intentionally does NOT report a "rank #1"-style position, because
 * the unpersonalized API disagrees with the personalized app (a video can be
 * #1 in the app yet absent from search.list). Position claims belong in the
 * manual observation log, not here.
 *
 * Admin-gated. 503 when the Analytics OAuth env vars aren't set; 400 on a bad
 * videoId. A brand-new / low-search video returns hasData:false (expected).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { fetchSearchTerms, isYouTubeAnalyticsConfigured } from '@/lib/youtube-analytics';
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
  const videoId = params.get('videoId')?.trim() || undefined;
  if (videoId && !isValidYouTubeId(videoId)) {
    return NextResponse.json({ success: false, error: 'invalid videoId' }, { status: 400 });
  }
  const daysRaw = Number(params.get('days') ?? '90');
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(365, daysRaw)) : 90;

  const res = await fetchSearchTerms(videoId, days);
  if (!res.ok) {
    return NextResponse.json({ success: false, error: res.error }, { status: 502 });
  }

  const totalSearchViews = res.data.reduce((sum, r) => sum + r.views, 0);
  return NextResponse.json({
    success: true,
    videoId: videoId ?? null,
    days,
    hasData: res.data.length > 0,
    totalSearchViews,
    terms: res.data,
  });
}
