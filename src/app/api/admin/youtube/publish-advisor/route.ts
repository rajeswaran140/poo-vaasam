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
import { isYouTubeAnalyticsConfigured, fetchDailySeries, fetchVideoAnalytics } from '@/lib/youtube-analytics';
import { isShort } from '@/lib/youtube-shorts';
import { assessChange, type SeriesPoint } from '@/lib/youtube-forecast';
import { ageInDays } from '@/lib/youtube-outliers';
import { advisePublish, weightedRetention } from '@/lib/youtube-publish-advisor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SERIES_DAYS = 28;
const TIER2_SUBS = 1000;
const RETENTION_VIDEOS = 100; // catalogue span for the long-form retention read

const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);

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

  const recentViewsPerDay = mean(recent.map((d) => d.views));
  const netSubsPerDay = mean(recent.map((d) => d.subscribersGained - (d.subscribersLost ?? 0)));

  const points: SeriesPoint[] = finalized.map((d) => ({
    date: d.date,
    views: d.views,
    netSubscribers: d.subscribersGained,
  }));
  const viewsChange = assessChange(points, { metric: 'views', recentDays: recentN, priorDays: recentN });
  const viewsDeclining = viewsChange?.significant === true && viewsChange.direction === 'down';

  // Best-effort enrichment (needs Data API): subs-to-Tier-2, last-upload recency
  // (LONG-FORM only — a Short posted yesterday must not read as "just published"),
  // and a LONG-FORM, views-weighted retention (Shorts sit near 100% and would
  // otherwise mask a real long-form watch-time problem).
  const asOf = new Date().toISOString().slice(0, 10);
  let subsToTier2: number | null = null;
  let daysSinceLastUpload: number | null = null;
  let topRetention: number | null = null;
  if (isYouTubeApiConfigured()) {
    const channelId = SITE.youtube.channelId;
    const [channel, videos, vaRes] = await Promise.all([
      fetchChannelStats(channelId).catch(() => null),
      fetchChannelVideoStats(channelId, RETENTION_VIDEOS).catch(() => []),
      fetchVideoAnalytics(SERIES_DAYS).catch(() => ({ ok: false as const, error: 'unavailable' })),
    ]);
    if (channel && channel.subscriberCount < TIER2_SUBS) {
      subsToTier2 = TIER2_SUBS - channel.subscriberCount;
    }
    const latestLongForm = videos.find((v) => v.publishedAt && !isShort(v));
    if (latestLongForm) daysSinceLastUpload = ageInDays(latestLongForm.publishedAt, asOf);

    if (vaRes.ok) {
      const durationById = new Map(videos.map((v) => [v.id, v.durationSeconds]));
      const shortIds = new Set(videos.filter((v) => isShort(v)).map((v) => v.id));
      const rows = vaRes.data
        .filter((r) => !shortIds.has(r.videoId))
        .map((r) => ({ dur: durationById.get(r.videoId), avd: r.averageViewDuration, views: r.views }))
        .filter((x): x is { dur: number; avd: number; views: number } => x.dur != null && x.dur > 0)
        .map((x) => ({ retentionPct: (x.avd / x.dur) * 100, views: x.views }));
      topRetention = weightedRetention(rows);
    }
  }
  if (subsToTier2 === null && daysSinceLastUpload === null) {
    caveats.push('YouTube Data API unavailable — subs-to-Tier-2 and last-upload recency were omitted.');
  }
  caveats.push(
    'Retention is the views-weighted average of LONG-FORM songs only (Shorts excluded); a falling-retention trend isn’t wired in yet.'
  );
  caveats.push(
    'Suggested-vs-prior reach breakdown is not wired in yet — the reach signal comes from the finalized daily-views trend.'
  );

  const advice = advisePublish({
    asOf,
    recentViewsPerDay,
    viewsDeclining,
    topRetention,
    priorTopRetention: null, // long-form prior-window retention not wired → no falling-trend read
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
      longFormRetention: topRetention,
      netSubsPerDay: Math.round(netSubsPerDay),
      subsToTier2,
      daysSinceLastUpload,
      finalizedDays: finalized.length,
    },
    caveats,
  });
}
