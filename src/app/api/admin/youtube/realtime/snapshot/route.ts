/**
 * POST /api/admin/youtube/realtime/snapshot
 *
 * Captures ONE reading of the public channel counters into `YTSNAP#CHANNEL`.
 * Driven by a 5-minute external cron (Amplify SSR has no in-process scheduler),
 * authorised the same way as the metrics snapshot: a shared `x-cron-secret`, or
 * an admin bearer token for a manual call.
 *
 * These snapshots are the ONLY source for the "views last 48 hours" tile —
 * there is no public realtime API — so the cadence is the resolution of that
 * number. See lib/youtube-realtime for how gaps and counter resets are handled.
 *
 * IDEMPOTENCE: a double-fired or retried cron simply writes a second row a few
 * seconds later. That is harmless (the newest row wins the "latest" query and
 * the anchor pick takes the nearest), so the route is safe to call twice — it
 * costs one extra Data API unit, nothing more.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { fetchChannelStats, isYouTubeApiConfigured } from '@/lib/youtube-api';
import { SITE } from '@/config/site';
import { recordChannelSnapshot } from '@/lib/youtube-realtime';
import { consumeQuota, QUOTA_COST } from '@/lib/youtube-quota';

export const dynamic = 'force-dynamic';

function cronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get('x-cron-secret') === secret);
}

export async function POST(request: NextRequest) {
  if (!cronAuthorized(request)) {
    try {
      await requireAdmin(request);
      requireBearer(request);
    } catch (err) {
      return authErrorResponse(err);
    }
  }

  if (!isYouTubeApiConfigured()) {
    return NextResponse.json(
      { success: false, error: 'YOUTUBE_API_KEY not configured' },
      { status: 503 }
    );
  }

  // Charge the Data API budget BEFORE calling Google, so a runaway retry loop
  // is stopped by our own ledger rather than by Google's 403.
  const quota = await consumeQuota(QUOTA_COST.channelsList, { surface: 'data' });
  if (quota.blocked) {
    return NextResponse.json(
      {
        success: false,
        error: 'YouTube Data API quota guard tripped — snapshot skipped',
        quota: { used: quota.used, limit: quota.limit, day: quota.day, degraded: quota.degraded },
      },
      { status: 429 }
    );
  }

  try {
    const stats = await fetchChannelStats(SITE.youtube.channelId);
    if (!stats) {
      return NextResponse.json(
        { success: false, error: 'channels.list returned no statistics' },
        { status: 502 }
      );
    }

    const snapshot = await recordChannelSnapshot({
      subscriberCount: Number(stats.subscriberCount ?? 0),
      viewCount: Number(stats.viewCount ?? 0),
      videoCount: Number(stats.videoCount ?? 0),
    });

    return NextResponse.json({
      success: true,
      snapshot,
      quota: { used: quota.used, limit: quota.limit, degraded: quota.degraded },
    });
  } catch (err) {
    console.error('[yt-realtime] snapshot capture failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'capture failed' },
      { status: 502 }
    );
  }
}
