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
import { isShort } from '@/lib/youtube-shorts';
import {
  isYouTubeAnalyticsConfigured,
  fetchVideoAnalytics,
  type VideoAnalyticsRow,
} from '@/lib/youtube-analytics';
import {
  deriveSignals,
  rankOutliers,
  summarizeByTheme,
  indexThemesByVideo,
  longTailRatio,
  ageInDays,
  DEFAULT_OUTLIER_THRESHOLD,
  type SongSignals,
} from '@/lib/youtube-outliers';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentType } from '@/types/content';
import { themeForSongWithOverride } from '@/config/song-themes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_WINDOW = 365; // analytics window for subs/retention
const MAX_WINDOW = 400;
const DEFAULT_LIMIT = 200; // videos to rank
const MAX_LIMIT = 500;
const MAX_SONGS = 500; // catalogue size cap for the theme lookup
const RECENT_WINDOW_DAYS = 30; // trailing window for the growth30d (long-tail) signal
const GROWTH_MIN_AGE_DAYS = 60; // a song needs a post-first-month tail before growth30d means anything

function clampInt(raw: string | null, def: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

/**
 * Best-effort videoId → theme map from the catalogue (Content), so the theme
 * rollup groups by a real theme. Never throws — a DB hiccup just yields an
 * empty map and the rollup falls back to '(untagged)'.
 */
async function loadVideoThemeMap(): Promise<Map<string, string>> {
  try {
    const repo = new ContentRepository();
    const { items } = await repo.findByType(ContentType.SONGS, { limit: MAX_SONGS });
    return indexThemesByVideo(
      items.map((c) => ({
        youtubeVideoId: c.youtubeVideoId,
        theme: themeForSongWithOverride(c.id, c.theme),
      }))
    );
  } catch {
    return new Map();
  }
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
  const [videos, themeMap] = await Promise.all([
    fetchChannelVideoStats(channelId, limit, { channel }),
    loadVideoThemeMap(),
  ]);

  // Best-effort per-video analytics: the window drives subscriber conversion +
  // retention; a second trailing-30d pull drives the growth30d long-tail ratio.
  const analytics = new Map<string, VideoAnalyticsRow>();
  const recent = new Map<string, VideoAnalyticsRow>();
  let analyticsOk = false;
  if (isYouTubeAnalyticsConfigured()) {
    const [mainRes, recentRes] = await Promise.all([
      fetchVideoAnalytics(window),
      fetchVideoAnalytics(RECENT_WINDOW_DAYS),
    ]);
    if (mainRes.ok) {
      analyticsOk = true;
      for (const row of mainRes.data) analytics.set(row.videoId, row);
    }
    if (recentRes.ok) {
      for (const row of recentRes.data) recent.set(row.videoId, row);
    }
  }

  const asOf = new Date().toISOString().slice(0, 10);
  // Rank SONGS only — Shorts have sub-minute durations that pin the retention
  // proxy near 100% and skew views/day, so they'd surface as false outliers and
  // pollute the theme rollup. (Matches the retention-benchmark Shorts exclusion.)
  const songVideos = videos.filter((v) => !isShort(v));
  const shortsExcluded = videos.length - songVideos.length;
  const songs: SongSignals[] = songVideos.map((v) => {
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
    const r = recent.get(v.id);
    if (r) {
      signals.growth30d = longTailRatio({
        recentViews: r.views,
        recentWindowDays: RECENT_WINDOW_DAYS,
        lifetimeViews: v.viewCount,
        ageDays: ageInDays(v.publishedAt, asOf),
        minAgeDays: GROWTH_MIN_AGE_DAYS,
      });
    }
    signals.theme = themeMap.get(v.id) ?? null;
    return signals;
  });

  const outliers = rankOutliers(songs, { outlierThreshold });
  const themeSummary = summarizeByTheme(outliers, songs);

  const growthComputed = songs.some((s) => s.growth30d != null);
  const signalsAvailable = [
    'viewsPerDay',
    'engagement',
    ...(analyticsOk ? ['subsPer1k', 'retention'] : []),
    ...(growthComputed ? ['growth30d'] : []),
  ];
  const themesJoined = themeMap.size > 0;
  const caveats = [
    `Shorts are excluded — only long-form songs are ranked${shortsExcluded > 0 ? ` (${shortsExcluded} Short${shortsExcluded === 1 ? '' : 's'} filtered out)` : ''}.`,
    'CTR and shares are Studio-only (absent from the API) — those signals are omitted; the score renormalizes over the signals present.',
    growthComputed
      ? `Long-tail growth (growth30d) = trailing-${RECENT_WINDOW_DAYS}d views/day ÷ lifetime views/day; songs younger than ${GROWTH_MIN_AGE_DAYS}d are excluded. Recent views are owner-Analytics, lifetime is public Data-API, so the ratio is approximate.`
      : 'Long-tail growth (growth30d) needs YouTube Analytics — omitted.',
    themesJoined
      ? 'Song themes are joined from the catalogue; a song with no explicit theme defaults to "love" (site convention).'
      : 'Theme rollup groups under "(untagged)" — no catalogue themes could be loaded.',
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
    themesJoined,
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
