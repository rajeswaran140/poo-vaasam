/**
 * /api/admin/youtube/recommendations — cached AI growth recommendations. Admin-gated.
 *
 *   GET   → the cached recs (or null)
 *   POST  → regenerate (one Anthropic call), cache, and return them
 *
 * The LLM call lives ONLY here, behind an explicit admin action, so it never
 * blocks a page/dashboard render (which can't reliably fit the Amplify ~30s
 * request ceiling — same constraint that moved compose off the request path).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import {
  fetchChannelAnalyticsSnapshot,
  fetchVideoAnalytics,
  isYouTubeAnalyticsConfigured,
} from '@/lib/youtube-analytics';
import { fetchChannelVideoStats, isYouTubeApiConfigured } from '@/lib/youtube-api';
import { generateYouTubeRecommendations } from '@/services/ai/youtube-recommendations';
import { YtRecsRepository } from '@/infrastructure/database/YtRecsRepository';
import { SITE } from '@/config/site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DAYS = 28;

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const cached = await new YtRecsRepository().get(SITE.youtube.channelId).catch(() => null);
  return NextResponse.json({ success: true, cached });
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    requireBearer(request); // mutation (paid LLM call) — reject cookie-only auth
  } catch (err) {
    return authErrorResponse(err);
  }

  if (!isYouTubeAnalyticsConfigured()) {
    return NextResponse.json(
      { success: false, error: 'YouTube Analytics OAuth not configured' },
      { status: 503 }
    );
  }

  const [channel, videos] = await Promise.all([
    fetchChannelAnalyticsSnapshot(DAYS),
    fetchVideoAnalytics(DAYS),
  ]);
  if (!channel.ok) return NextResponse.json({ success: false, error: channel.error }, { status: 502 });
  if (!videos.ok) return NextResponse.json({ success: false, error: videos.error }, { status: 502 });

  // Title lookup so recs can name songs instead of video IDs.
  let titles: Record<string, string> = {};
  if (isYouTubeApiConfigured()) {
    const vids = await fetchChannelVideoStats(SITE.youtube.channelId, 50);
    titles = Object.fromEntries(vids.map((v) => [v.id, v.title]));
  }

  const recs = await generateYouTubeRecommendations({ channel: channel.data, videos: videos.data, titles });
  if (!recs.ok) return NextResponse.json({ success: false, error: recs.error }, { status: 502 });

  const generatedAt = new Date().toISOString();
  try {
    await new YtRecsRepository().save(SITE.youtube.channelId, { recommendations: recs.data, generatedAt, days: DAYS });
  } catch (err) {
    console.error('[api/youtube/recommendations] cache save failed:', err instanceof Error ? err.message : String(err));
    // Still return the freshly generated recs even if caching failed.
  }

  return NextResponse.json({ success: true, recommendations: recs.data, generatedAt, days: DAYS });
}
