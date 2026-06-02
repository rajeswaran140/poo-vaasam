/**
 * Public YouTube videos feed for the site.
 *
 * GET /api/youtube/videos — latest channel uploads (from the RSS feed) plus the
 * channel + one-click subscribe URLs. No auth (public promo content); cached.
 */

import { NextResponse } from 'next/server';
import { fetchChannelVideos } from '@/lib/youtube-feed';
import { SITE, isYouTubeVideosConfigured, youtubeSubscribeUrl } from '@/config/site';

// Dynamic for the same reason as /videos: Amplify doesn't run ISR revalidation,
// so a cached route response would freeze at build. Freshness comes from the
// in-process feed cache in youtube-feed.ts.
export const dynamic = 'force-dynamic';

export async function GET() {
  const configured = isYouTubeVideosConfigured();
  const videos = configured ? await fetchChannelVideos(SITE.youtube.channelId, 12) : [];

  return NextResponse.json({
    success: true,
    data: {
      configured,
      videos,
      channelUrl: SITE.youtube.channelUrl,
      subscribeUrl: youtubeSubscribeUrl(),
    },
  });
}
