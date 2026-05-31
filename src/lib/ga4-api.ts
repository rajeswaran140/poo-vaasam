/**
 * Google Analytics 4 Data API client — server-side reads for the admin
 * dashboard. Auth via a service-account JSON whose base64 payload lives in
 * `GA4_SERVICE_ACCOUNT_KEY` and whose target property lives in
 * `GA4_PROPERTY_ID`. The SA needs Viewer on the GA4 property (granted in
 * GA4 Admin → Property Access Management — IAM doesn't cover this).
 *
 * Helpers return a Result discriminated union so the dashboard can render
 * actual error messages ("PERMISSION_DENIED: …") instead of swallowing
 * failures into indistinguishable "no data yet" empty states.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { BetaAnalyticsDataClient } from '@google-analytics/data';

let cachedClient: BetaAnalyticsDataClient | null = null;

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export function isGA4Configured(): boolean {
  return Boolean(process.env.GA4_PROPERTY_ID && process.env.GA4_SERVICE_ACCOUNT_KEY);
}

/**
 * Lazily construct the client. Decodes the base64-encoded service-account
 * JSON and passes it inline so we never write the plaintext to disk on the
 * Lambda filesystem.
 */
function getClient(): BetaAnalyticsDataClient | null {
  if (cachedClient) return cachedClient;
  const encoded = process.env.GA4_SERVICE_ACCOUNT_KEY;
  if (!encoded) return null;
  try {
    const json = Buffer.from(encoded, 'base64').toString('utf8');
    const credentials = JSON.parse(json) as { client_email: string; private_key: string };
    cachedClient = new BetaAnalyticsDataClient({
      credentials: {
        client_email: credentials.client_email,
        private_key: credentials.private_key,
      },
    });
    return cachedClient;
  } catch (err) {
    console.error('[ga4-api] failed to decode service-account key:', err);
    return null;
  }
}

function propertyPath(): string | null {
  const id = process.env.GA4_PROPERTY_ID;
  return id ? `properties/${id}` : null;
}

/** Pull the most useful, human-readable message out of a Google API error. */
function errMessage(err: unknown): string {
  if (err instanceof Error) {
    // GoogleError sometimes has .details / .code / .reason — but .message is
    // usually the most useful single line ("3 INVALID_ARGUMENT: ..." or
    // "7 PERMISSION_DENIED: User does not have sufficient permissions…").
    return err.message;
  }
  return String(err);
}

export interface SubscribeClickRow {
  source: string;
  eventCount: number;
}

export interface SubscribeClicksData {
  rows: SubscribeClickRow[];
  /** Total count across all rows — also populated when the breakdown query
   *  fails but the un-broken-down total query succeeds (custom dimension
   *  not yet registered). */
  total: number;
  /** Optional state hint surfaced on the dashboard. */
  note?: 'dimension-not-registered';
}

/**
 * Aggregated `subscribe_click` counts broken down by the `source` event
 * parameter (home_hero / floater / footer / about / videos_hero /
 * home_latest_videos). Last N days.
 *
 * If the breakdown fails with INVALID_ARGUMENT — the most common reason is
 * that `source` hasn't been registered as a GA4 Custom Dimension yet — we
 * automatically retry without the dimension to surface at least the total
 * count, so the dashboard isn't blank while waiting on GA4 admin setup.
 */
export async function fetchSubscribeClicksBySource(
  daysBack = 28
): Promise<Result<SubscribeClicksData>> {
  const client = getClient();
  const property = propertyPath();
  if (!client || !property) return { ok: false, error: 'GA4 client not initialised' };

  const baseFilter = {
    filter: {
      fieldName: 'eventName',
      stringFilter: { matchType: 'EXACT', value: 'subscribe_click' },
    },
  };
  const dateRanges = [{ startDate: `${daysBack}daysAgo`, endDate: 'today' }];

  try {
    const [res] = await client.runReport({
      property,
      dateRanges,
      dimensions: [{ name: 'customEvent:source' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: baseFilter,
      limit: 50,
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    } as any);

    const rows = (res.rows ?? []).map((row: any) => ({
      source: row.dimensionValues?.[0]?.value || '(not set)',
      eventCount: Number(row.metricValues?.[0]?.value ?? 0),
    }));
    const total = rows.reduce((sum, r) => sum + r.eventCount, 0);
    return { ok: true, data: { rows, total } };
  } catch (err) {
    const error = errMessage(err);
    // INVALID_ARGUMENT here almost always means `customEvent:source` isn't
    // a registered custom dimension yet. Retry without the dimension so the
    // dashboard can still show the running total.
    if (/INVALID_ARGUMENT|customEvent/i.test(error)) {
      try {
        const [res] = await client.runReport({
          property,
          dateRanges,
          metrics: [{ name: 'eventCount' }],
          dimensionFilter: baseFilter,
        } as any);
        const total = Number(res.rows?.[0]?.metricValues?.[0]?.value ?? 0);
        return { ok: true, data: { rows: [], total, note: 'dimension-not-registered' } };
      } catch (fallbackErr) {
        const fallbackError = errMessage(fallbackErr);
        console.error('[ga4-api] subscribe_click total fallback failed:', fallbackError);
        return { ok: false, error: fallbackError };
      }
    }
    console.error('[ga4-api] subscribe_click query failed:', error);
    return { ok: false, error };
  }
}

export interface TrafficSnapshot {
  totalUsers: number;
  sessions: number;
  pageViews: number;
  daysBack: number;
}

export interface EngagementRow {
  /** Breakdown key — song_title for audio_play, destination for youtube_open. */
  label: string;
  eventCount: number;
}

export interface EngagementData {
  rows: EngagementRow[];
  total: number;
  note?: 'dimension-not-registered';
}

/**
 * Shared helper for "count events of type X, broken down by event-parameter Y,
 * with a graceful fallback to the un-broken-down total when the custom
 * dimension isn't registered in GA4 yet." Powers both audio_play and
 * youtube_open queries.
 */
async function fetchEventBreakdown(
  eventName: string,
  paramName: string,
  daysBack: number
): Promise<Result<EngagementData>> {
  const client = getClient();
  const property = propertyPath();
  if (!client || !property) return { ok: false, error: 'GA4 client not initialised' };

  const baseFilter = {
    filter: {
      fieldName: 'eventName',
      stringFilter: { matchType: 'EXACT', value: eventName },
    },
  };
  const dateRanges = [{ startDate: `${daysBack}daysAgo`, endDate: 'today' }];

  try {
    const [res] = await client.runReport({
      property,
      dateRanges,
      dimensions: [{ name: `customEvent:${paramName}` }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: baseFilter,
      limit: 50,
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    } as any);

    const rows = (res.rows ?? []).map((row: any) => ({
      label: row.dimensionValues?.[0]?.value || '(not set)',
      eventCount: Number(row.metricValues?.[0]?.value ?? 0),
    }));
    const total = rows.reduce((sum, r) => sum + r.eventCount, 0);
    return { ok: true, data: { rows, total } };
  } catch (err) {
    const error = errMessage(err);
    if (/INVALID_ARGUMENT|customEvent/i.test(error)) {
      try {
        const [res] = await client.runReport({
          property,
          dateRanges,
          metrics: [{ name: 'eventCount' }],
          dimensionFilter: baseFilter,
        } as any);
        const total = Number(res.rows?.[0]?.metricValues?.[0]?.value ?? 0);
        return { ok: true, data: { rows: [], total, note: 'dimension-not-registered' } };
      } catch (fallbackErr) {
        const fallbackError = errMessage(fallbackErr);
        console.error(`[ga4-api] ${eventName} total fallback failed:`, fallbackError);
        return { ok: false, error: fallbackError };
      }
    }
    console.error(`[ga4-api] ${eventName} query failed:`, error);
    return { ok: false, error };
  }
}

/** Top-played songs over the last N days (audio_play events, by song_title). */
export function fetchAudioPlays(daysBack = 28): Promise<Result<EngagementData>> {
  return fetchEventBreakdown('audio_play', 'song_title', daysBack);
}

/**
 * Same as fetchAudioPlays but grouped by the immutable `song_id` parameter
 * instead of the human-readable title. Used by the /admin/songs per-row plays
 * column — a song that gets renamed in DB still aggregates correctly because
 * `song_id` (cnt_…) never changes once published.
 */
export function fetchAudioPlaysBySongId(daysBack = 28): Promise<Result<EngagementData>> {
  return fetchEventBreakdown('audio_play', 'song_id', daysBack);
}

/** YouTube outbound clicks over the last N days (youtube_open events, by destination). */
export function fetchYouTubeOpens(daysBack = 28): Promise<Result<EngagementData>> {
  return fetchEventBreakdown('youtube_open', 'destination', daysBack);
}

export async function fetchTrafficSnapshot(daysBack = 28): Promise<Result<TrafficSnapshot>> {
  const client = getClient();
  const property = propertyPath();
  if (!client || !property) return { ok: false, error: 'GA4 client not initialised' };

  try {
    const [res] = await client.runReport({
      property,
      dateRanges: [{ startDate: `${daysBack}daysAgo`, endDate: 'today' }],
      metrics: [
        { name: 'totalUsers' },
        { name: 'sessions' },
        { name: 'screenPageViews' },
      ],
    } as any);
    const m = res.rows?.[0]?.metricValues;
    return {
      ok: true,
      data: {
        totalUsers: Number(m?.[0]?.value ?? 0),
        sessions: Number(m?.[1]?.value ?? 0),
        pageViews: Number(m?.[2]?.value ?? 0),
        daysBack,
      },
    };
  } catch (err) {
    const error = errMessage(err);
    console.error('[ga4-api] traffic snapshot failed:', error);
    return { ok: false, error };
  }
}
