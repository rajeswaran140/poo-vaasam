/**
 * GET /api/admin/youtube/publish-advisor
 *
 * "Should I upload now?" as one deterministic answer. Composes the reach trend,
 * retention health, subscriber momentum, and last-upload recency (all from the
 * daily Analytics series + channel stats) with the Friday→India-weekend timing
 * heuristic, via the pure lib/youtube-publish-advisor. No LLM — the verdict,
 * confidence, and reasons are all deterministic.
 *
 * Admin-gated. Needs YouTube Analytics (the daily series is the core input) →
 * 503 when it's off. Channel stats (subs-to-Tier-2) and last-upload recency are
 * best-effort enrichment. The lagging final day is dropped and only finalized
 * days feed the read (recent days blank/settle, which is NOT a real decline).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { SITE } from '@/config/site';
import { fetchChannelStats, fetchChannelVideoStats, isYouTubeApiConfigured } from '@/lib/youtube-api';
import { isYouTubeAnalyticsConfigured, fetchDailySeries } from '@/lib/youtube-analytics';
import { assessChange, type SeriesPoint } from '@/lib/youtube-forecast';
import { ageInDays } from '@/lib/youtube-outliers';
import { advisePublish } from '@/lib/youtube-publish-advisor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SERIES_DAYS = 28;
const TIER2_SUBS = 1000;

const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);
const meanOrNull = (xs: number[]): number | null => (xs.length ? mean(xs) : null);

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  if (!isYouTubeAnalyticsConfigured()) {
    return NextResponse.json(
      { success: false, error: 'YouTube Analytics OAuth not configured' },
      { status: 503 }
    );
  }

  const dailyRes = await fetchDailySeries(SERIES_DAYS);
  if (!dailyRes.ok) {
    return NextResponse.json({ success: false, error: dailyRes.error }, { status: 502 });
  }

  // Drop the lagging final day; recent days settle and would read as a false dip.
  const series = dailyRes.data;
  const finalized = series.length > 1 ? series.slice(0, -1) : series;
  const caveats: string[] = [];
  if (finalized.length < 8) {
    caveats.push('Fewer than 8 finalized days of history — treat the read as tentative.');
  }

  const recentN = Math.min(7, Math.max(1, Math.floor(finalized.length / 2)));
  const recent = finalized.slice(-recentN);
  const prior = finalized.slice(-2 * recentN, -recentN);

  const recentViewsPerDay = mean(recent.map((d) => d.views));
  const netSubsPerDay = mean(recent.map((d) => d.subscribersGained - (d.subscribersLost ?? 0)));
  const topRetention = meanOrNull(
    recent.map((d) => d.averageViewPercentage).filter((v): v is number => v != null)
  );
  const priorTopRetention = meanOrNull(
    prior.map((d) => d.averageViewPercentage).filter((v): v is number => v != null)
  );

  const points: SeriesPoint[] = finalized.map((d) => ({
    date: d.date,
    views: d.views,
    netSubscribers: d.subscribersGained,
  }));
  const viewsChange = assessChange(points, { metric: 'views', recentDays: recentN, priorDays: recentN });
  const viewsDeclining = viewsChange?.significant === true && viewsChange.direction === 'down';

  // Best-effort enrichment: subs-to-Tier-2 + last-upload recency (needs Data API).
  const asOf = new Date().toISOString().slice(0, 10);
  let subsToTier2: number | null = null;
  let daysSinceLastUpload: number | null = null;
  if (isYouTubeApiConfigured()) {
    const channelId = SITE.youtube.channelId;
    const [channel, videos] = await Promise.all([
      fetchChannelStats(channelId).catch(() => null),
      fetchChannelVideoStats(channelId, 3).catch(() => []),
    ]);
    if (channel && channel.subscriberCount < TIER2_SUBS) {
      subsToTier2 = TIER2_SUBS - channel.subscriberCount;
    }
    const latest = videos.find((v) => v.publishedAt);
    if (latest) daysSinceLastUpload = ageInDays(latest.publishedAt, asOf);
  }
  if (subsToTier2 === null && daysSinceLastUpload === null) {
    caveats.push('YouTube Data API unavailable — subs-to-Tier-2 and last-upload recency were omitted.');
  }
  caveats.push(
    'Suggested-vs-prior reach breakdown is not wired in yet — the reach signal comes from the finalized daily-views trend.'
  );

  const advice = advisePublish({
    asOf,
    recentViewsPerDay,
    viewsDeclining,
    topRetention,
    priorTopRetention,
    netSubsPerDay,
    subsToTier2,
    daysSinceLastUpload,
  });

  return NextResponse.json({
    success: true,
    asOf,
    advice,
    inputs: {
      recentViewsPerDay: Math.round(recentViewsPerDay),
      viewsDeclining,
      recentRetention: topRetention,
      priorRetention: priorTopRetention,
      netSubsPerDay: Math.round(netSubsPerDay),
      subsToTier2,
      daysSinceLastUpload,
      finalizedDays: finalized.length,
    },
    caveats,
  });
}
