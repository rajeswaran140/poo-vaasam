/**
 * GET /api/admin/youtube/revenue-geography?videoId=ID&days=28
 *
 * Owner-scoped REVENUE by country for one video, plus the derived value
 * signals: per-country RPM, each country's revenue share against its view
 * share (`valueIndex`), and the video's RPM indexed against the channel's RPM
 * over the same window (`rpmIndex`).
 *
 * The question it answers is "which songs reach the audience that is actually
 * worth something", which per-country VIEWS cannot answer — see
 * lib/youtube-revenue-geography for the three derivation rules.
 *
 * Admin-gated. 503 when Analytics OAuth isn't configured. Note the monetary
 * scope: if the refresh token was minted without
 * `yt-analytics-monetary.readonly` the upstream call 403s, which surfaces here
 * as a 502 with the upstream message rather than as silent zeros — zeros would
 * read as "this song earns nothing", which is a different and wrong answer.
 *
 * The channel baseline is fetched alongside and is NON-FATAL: if it fails, the
 * per-country breakdown still returns and `rpmIndex` is null.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import {
  fetchVideoRevenueGeography,
  fetchVideoRevenueTotals,
  fetchChannelRpm,
  isYouTubeAnalyticsConfigured,
} from '@/lib/youtube-analytics';
import { summarizeRevenueGeography } from '@/lib/youtube-revenue-geography';
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
  const daysRaw = Number(params.get('days') ?? '28');
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(365, daysRaw)) : 28;

  const [geo, totals, baseline] = await Promise.all([
    fetchVideoRevenueGeography(videoId, days),
    fetchVideoRevenueTotals(videoId, days),
    fetchChannelRpm(days),
  ]);

  if (!geo.ok) {
    return NextResponse.json({ success: false, error: geo.error }, { status: 502 });
  }

  const channelRpm = baseline.ok && baseline.data.rpm !== null ? baseline.data.rpm : undefined;
  // Non-fatal like the baseline: without it the summary reports its rates as
  // country-attributed rather than silently overstating them.
  const videoTotals = totals.ok ? totals.data : undefined;
  const summary = summarizeRevenueGeography(geo.data, { channelRpm, videoTotals });

  return NextResponse.json({
    success: true,
    videoId,
    days,
    hasData: summary.rows.length > 0,
    channelRpm: channelRpm ?? null,
    ...summary,
  });
}
