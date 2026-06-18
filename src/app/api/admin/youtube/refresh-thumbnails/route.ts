/**
 * POST /api/admin/youtube/refresh-thumbnails
 *
 * Re-mirrors the channel's video thumbnails from YouTube, OVERWRITING the S3
 * copies (the normal mirror is once-only). Use after changing a thumbnail on
 * YouTube (e.g. to a Tamil custom thumbnail) so /videos reflects it. The short
 * Cache-Control on the re-uploaded objects means CloudFront serves the new
 * image within minutes. Admin-gated, force-dynamic.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { fetchChannelVideos } from '@/lib/youtube-feed';
import { refreshThumbnails } from '@/lib/video-thumbnails';
import { SITE } from '@/config/site';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  try {
    const videos = await fetchChannelVideos(SITE.youtube.channelId, 50);
    if (videos.length === 0) {
      return NextResponse.json({ success: true, refreshed: [], failed: [], total: 0 });
    }
    const { refreshed, failed } = await refreshThumbnails(videos.map((v) => v.id));
    return NextResponse.json({
      success: true,
      refreshed: refreshed.length,
      failed: failed.length,
      total: videos.length,
    });
  } catch (err) {
    console.error('[refresh-thumbnails] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to refresh thumbnails' }, { status: 500 });
  }
}
