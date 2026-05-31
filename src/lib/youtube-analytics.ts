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
    const res = await fetch('https://oauth2.googleapis.com/token', {
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

function dateRange(daysBack: number): { startDate: string; endDate: string } {
  const today = new Date();
  const start = new Date(today);
  start.setUTCDate(today.getUTCDate() - daysBack);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(today) };
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
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
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

/** Per-video performance over the last N days, sorted by subscribers gained. */
export async function fetchVideoAnalytics(daysBack = 28): Promise<Result<VideoAnalyticsRow[]>> {
  if (!isYouTubeAnalyticsConfigured()) {
    return { ok: false, error: 'YouTube Analytics OAuth not configured' };
  }
  const { startDate, endDate } = dateRange(daysBack);
  try {
    const res = await runReport({
      ids: 'channel==MINE',
      startDate,
      endDate,
      metrics: 'views,estimatedMinutesWatched,averageViewDuration,subscribersGained',
      dimensions: 'video',
      sort: '-subscribersGained',
      maxResults: '50',
    });
    if (!res) return { ok: false, error: 'No response from YouTube Analytics' };
    const rows = (res.rows ?? []).map((row): VideoAnalyticsRow => ({
      videoId: String(row[0]),
      views: Number(row[1] ?? 0),
      estimatedMinutesWatched: Number(row[2] ?? 0),
      averageViewDuration: Number(row[3] ?? 0),
      subscribersGained: Number(row[4] ?? 0),
    }));
    return { ok: true, data: rows };
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
