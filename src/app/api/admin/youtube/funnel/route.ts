/**
 * GET /api/admin/youtube/funnel?days=28
 *
 * The Viewer Conversion Funnel — DISCOVERED → WATCHED → WATCHED_2ND_SONG →
 * RETURNED → SUBSCRIBED — modelled at cohort/aggregate level from owner-scoped
 * YouTube Analytics (views, traffic-source, playlist, subscriber metrics).
 *
 * Admin-gated. 503 when the Analytics OAuth env vars aren't set; 502 on an
 * upstream Analytics failure. The network fetch (fetchFunnelData) assembles the
 * raw reports; the pure, unit-tested computeFunnel() builds the model.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { fetchFunnelData, isYouTubeAnalyticsConfigured } from '@/lib/youtube-analytics';
import { computeFunnel } from '@/lib/youtube-funnel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_DAYS = [7, 28, 90] as const;

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

  // Snap to a small set of cohort windows so callers can't request odd ranges.
  const daysRaw = Number(request.nextUrl.searchParams.get('days') ?? '28');
  const days = (ALLOWED_DAYS as readonly number[]).includes(daysRaw) ? daysRaw : 28;

  const res = await fetchFunnelData(days);
  if (!res.ok) {
    return NextResponse.json({ success: false, error: res.error }, { status: 502 });
  }

  const report = computeFunnel(res.data);
  // report already carries `days` (echoes the fetched window).
  return NextResponse.json({ success: true, ...report });
}
