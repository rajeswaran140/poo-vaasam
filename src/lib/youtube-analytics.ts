/**
 * YouTube Analytics API v2 client — owner-scoped per-video metrics that
 * the public Data API can't return (subscribers gained per video,
 * watch time, average view duration, retention proxies).
 *
 * Auth is OAuth 2.0 refresh-token flow: a one-time consent grant by the
 * channel owner (Raj) generates a refresh token; the Lambda exchanges it
 * for a short-lived access token on demand and caches it for ~1 hour.
 *
 * Env vars (server-only):
 *   YOUTUBE_OAUTH_CLIENT_ID
 *   YOUTUBE_OAUTH_CLIENT_SECRET
 *   YOUTUBE_REFRESH_TOKEN
 *
 * Without these set, every helper returns { ok: false, error } so the
 * admin dashboard can render a clear "not configured yet" banner.
 */

import { fetchWithRetry } from '@/lib/fetch-retry';
import { parseGeographyRows, type GeographyRawRow } from '@/lib/youtube-geography';
import type {
  FunnelInput,
  FunnelTrafficRow,
  FunnelPlaylistTotals,
  FunnelVideoRow,
  FunnelSubscribedStatus,
  FunnelDiscoverySource,
} from '@/lib/youtube-funnel';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export interface VideoAnalyticsRow {
  videoId: string;
  views: number;
  estimatedMinutesWatched: number;
  averageViewDuration: number; // seconds
  subscribersGained: number;
}

export interface ChannelAnalyticsSnapshot {
  views: number;
  estimatedMinutesWatched: number;
  averageViewDuration: number;
  subscribersGained: number;
  subscribersLost: number;
  daysBack: number;
}

interface TokenCache {
  accessToken: string;
  expiresAt: number; // epoch ms
}
let tokenCache: TokenCache | null = null;

export function isYouTubeAnalyticsConfigured(): boolean {
  return Boolean(
    process.env.YOUTUBE_OAUTH_CLIENT_ID &&
    process.env.YOUTUBE_OAUTH_CLIENT_SECRET &&
    process.env.YOUTUBE_REFRESH_TOKEN
  );
}

/** Exchange refresh token → short-lived access token. Cached for ~1h. */
async function getAccessToken(): Promise<string | null> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }
  const id = process.env.YOUTUBE_OAUTH_CLIENT_ID;
  const secret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
  const refresh = process.env.YOUTUBE_REFRESH_TOKEN;
  if (!id || !secret || !refresh) return null;

  try {
    const res = await fetchWithRetry('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: id,
        client_secret: secret,
        refresh_token: refresh,
        grant_type: 'refresh_token',
      }).toString(),
    });
    if (!res.ok) {
      console.error('[youtube-analytics] token refresh failed:', res.status, await res.text());
      return null;
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;
    tokenCache = {
      accessToken: json.access_token,
      expiresAt: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000,
    };
    return tokenCache.accessToken;
  } catch (err) {
    console.error('[youtube-analytics] token refresh threw:', err);
    return null;
  }
}

/**
 * Exactly `daysBack` finalized days, ending YESTERDAY. Today is excluded
 * because YouTube Analytics hasn't finalized the current day (a partial/empty
 * tail that skewed "last N days" windows and made them one day too wide).
 * Exported for unit testing.
 */
export function dateRange(daysBack: number): { startDate: string; endDate: string } {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const n = Math.max(1, daysBack);
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1); // yesterday
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - (n - 1));
  return { startDate: fmt(start), endDate: fmt(end) };
}

interface AnalyticsResponse {
  rows?: Array<Array<string | number>>;
  columnHeaders?: Array<{ name: string }>;
}

async function runReport(params: Record<string, string>): Promise<AnalyticsResponse | null> {
  const token = await getAccessToken();
  if (!token) return null;
  const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const res = await fetchWithRetry(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      // 401 means token's been revoked or scopes changed — bust the cache so
      // the next call tries a fresh refresh.
      if (res.status === 401) tokenCache = null;
      const body = await res.text();
      console.error('[youtube-analytics] report failed:', res.status, body);
      throw new Error(`Analytics API ${res.status}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as AnalyticsResponse;
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error(String(err));
  }
}

/**
 * Per-video performance over the last N days, sorted by subscribers gained.
 * Pages through the report (startIndex/maxResults) so channels with >50 videos
 * aren't silently truncated to the top 50.
 */
export async function fetchVideoAnalytics(daysBack = 28): Promise<Result<VideoAnalyticsRow[]>> {
  if (!isYouTubeAnalyticsConfigured()) {
    return { ok: false, error: 'YouTube Analytics OAuth not configured' };
  }
  const { startDate, endDate } = dateRange(daysBack);
  const PAGE = 50; // Analytics maxResults per request
  const MAX = 500; // hard cap — quota/runaway safety
  try {
    const rows: VideoAnalyticsRow[] = [];
    for (let startIndex = 1; startIndex <= MAX; startIndex += PAGE) {
      const res = await runReport({
        ids: 'channel==MINE',
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched,averageViewDuration,subscribersGained',
        dimensions: 'video',
        sort: '-subscribersGained',
        maxResults: String(PAGE),
        startIndex: String(startIndex),
      });
      if (!res) {
        if (rows.length > 0) break; // keep what we have if a later page fails
        return { ok: false, error: 'No response from YouTube Analytics' };
      }
      const pageRows = (res.rows ?? []).map((row): VideoAnalyticsRow => ({
        videoId: String(row[0]),
        views: Number(row[1] ?? 0),
        estimatedMinutesWatched: Number(row[2] ?? 0),
        averageViewDuration: Number(row[3] ?? 0),
        subscribersGained: Number(row[4] ?? 0),
      }));
      rows.push(...pageRows);
      if (pageRows.length < PAGE) break; // last page
    }
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface TopVideoRow {
  videoId: string;
  views: number;
  averageViewDuration: number; // seconds
}

/**
 * Per-video views + average view duration for an EXPLICIT date window, sorted by
 * views. Used by the top-song monitor to compare a recent window vs the prior
 * one (fetchVideoAnalytics only does "last N days"; the monitor needs both).
 */
export async function fetchTopVideosWindow(
  startDate: string,
  endDate: string,
  maxResults = 50
): Promise<Result<TopVideoRow[]>> {
  if (!isYouTubeAnalyticsConfigured()) {
    return { ok: false, error: 'YouTube Analytics OAuth not configured' };
  }
  try {
    const res = await runReport({
      ids: 'channel==MINE',
      startDate,
      endDate,
      metrics: 'views,averageViewDuration',
      dimensions: 'video',
      sort: '-views',
      maxResults: String(maxResults),
    });
    if (!res) return { ok: false, error: 'No response from YouTube Analytics' };
    const rows = (res.rows ?? []).map((r): TopVideoRow => ({
      videoId: String(r[0]),
      views: Number(r[1] ?? 0),
      averageViewDuration: Number(r[2] ?? 0),
    }));
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Per-second audience-retention curve for a single video: rows of
 * [elapsedVideoTimeRatio, audienceWatchRatio]. Owner-scoped; only available
 * for videos with enough finalized data (a brand-new upload returns []).
 */
export async function fetchRetentionCurve(
  videoId: string,
  daysBack = 90
): Promise<Result<Array<[number, number]>>> {
  if (!isYouTubeAnalyticsConfigured()) {
    return { ok: false, error: 'YouTube Analytics OAuth not configured' };
  }
  if (!videoId) return { ok: false, error: 'videoId is required' };
  const { startDate, endDate } = dateRange(daysBack);
  try {
    const res = await runReport({
      ids: 'channel==MINE',
      startDate,
      endDate,
      metrics: 'audienceWatchRatio',
      dimensions: 'elapsedVideoTimeRatio',
      filters: `video==${videoId}`,
      sort: 'elapsedVideoTimeRatio',
    });
    if (!res) return { ok: false, error: 'No response from YouTube Analytics' };
    const rows = (res.rows ?? []).map((r): [number, number] => [Number(r[0]), Number(r[1])]);
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Per-video audience geography: views / watch-time / retention by country,
 * for a single video. Owner-scoped. Returns raw rows (parsed into objects);
 * the pure `summarizeGeography` decorates them with names/flags/shares.
 *
 * YouTube only reports countries above its privacy threshold and only for
 * finalized views, so a brand-new or very-low-view video can return [].
 */
export async function fetchVideoGeography(
  videoId: string,
  daysBack = 90
): Promise<Result<GeographyRawRow[]>> {
  if (!isYouTubeAnalyticsConfigured()) {
    return { ok: false, error: 'YouTube Analytics OAuth not configured' };
  }
  if (!videoId) return { ok: false, error: 'videoId is required' };
  const { startDate, endDate } = dateRange(daysBack);
  try {
    const res = await runReport({
      ids: 'channel==MINE',
      startDate,
      endDate,
      metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage',
      dimensions: 'country',
      filters: `video==${videoId}`,
      sort: '-views',
      maxResults: '200',
    });
    if (!res) return { ok: false, error: 'No response from YouTube Analytics' };
    return { ok: true, data: parseGeographyRows(res.rows) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface DailyAnalyticsRow {
  date: string;
  views: number;
  subscribersGained: number;
  estimatedMinutesWatched: number;
  /** Channel series only (fetchDailySeries); net subs = gained − lost. */
  subscribersLost?: number;
}

/** Daily channel series (views/subs/watch-time per day) for the last N days. */
export async function fetchDailySeries(daysBack = 28): Promise<Result<DailyAnalyticsRow[]>> {
  if (!isYouTubeAnalyticsConfigured()) {
    return { ok: false, error: 'YouTube Analytics OAuth not configured' };
  }
  const { startDate, endDate } = dateRange(daysBack);
  try {
    const res = await runReport({
      ids: 'channel==MINE',
      startDate,
      endDate,
      // subscribersLost appended LAST so existing column indices don't shift.
      metrics: 'views,subscribersGained,estimatedMinutesWatched,subscribersLost',
      dimensions: 'day',
      sort: 'day',
    });
    if (!res) return { ok: false, error: 'No response from YouTube Analytics' };
    const rows = (res.rows ?? []).map((r): DailyAnalyticsRow => ({
      date: String(r[0]),
      views: Number(r[1] ?? 0),
      subscribersGained: Number(r[2] ?? 0),
      estimatedMinutesWatched: Number(r[3] ?? 0),
      subscribersLost: Number(r[4] ?? 0),
    }));
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Total `shares` (native YouTube Share button) for ONE video over the window.
 * A top-videos-BY-shares report isn't supported by the API, so shares are read
 * per-video via a `video==` filter. NOTE: counts only shares through YouTube's
 * own Share dialog — copy-paste-the-link sharing isn't captured, so this is a
 * FLOOR, complementary to the app's first-party WhatsApp/Status tracking.
 */
export async function fetchVideoShares(videoId: string, daysBack = 90): Promise<Result<number>> {
  if (!isYouTubeAnalyticsConfigured()) {
    return { ok: false, error: 'YouTube Analytics OAuth not configured' };
  }
  const { startDate, endDate } = dateRange(daysBack);
  try {
    const res = await runReport({
      ids: 'channel==MINE',
      startDate,
      endDate,
      metrics: 'shares',
      filters: `video==${videoId}`,
    });
    if (!res) return { ok: false, error: 'No response from YouTube Analytics' };
    return { ok: true, data: Number(res.rows?.[0]?.[0] ?? 0) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Daily views / subscribers-gained / watch-minutes for ONE video — the per-song
 * daily series (day dimension + video filter). This is the intersection the
 * dashboard was missing: it already had per-song *aggregate* (fetchVideoAnalytics)
 * and channel-wide *daily* (fetchDailySeries), but not a single song's day-by-day
 * curve. Owner-scoped; a brand-new upload returns a short/empty series.
 */
export async function fetchVideoDailySeries(
  videoId: string,
  daysBack = 28
): Promise<Result<DailyAnalyticsRow[]>> {
  if (!isYouTubeAnalyticsConfigured()) {
    return { ok: false, error: 'YouTube Analytics OAuth not configured' };
  }
  if (!videoId) return { ok: false, error: 'videoId is required' };
  const { startDate, endDate } = dateRange(daysBack);
  try {
    const res = await runReport({
      ids: 'channel==MINE',
      startDate,
      endDate,
      metrics: 'views,subscribersGained,estimatedMinutesWatched',
      dimensions: 'day',
      filters: `video==${videoId}`,
      sort: 'day',
    });
    if (!res) return { ok: false, error: 'No response from YouTube Analytics' };
    const rows = (res.rows ?? []).map((r): DailyAnalyticsRow => ({
      date: String(r[0]),
      views: Number(r[1] ?? 0),
      subscribersGained: Number(r[2] ?? 0),
      estimatedMinutesWatched: Number(r[3] ?? 0),
    }));
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface SearchTermRow {
  /** The query a viewer typed in YouTube search to reach the video/channel. */
  term: string;
  views: number;
  estimatedMinutesWatched: number;
}

/**
 * The real YouTube-search terms that drove views — the queries viewers actually
 * typed to find this video (or the whole channel when `videoId` is omitted).
 *
 * This is VIEWER TRUTH from the Analytics API, and it's deliberately used
 * INSTEAD of the public Data-API `search.list` ordering: `search.list` is
 * unpersonalized and can report a video as absent from the top results while
 * the personalized YouTube app ranks it #1 for the same query (confirmed
 * 2026-07-10). So we measure "did search actually bring viewers, and for what
 * terms" rather than guessing an unpersonalized rank.
 *
 * Owner-scoped. A brand-new / low-search video returns [] (YouTube's reporting
 * threshold), which is expected — not an error.
 */
/**
 * HARD API CAP — `insightTrafficSourceDetail` rejects any `maxResults` above 25
 * with a 500 `FIELD_UNKNOWN_VALUE` (not a 400), so an over-cap value looks like
 * a YouTube outage rather than a bad request. Verified against the live API
 * 2026-07-14: 25 → 200 OK, 26 → 500. Do NOT raise this.
 */
export const SEARCH_TERMS_MAX_RESULTS = 25;

export async function fetchSearchTerms(
  videoId?: string,
  daysBack = 90
): Promise<Result<SearchTermRow[]>> {
  if (!isYouTubeAnalyticsConfigured()) {
    return { ok: false, error: 'YouTube Analytics OAuth not configured' };
  }
  const { startDate, endDate } = dateRange(daysBack);
  // insightTrafficSourceDetail scoped to YT_SEARCH returns the search queries;
  // an optional video== filter narrows it to one video.
  const filters = videoId
    ? `video==${videoId};insightTrafficSourceType==YT_SEARCH`
    : 'insightTrafficSourceType==YT_SEARCH';
  try {
    const res = await runReport({
      ids: 'channel==MINE',
      startDate,
      endDate,
      metrics: 'views,estimatedMinutesWatched',
      dimensions: 'insightTrafficSourceDetail',
      filters,
      sort: '-views',
      maxResults: String(SEARCH_TERMS_MAX_RESULTS),
    });
    if (!res) return { ok: false, error: 'No response from YouTube Analytics' };
    const rows = (res.rows ?? []).map((r): SearchTermRow => ({
      term: String(r[0]),
      views: Number(r[1] ?? 0),
      estimatedMinutesWatched: Number(r[2] ?? 0),
    }));
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface ReferrerRow {
  /** The external site/app YouTube attributes the view to ("WhatsApp", "facebook.com", …). */
  source: string;
  views: number;
  estimatedMinutesWatched: number;
}

/**
 * External sites/apps that sent views to the channel — `insightTrafficSourceDetail`
 * scoped to EXT_URL.
 *
 * This is the RETURN LEG of the share loop, and until 2026-07 nothing in the app
 * queried it: every other share metric counts outbound clicks (our buttons, or
 * YouTube's native Share dialog) and none could answer "did a share actually
 * bring anyone back". EXT_URL is where a WhatsApp forward shows up when the
 * recipient taps the link, so it's the only place the loop can be closed.
 *
 * Note WhatsApp arrives under several distinct labels ("WhatsApp",
 * "whatsapp.com", "WhatsApp Business") — merging them is the caller's job; see
 * `lib/whatsapp-referrals`.
 */
export async function fetchExternalReferrers(daysBack = 28): Promise<Result<ReferrerRow[]>> {
  if (!isYouTubeAnalyticsConfigured()) {
    return { ok: false, error: 'YouTube Analytics OAuth not configured' };
  }
  const { startDate, endDate } = dateRange(daysBack);
  try {
    const res = await runReport({
      ids: 'channel==MINE',
      startDate,
      endDate,
      metrics: 'views,estimatedMinutesWatched',
      dimensions: 'insightTrafficSourceDetail',
      filters: 'insightTrafficSourceType==EXT_URL',
      sort: '-views',
      maxResults: '50',
    });
    if (!res) return { ok: false, error: 'No response from YouTube Analytics' };
    const rows = (res.rows ?? []).map((r): ReferrerRow => ({
      source: String(r[0]),
      views: Number(r[1] ?? 0),
      estimatedMinutesWatched: Number(r[2] ?? 0),
    }));
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Assemble the Viewer Conversion Funnel input from four Analytics reports:
 *   A. channel totals (views/watch/avgViewPct/subs) — REQUIRED
 *   A2. unique viewers (`viewers`) — best-effort (400s in some combos → null)
 *   B. traffic sources (insightTrafficSourceType) — best-effort → []
 *   C. playlist totals (isCurated==1: viewsPerPlaylistStart etc.) — best-effort → null
 *   D. per-video (views/avgViewPct/subsGained) — best-effort → []
 * Only report A is required; the optional sub-reports degrade to empty so a
 * single failing dimension (e.g. no playlist data yet) never sinks the funnel.
 * The pure computeFunnel() (lib/youtube-funnel) turns this into the model.
 */
export async function fetchFunnelData(daysBack = 28): Promise<Result<FunnelInput>> {
  if (!isYouTubeAnalyticsConfigured()) {
    return { ok: false, error: 'YouTube Analytics OAuth not configured' };
  }
  const { startDate, endDate } = dateRange(daysBack);
  const base = { ids: 'channel==MINE', startDate, endDate };
  try {
    // A — channel totals (required)
    const chRes = await runReport({
      ...base,
      metrics: 'views,estimatedMinutesWatched,averageViewPercentage,subscribersGained,subscribersLost',
    });
    if (!chRes) return { ok: false, error: 'No response from YouTube Analytics' };
    const c = chRes.rows?.[0] ?? [];

    // A2 — unique viewers (best-effort)
    let uniqueViewers: number | null = null;
    try {
      const vRes = await runReport({ ...base, metrics: 'viewers' });
      const vv = vRes?.rows?.[0]?.[0];
      if (vv != null) uniqueViewers = Number(vv);
    } catch {
      uniqueViewers = null;
    }

    // B — traffic sources (best-effort)
    let trafficSources: FunnelTrafficRow[] = [];
    try {
      const tRes = await runReport({
        ...base,
        metrics: 'views,estimatedMinutesWatched',
        dimensions: 'insightTrafficSourceType',
        sort: '-views',
        maxResults: '25',
      });
      trafficSources = (tRes?.rows ?? []).map((r) => ({
        source: String(r[0]),
        views: Number(r[1] ?? 0),
        watchMinutes: Number(r[2] ?? 0),
      }));
    } catch {
      trafficSources = [];
    }

    // C — playlist totals (best-effort). NOTE: the old `isCurated==1` filter was
    // deprecated by YouTube (2024) and now 400s — the current playlist metrics
    // are queried WITHOUT it.
    let playlist: FunnelPlaylistTotals | null = null;
    try {
      const pRes = await runReport({
        ...base,
        metrics: 'playlistStarts,viewsPerPlaylistStart,averageTimeInPlaylist',
      });
      const p = pRes?.rows?.[0];
      if (p) {
        playlist = {
          playlistStarts: Number(p[0] ?? 0),
          viewsPerPlaylistStart: Number(p[1] ?? 0),
          averageTimeInPlaylistSeconds: Number(p[2] ?? 0),
        };
      }
    } catch {
      playlist = null;
    }

    // D — per-video (best-effort)
    let videos: FunnelVideoRow[] = [];
    try {
      const dRes = await runReport({
        ...base,
        metrics: 'views,averageViewPercentage,subscribersGained',
        dimensions: 'video',
        sort: '-views',
        maxResults: '200',
      });
      videos = (dRes?.rows ?? []).map((r) => ({
        videoId: String(r[0]),
        views: Number(r[1] ?? 0),
        averageViewPercentage: Number(r[2] ?? 0),
        subscribersGained: Number(r[3] ?? 0),
      }));
    } catch {
      videos = [];
    }

    // E — subscribedStatus split (REAL returning measure, best-effort)
    let subscribedStatus: FunnelSubscribedStatus | null = null;
    try {
      const sRes = await runReport({ ...base, metrics: 'views,estimatedMinutesWatched', dimensions: 'subscribedStatus' });
      const rows = sRes?.rows ?? [];
      if (rows.length) {
        const find = (k: string) => rows.find((r) => String(r[0]) === k);
        const sub = find('SUBSCRIBED');
        const unsub = find('UNSUBSCRIBED');
        subscribedStatus = {
          subscribed: { views: Number(sub?.[1] ?? 0), watchMinutes: Number(sub?.[2] ?? 0) },
          unsubscribed: { views: Number(unsub?.[1] ?? 0), watchMinutes: Number(unsub?.[2] ?? 0) },
        };
      }
    } catch {
      subscribedStatus = null;
    }

    // F — discovery sources: which of my videos feed suggested traffic (best-effort)
    let discoverySources: FunnelDiscoverySource[] = [];
    try {
      const fRes = await runReport({
        ...base,
        metrics: 'views',
        dimensions: 'insightTrafficSourceDetail',
        filters: 'insightTrafficSourceType==RELATED_VIDEO',
        sort: '-views',
        maxResults: '10',
      });
      discoverySources = (fRes?.rows ?? []).map((r) => ({ videoId: String(r[0]), views: Number(r[1] ?? 0) }));
    } catch {
      discoverySources = [];
    }

    return {
      ok: true,
      data: {
        days: daysBack,
        channel: {
          views: Number(c[0] ?? 0),
          watchMinutes: Number(c[1] ?? 0),
          averageViewPercentage: Number(c[2] ?? 0),
          subscribersGained: Number(c[3] ?? 0),
          subscribersLost: Number(c[4] ?? 0),
          uniqueViewers,
        },
        trafficSources,
        playlist,
        videos,
        subscribedStatus,
        discoverySources,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Estimated ad revenue (USD) for the last N days.
 *
 * REQUIRES THE MONETARY SCOPE: the `estimatedRevenue` metric is only
 * accessible when the OAuth grant includes
 * `https://www.googleapis.com/auth/yt-analytics-monetary.readonly`. The
 * current refresh token was minted WITHOUT it, so this call 403s upstream —
 * which `runReport` surfaces as a thrown Error. We catch it and return
 * `{ ok: false, error }` so callers degrade gracefully (show a "re-auth to
 * unlock earnings" note) instead of crashing. Once Raj re-consents adding the
 * monetary scope, the same call starts returning real numbers with no code
 * change.
 */
export async function fetchEstimatedRevenue(
  daysBack = 28
): Promise<Result<{ estimatedRevenue: number; days: number }>> {
  if (!isYouTubeAnalyticsConfigured()) {
    return { ok: false, error: 'YouTube Analytics OAuth not configured' };
  }
  const { startDate, endDate } = dateRange(daysBack);
  try {
    const res = await runReport({
      ids: 'channel==MINE',
      startDate,
      endDate,
      metrics: 'estimatedRevenue',
    });
    if (!res) return { ok: false, error: 'No response from YouTube Analytics' };
    const row = res.rows?.[0] ?? [];
    return { ok: true, data: { estimatedRevenue: Number(row[0] ?? 0), days: daysBack } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Channel-wide aggregates for the last N days. */
export async function fetchChannelAnalyticsSnapshot(daysBack = 28): Promise<Result<ChannelAnalyticsSnapshot>> {
  if (!isYouTubeAnalyticsConfigured()) {
    return { ok: false, error: 'YouTube Analytics OAuth not configured' };
  }
  const { startDate, endDate } = dateRange(daysBack);
  try {
    const res = await runReport({
      ids: 'channel==MINE',
      startDate,
      endDate,
      metrics: 'views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost',
    });
    if (!res) return { ok: false, error: 'No response from YouTube Analytics' };
    const row = res.rows?.[0] ?? [];
    return {
      ok: true,
      data: {
        views: Number(row[0] ?? 0),
        estimatedMinutesWatched: Number(row[1] ?? 0),
        averageViewDuration: Number(row[2] ?? 0),
        subscribersGained: Number(row[3] ?? 0),
        subscribersLost: Number(row[4] ?? 0),
        daysBack,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
