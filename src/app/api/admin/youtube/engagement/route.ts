/**
 * GET /api/admin/youtube/engagement?days=28
 *
 * Aggregated engagement signals for the admin dashboard:
 *  - audio_play breakdown (top played songs by title)
 *  - youtube_open breakdown (YouTube outbound clicks by destination)
 *
 * Same auth + env-gate shape as /api/admin/youtube/ga4.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import {
  fetchAudioPlays,
  fetchYouTubeOpens,
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

  const [audioPlays, youtubeOpens] = await Promise.all([
    fetchAudioPlays(days),
    fetchYouTubeOpens(days),
  ]);

  return NextResponse.json({ success: true, days, audioPlays, youtubeOpens });
}
