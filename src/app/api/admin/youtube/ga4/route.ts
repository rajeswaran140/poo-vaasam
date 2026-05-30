/**
 * GET /api/admin/youtube/ga4?days=28
 *
 * Returns GA4-derived signals for the YouTube admin dashboard:
 *  - subscribe_click counts broken down by `source` (which CTA converts)
 *  - basic traffic snapshot (users/sessions/pageViews) over the same window
 *
 * 503 when GA4 env vars aren't set; the dashboard renders a config banner
 * in that case so the rest of the page still works.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import {
  fetchSubscribeClicksBySource,
  fetchTrafficSnapshot,
  isGA4Configured,
} from '@/lib/ga4-api';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  if (!isGA4Configured()) {
    return NextResponse.json(
      { success: false, error: 'GA4_PROPERTY_ID / GA4_SERVICE_ACCOUNT_KEY not configured' },
      { status: 503 }
    );
  }

  const daysParam = Number(request.nextUrl.searchParams.get('days') ?? '28');
  const days = Number.isFinite(daysParam) ? Math.max(1, Math.min(90, daysParam)) : 28;

  const [subscribeClicks, traffic] = await Promise.all([
    fetchSubscribeClicksBySource(days),
    fetchTrafficSnapshot(days),
  ]);

  return NextResponse.json({ success: true, days, subscribeClicks, traffic });
}
