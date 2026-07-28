/**
 * GET /api/admin/youtube/realtime
 *
 * The two "realtime" tiles: an approximate subscriber count and views over the
 * last ~48h, both derived from our own YTSNAP#CHANNEL snapshots because Studio's
 * Realtime card has no public API (see lib/youtube-realtime for the rationale
 * and the gap/clamp handling).
 *
 * Reads only — never calls Google, so it is cheap enough for the panel's 60s
 * poll and costs no quota. The snapshot cron is the only thing that spends.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { loadRealtime } from '@/lib/youtube-realtime';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  try {
    const reading = await loadRealtime();
    return NextResponse.json(reading, {
      headers: { 'Cache-Control': 'private, max-age=30' },
    });
  } catch (err) {
    console.error('[yt-realtime] read failed:', err);
    return NextResponse.json(
      {
        error: {
          code: 'YT_REALTIME_UNAVAILABLE',
          message: err instanceof Error ? err.message : 'realtime read failed',
          staleDataAvailable: false,
        },
      },
      { status: 503 }
    );
  }
}
