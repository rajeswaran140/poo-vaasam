/**
 * GET /api/admin/youtube/shares?days=90&topN=20&minViews=100
 *
 * Per-song share leaderboard: every song that clears the `minViews` floor is
 * measured for `shares` (YouTube's native Share button) plus a shares-per-1k-views
 * rate; `topN` then trims the DISPLAY list. Admin-gated. 503 when the Analytics
 * OAuth env vars aren't set.
 *
 * `topN` deliberately does NOT bound what gets measured. Bounding the candidate
 * pool by view rank was the audit's selection-bias bug: it hid exactly the
 * low-reach/high-rate songs the rate metric exists to find. Fan-out is bounded
 * inside the lib by maxCandidates + concurrency instead.
 *
 * Songs whose share count couldn't be read come back as `shares: null` and are
 * listed in `failedVideoIds` — never silently reported as 0.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { isYouTubeAnalyticsConfigured } from '@/lib/youtube-analytics';
import { fetchShareLeaderboard } from '@/lib/song-shares';

export const dynamic = 'force-dynamic';

const clampInt = (raw: string | null, fallback: number, min: number, max: number): number => {
  // An absent OR empty param (`?topN=`) means "use the default" — Number('') is
  // 0, which would otherwise clamp to the minimum and silently gut the report.
  const s = raw?.trim();
  if (!s) return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback;
};

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
  const days = clampInt(params.get('days'), 90, 1, 365);
  const topN = clampInt(params.get('topN'), 20, 1, 50);
  const minViews = clampInt(params.get('minViews'), 100, 0, 100_000);

  const res = await fetchShareLeaderboard(days, { topN, minViews });
  if (!res.ok) {
    return NextResponse.json({ success: false, error: res.error }, { status: 502 });
  }

  return NextResponse.json({
    success: true,
    rows: res.data.rows,
    candidatesConsidered: res.data.candidatesConsidered,
    minViews: res.data.minViews,
    failedVideoIds: res.data.failedVideoIds,
    days,
  });
}
