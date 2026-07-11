/**
 * Top-10 song monitor — the four-metric decision tree across your top songs.
 *
 * GET  ?days=7  → top songs by recent views, each with views + watch-time
 *                 deltas (recent window vs prior), any logged impressions/CTR,
 *                 and a diagnosis (distribution / ctr / satisfaction / stable).
 * POST { videoId, impressions, ctr }  → log the Studio-only impressions + CTR
 *                 (the two metrics the Analytics API can't return).
 *
 * Admin-gated. 503 when Analytics OAuth isn't set.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { fetchTopSongMonitor, logImpressions } from '@/lib/top-song-monitor';
import { isYouTubeAnalyticsConfigured } from '@/lib/youtube-analytics';
import { isValidYouTubeId } from '@/lib/youtube-api';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  if (!isYouTubeAnalyticsConfigured()) {
    return NextResponse.json({ success: false, error: 'YOUTUBE_OAUTH_* env vars not configured' }, { status: 503 });
  }
  const daysRaw = Number(request.nextUrl.searchParams.get('days') ?? '7');
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(90, daysRaw)) : 7;

  const res = await fetchTopSongMonitor(days);
  if (!res.ok) {
    return NextResponse.json({ success: false, error: res.error }, { status: 502 });
  }
  return NextResponse.json({ success: true, days, rows: res.data });
}

const impressionSchema = z.object({
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  impressions: z.number().int().nonnegative(),
  ctr: z.number().min(0).max(100),
});

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  let input: z.infer<typeof impressionSchema>;
  try {
    input = impressionSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { success: false, error: 'Invalid impressions entry', details: err instanceof z.ZodError ? err.issues : undefined },
      { status: 400 }
    );
  }
  if (!isValidYouTubeId(input.videoId)) {
    return NextResponse.json({ success: false, error: 'invalid videoId' }, { status: 400 });
  }
  await logImpressions({ ...input, checkedAt: new Date().toISOString() });
  return NextResponse.json({ success: true });
}
