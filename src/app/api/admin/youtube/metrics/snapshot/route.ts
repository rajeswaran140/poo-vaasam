/**
 * POST /api/admin/youtube/metrics/snapshot?days=N
 *
 * Captures + persists the channel's daily metrics (views / watch-time / subs)
 * into the longitudinal history the statistical analytics layer reads. Idempotent
 * upsert, so re-running re-finalizes YouTube's still-settling recent days.
 *
 * `days` doubles as backfill: a small value (daily cron) re-finalizes recent
 * days; a large value (a one-time admin call) seeds months of history at once.
 *
 * Auth: an admin session OR the shared `x-cron-secret` header (== CRON_SECRET),
 * mirroring the search-terms snapshot so the daily job can run without a session.
 * If CRON_SECRET is unset, only admins can call it (safe default).
 *
 * 503 when Analytics OAuth isn't configured; 502 on an upstream Analytics error.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { isYouTubeAnalyticsConfigured } from '@/lib/youtube-analytics';
import { captureChannelMetrics } from '@/lib/youtube-metrics-history';

export const dynamic = 'force-dynamic';

function cronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get('x-cron-secret') === secret);
}

export async function POST(request: NextRequest) {
  if (!cronAuthorized(request)) {
    try {
      await requireAdmin(request);
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

  const daysRaw = Number(request.nextUrl.searchParams.get('days') ?? '3');
  const daysBack = Number.isFinite(daysRaw) ? Math.max(1, Math.min(400, daysRaw)) : 3;

  const res = await captureChannelMetrics({ daysBack });
  if (!res.ok) {
    return NextResponse.json({ success: false, error: res.error }, { status: 502 });
  }
  return NextResponse.json({ success: true, snapshot: res.data });
}
