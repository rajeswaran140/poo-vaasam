/**
 * GET /api/admin/youtube/outliers?window=<days>&limit=<n>&threshold=<z>
 *
 * The Catalogue Outlier Finder — ranks Tamilagaval's OWN songs by a multi-signal,
 * robust "Outlier Score" (see lib/youtube-outliers) so the proven winners can be
 * amplified and their packaging cloned. Adapts the vidIQ outlier idea to a music
 * channel: it measures the variables Raj controls (reach velocity, subscriber
 * conversion, retention, engagement) RELATIVE TO HIS OWN catalogue.
 *
 * Admin-gated. Requires the Data API (the catalogue + lifetime view/comment
 * counts). YouTube Analytics is BEST-EFFORT enrichment — it adds the
 * subscriber-conversion and retention signals; when it's unconfigured or fails,
 * the score honestly renormalizes over the remaining signals rather than 500ing.
 * CTR/shares are Studio-only (absent from the API) and long-tail growth needs
 * per-video history — both are omitted for now and surfaced in `caveats`.
 *
 * The scoring/ranking itself is the pure, tested lib; this route only fetches the
 * upstream numbers, assembles per-video signals, and hands them over.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { SITE } from '@/config/site';
import {
  fetchChannelStats,
  fetchChannelVideoStats,
  isYouTubeApiConfigured,
} from '@/lib/youtube-api';
import {
  isYouTubeAnalyticsConfigured,
  fetchVideoAnalytics,
  type VideoAnalyticsRow,
} from '@/lib/youtube-analytics';
import {
  deriveSignals,
  rankOutliers,
  summarizeByTheme,
  DEFAULT_OUTLIER_THRESHOLD,
  type SongSignals,
} from '@/lib/youtube-outliers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_WINDOW = 365; // analytics window for subs/retention
const MAX_WINDOW = 400;
const DEFAULT_LIMIT = 200; // videos to rank
const MAX_LIMIT = 500;

function clampInt(raw: string | null, def: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  if (!isYouTubeApiConfigured()) {
    return NextResponse.json(
      { success: false, error: 'YOUTUBE_API_KEY not configured' },
      { status: 503 }
    );
  }

  const params = request.nextUrl.searchParams;
  const window = clampInt(params.get('window'), DEFAULT_WINDOW, 1, MAX_WINDOW);
  const limit = clampInt(params.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const thresholdRaw = Number(params.get('threshold'));
  const outlierThreshold = Number.isFinite(thresholdRaw) ? thresholdRaw : DEFAULT_OUTLIER_THRESHOLD;

  const channelId = SITE.youtube.channelId;
  const channel = await fetchChannelStats(channelId);
  if (!channel) {
    return NextResponse.json(
      { success: false, error: 'Channel not found or API error' },
      { status: 502 }
    );
  }
  const videos = await fetchChannelVideoStats(channelId, limit, { channel });

  // Best-effort per-video analytics (subscriber conversion + retention proxy).
  const analytics = new Map<string, VideoAnalyticsRow>();
  let analyticsOk = false;
  if (isYouTubeAnalyticsConfigured()) {
    const res = await fetchVideoAnalytics(window);
    if (res.ok) {
      analyticsOk = true;
      for (const row of res.data) analytics.set(row.videoId, row);
    }
  }

  const asOf = new Date().toISOString().slice(0, 10);
  const songs: SongSignals[] = videos.map((v) => {
    // Lifetime-based signals (views/day, comments-per-1k) via the tested helper.
    const signals = deriveSignals(
      {
        videoId: v.id,
        title: v.title,
        theme: null, // TODO: join theme from the catalogue (Content) by videoId
        publishedAt: v.publishedAt,
        views: v.viewCount,
        subscribersGained: null,
        comments: v.commentCount,
      },
      asOf
    );
    // Analytics-based signals over the window, on their own bases.
    const a = analytics.get(v.id);
    if (a && a.views > 0) {
      signals.subsPer1k = (a.subscribersGained / a.views) * 1000;
    }
    if (a && v.durationSeconds > 0) {
      // averageViewPercentage proxy = avg seconds watched ÷ video length.
      signals.retention = (a.averageViewDuration / v.durationSeconds) * 100;
    }
    return signals;
  });

  const outliers = rankOutliers(songs, { outlierThreshold });
  const themeSummary = summarizeByTheme(outliers, songs);

  const signalsAvailable = [
    'viewsPerDay',
    'engagement',
    ...(analyticsOk ? ['subsPer1k', 'retention'] : []),
  ];
  const caveats = [
    'CTR and shares are Studio-only (absent from the API) — those signals are omitted; the score renormalizes over the signals present.',
    'Long-tail growth (growth30d) is not yet wired — pending per-video METRICSNAP history.',
    'Theme rollup groups under "(untagged)" until song themes are joined from the catalogue.',
  ];
  if (!analyticsOk) {
    caveats.unshift(
      'YouTube Analytics unavailable — ranked on views/day + engagement only (subscriber-conversion and retention omitted).'
    );
  }

  return NextResponse.json({
    success: true,
    asOf,
    window,
    threshold: outlierThreshold,
    analyticsConfigured: analyticsOk,
    signalsAvailable,
    channel: {
      subscriberCount: channel.subscriberCount,
      videoCount: channel.videoCount,
      ranked: outliers.length,
    },
    outliers,
    themeSummary,
    caveats,
  });
}
