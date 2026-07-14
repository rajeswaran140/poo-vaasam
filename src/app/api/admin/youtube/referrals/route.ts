/**
 * GET /api/admin/youtube/referrals?days=28
 *
 * The WhatsApp REFERRAL COEFFICIENT — the return leg of the share loop.
 *
 * Everything else we report counts OUTBOUND share intent (our buttons, or
 * YouTube's native Share dialog). This is the only endpoint that answers whether
 * a share brought anyone BACK: WhatsApp-referred views per 1,000 channel views,
 * plus the full EXT_URL breakdown.
 *
 * Admin-gated. 503 when the Analytics OAuth env vars aren't set.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { isYouTubeAnalyticsConfigured } from '@/lib/youtube-analytics';
import { fetchReferralCoefficient } from '@/lib/whatsapp-referrals';

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

  const raw = Number(request.nextUrl.searchParams.get('days') ?? 28);
  const days = Number.isFinite(raw) ? Math.max(1, Math.min(365, Math.floor(raw))) : 28;

  const res = await fetchReferralCoefficient(days);
  if (!res.ok) {
    return NextResponse.json({ success: false, error: res.error }, { status: 502 });
  }

  return NextResponse.json({ success: true, ...res.data });
}
