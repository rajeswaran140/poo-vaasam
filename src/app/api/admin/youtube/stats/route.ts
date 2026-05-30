/**
 * GET /api/admin/youtube/stats
 *
 * Channel snapshot + per-video stats for the admin dashboard. Admin-gated;
 * caches the upstream YouTube API call for 1 hour (see lib/youtube-api).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { SITE } from '@/config/site';
import {
  fetchChannelStats,
  fetchChannelVideoStats,
  isYouTubeApiConfigured,
} from '@/lib/youtube-api';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  if (!isYouTubeApiConfigured()) {
    return NextResponse.json(
      { success: false, error: 'YOUTUBE_API_KEY not configured' },
      { status: 503 }
    );
  }

  const channelId = SITE.youtube.channelId;
  const [channel, videos] = await Promise.all([
    fetchChannelStats(channelId),
    fetchChannelVideoStats(channelId, 50),
  ]);

  if (!channel) {
    return NextResponse.json(
      { success: false, error: 'Channel not found or API error' },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true, channel, videos });
}
