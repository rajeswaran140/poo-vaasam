/**
 * GET /api/admin/youtube/search-terms/trend?videoId=ID&days=28
 *
 * The live search terms for a scope (channel-wide by default) diffed against the
 * most-recent stored snapshot → per-term views + rank deltas (movement since the
 * last daily capture). Admin-gated.
 *
 * Ranks here are OUR observed Analytics ordering, never a search.list rank.
 * `comparedTo` is the date of the snapshot the deltas are measured against
 * (null before the first snapshot exists — then every term shows as new).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { fetchSearchTerms, isYouTubeAnalyticsConfigured } from '@/lib/youtube-analytics';
import { readRecentSnapshots, computeSearchTermsTrend } from '@/lib/search-terms-store';
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
  const scope = videoId ?? 'CHANNEL';
  const daysRaw = Number(params.get('days') ?? '28');
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(365, daysRaw)) : 28;

  const live = await fetchSearchTerms(videoId, days);
  if (!live.ok) {
    return NextResponse.json({ success: false, error: live.error }, { status: 502 });
  }
  const [previous] = await readRecentSnapshots(scope, 1);
  const terms = computeSearchTermsTrend(live.data, previous ?? null);

  return NextResponse.json({
    success: true,
    scope,
    days,
    hasData: terms.length > 0,
    comparedTo: previous?.date ?? null,
    terms,
  });
}
