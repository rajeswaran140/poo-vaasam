/**
 * POST /api/admin/youtube/search-terms/snapshot?videoId=ID&days=28
 *
 * Captures + persists today's search-terms snapshot for a scope (channel-wide
 * by default) so the dashboard can show trend-over-time and per-term deltas.
 *
 * Auth: an admin session OR the shared `x-cron-secret` header (== CRON_SECRET),
 * so the daily scheduled job can trigger it without a Cognito session. If
 * CRON_SECRET is unset, only admins can call it (safe default).
 *
 * 503 when Analytics OAuth isn't configured; 400 on a bad videoId.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { captureSearchTermsSnapshot } from '@/lib/search-terms-store';
import { isYouTubeAnalyticsConfigured } from '@/lib/youtube-analytics';
import { isValidYouTubeId } from '@/lib/youtube-api';

export const dynamic = 'force-dynamic';

function cronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get('x-cron-secret') === secret);
}

export async function POST(request: NextRequest) {
  if (!cronAuthorized(request)) {
    try {
      await requireAdmin(request);
      // Defense-in-depth CSRF: reject cookie-only auth on this mutation
      // (matches the pattern on the other admin mutation routes).
      requireBearer(request);
    } catch (err) {
      return authErrorResponse(err);
    }
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
  const daysRaw = Number(params.get('days') ?? '28');
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(365, daysRaw)) : 28;

  const res = await captureSearchTermsSnapshot({ videoId, days });
  if (!res.ok) {
    return NextResponse.json({ success: false, error: res.error }, { status: 502 });
  }
  return NextResponse.json({
    success: true,
    snapshot: { scope: res.data.scope, date: res.data.date, termCount: res.data.terms.length },
  });
}
