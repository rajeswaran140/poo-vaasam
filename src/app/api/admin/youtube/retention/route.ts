/**
 * GET /api/admin/youtube/retention?videoId=ID&benchmarkId=ID&duration=SEC&days=90
 *
 * Owner-scoped retention intelligence for one video: its per-second retention
 * curve, key checkpoint holds, and a hook verdict ('strong' | 'average' |
 * 'weak' | 'unknown') anchored on the 10% checkpoint vs an optional benchmark
 * video (typically the channel's best-retention template).
 *
 * Admin-gated. 503 when the Analytics OAuth env vars aren't set; 400 when no
 * videoId is given. A brand-new upload (no finalized data) returns an empty
 * curve and an 'unknown' verdict — that's expected, not an error.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { fetchRetentionCurve, isYouTubeAnalyticsConfigured } from '@/lib/youtube-analytics';
import { analyzeRetention, parseRetentionRows } from '@/lib/youtube-retention';
import { isValidYouTubeId } from '@/lib/youtube-api';

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

  const params = request.nextUrl.searchParams;
  const videoId = params.get('videoId')?.trim();
  if (!videoId) {
    return NextResponse.json({ success: false, error: 'videoId is required' }, { status: 400 });
  }
  if (!isValidYouTubeId(videoId)) {
    return NextResponse.json({ success: false, error: 'invalid videoId' }, { status: 400 });
  }
  const benchmarkRaw = params.get('benchmarkId')?.trim() || null;
  // Ignore a malformed benchmark rather than 400 — it's an optional comparison.
  const benchmarkId = benchmarkRaw && isValidYouTubeId(benchmarkRaw) ? benchmarkRaw : null;
  const durationRaw = Number(params.get('duration'));
  const durationSeconds = Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : undefined;
  const daysRaw = Number(params.get('days') ?? '90');
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(365, daysRaw)) : 90;

  // Fetch the video curve and (if distinct) the benchmark curve in parallel.
  const wantBenchmark = !!benchmarkId && benchmarkId !== videoId;
  const [videoRes, benchRes] = await Promise.all([
    fetchRetentionCurve(videoId, days),
    wantBenchmark ? fetchRetentionCurve(benchmarkId!, days) : Promise.resolve(null),
  ]);

  if (!videoRes.ok) {
    return NextResponse.json({ success: false, error: videoRes.error }, { status: 502 });
  }

  const curve = parseRetentionRows(videoRes.data);
  const benchmarkCurve =
    benchRes && benchRes.ok ? parseRetentionRows(benchRes.data) : undefined;
  const analysis = analyzeRetention(curve, { durationSeconds, benchmarkCurve });

  return NextResponse.json({
    success: true,
    videoId,
    days,
    hasData: curve.length > 0,
    benchmarkId: wantBenchmark ? benchmarkId : null,
    curve, // [{ratio, watchRatio}] for the UI sparkline
    ...analysis, // summary, verdict, checkpoint, holdAtCheckpoint, benchmarkHoldAtCheckpoint
  });
}
