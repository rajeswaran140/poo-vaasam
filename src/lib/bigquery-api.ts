/**
 * BigQuery client — server-side reads against the GA4 → BigQuery native
 * export. The export lands in a project you own, in a dataset named
 * `analytics_<GA4_PROPERTY_ID>`; one table per day, `events_YYYYMMDD`, plus
 * `events_intraday_YYYYMMDD` for the current day.
 *
 * WHY THIS EXISTS ALONGSIDE [[ga4-api]]. The Data API answers pre-aggregated
 * questions ("sessions by source last 28 days") — it's fast, cached, and
 * has a fixed metric/dimension vocabulary. BigQuery answers arbitrary SQL
 * questions on the raw event stream ("which lyric-page landings led to a
 * subsequent audio_play, joined by day-of-week and country") — slower, but
 * unrestricted. Both have a place: quick dashboard cards stay on ga4-api,
 * cross-cutting questions come here.
 *
 * Config:
 *   BIGQUERY_PROJECT_ID           GCP project hosting the export
 *   GA4_PROPERTY_ID               used to derive the dataset name (analytics_<id>)
 *   BIGQUERY_SERVICE_ACCOUNT_KEY  base64 SA JSON; FALLS BACK to GA4_SERVICE_ACCOUNT_KEY
 *                                 (typical setup: one SA with GA4 Viewer +
 *                                 BigQuery Data Viewer on the dataset +
 *                                 BigQuery Job User on the project)
 *
 * See docs/bigquery-setup.md for the one-time GCP console steps.
 */

import { BigQuery } from '@google-cloud/bigquery';

let cachedClient: BigQuery | null = null;

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export function isBigQueryConfigured(): boolean {
  const key = process.env.BIGQUERY_SERVICE_ACCOUNT_KEY || process.env.GA4_SERVICE_ACCOUNT_KEY;
  return Boolean(process.env.BIGQUERY_PROJECT_ID && process.env.GA4_PROPERTY_ID && key);
}

/** Dataset name GA4's native export creates automatically. */
export function ga4DatasetName(): string | null {
  const id = process.env.GA4_PROPERTY_ID;
  return id ? `analytics_${id}` : null;
}

function getClient(): BigQuery | null {
  if (cachedClient) return cachedClient;
  const projectId = process.env.BIGQUERY_PROJECT_ID;
  const encoded = process.env.BIGQUERY_SERVICE_ACCOUNT_KEY || process.env.GA4_SERVICE_ACCOUNT_KEY;
  if (!projectId || !encoded) return null;
  try {
    const json = Buffer.from(encoded, 'base64').toString('utf8');
    const credentials = JSON.parse(json) as { client_email: string; private_key: string };
    cachedClient = new BigQuery({
      projectId,
      credentials: {
        client_email: credentials.client_email,
        private_key: credentials.private_key,
      },
    });
    return cachedClient;
  } catch (err) {
    console.error('[bigquery-api] failed to decode service-account key:', err);
    return null;
  }
}

/** Extract a readable message from Google API errors. */
function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export interface DayOfWeekEngagement {
  /** ISO day-of-week: 1 = Monday, 7 = Sunday. */
  dayOfWeek: number;
  dayLabel: string;
  sessions: number;
  /** Average of ga_session_number's `engagement_time_msec` / 1000. */
  avgEngagementSec: number;
  pageviews: number;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Convert BigQuery `EXTRACT(DAYOFWEEK FROM …)` (1=Sunday..7=Saturday) into
 * ISO 8601 day-of-week (1=Monday..7=Sunday). Extracted so the mapping is
 * independently testable — every wrong-DOW dashboard bug I've seen came
 * from someone reading BQ's convention as ISO's.
 */
export function bqDayOfWeekToIso(bqDow: number): number {
  return ((bqDow + 5) % 7) + 1;
}

export function isoDayLabel(isoDow: number): string {
  return DAY_LABELS[isoDow - 1] ?? '?';
}

/**
 * Sessions + engagement + pageviews grouped by day-of-week, for the last
 * `daysBack` days. Excludes today (intraday table is partial and skews DoW
 * averages toward the current day).
 *
 * Uses the GA4 export's canonical `session_start` event + `page_view` event.
 * `user_pseudo_id + ga_session_id` is the standard GA4 session key.
 */
export async function fetchDayOfWeekEngagement(daysBack = 30): Promise<Result<DayOfWeekEngagement[]>> {
  const client = getClient();
  const dataset = ga4DatasetName();
  const projectId = process.env.BIGQUERY_PROJECT_ID;
  if (!client || !dataset || !projectId) {
    return { ok: false, error: 'BigQuery not configured' };
  }

  // Parameterized query — never string-interpolate `daysBack` into SQL.
  const sql = `
    WITH sessions AS (
      SELECT
        EXTRACT(DAYOFWEEK FROM PARSE_DATE('%Y%m%d', event_date)) AS dow_us,
        CONCAT(user_pseudo_id, '-', (SELECT value.int_value FROM UNNEST(event_params) WHERE key='ga_session_id')) AS session_id,
        SUM(CASE WHEN event_name='page_view' THEN 1 ELSE 0 END) AS pv,
        MAX((SELECT value.int_value FROM UNNEST(event_params) WHERE key='engagement_time_msec')) AS eng_msec
      FROM \`${projectId}.${dataset}.events_*\`
      WHERE _TABLE_SUFFIX BETWEEN
        FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL @daysBack DAY))
        AND FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY))
      GROUP BY dow_us, session_id
    )
    SELECT
      dow_us,
      COUNT(DISTINCT session_id) AS sessions,
      SUM(pv) AS pageviews,
      AVG(IFNULL(eng_msec, 0) / 1000.0) AS avg_engagement_sec
    FROM sessions
    GROUP BY dow_us
    ORDER BY dow_us
  `;

  try {
    const [rows] = await client.query({
      query: sql,
      params: { daysBack },
      location: 'US', // GA4 native export defaults to multi-region US
    });
    const data: DayOfWeekEngagement[] = rows.map((r) => {
      const isoDow = bqDayOfWeekToIso(Number(r.dow_us));
      return {
        dayOfWeek: isoDow,
        dayLabel: isoDayLabel(isoDow),
        sessions: Number(r.sessions),
        pageviews: Number(r.pageviews),
        avgEngagementSec: Number(r.avg_engagement_sec),
      };
    });
    return { ok: true, data: data.sort((a, b) => a.dayOfWeek - b.dayOfWeek) };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}
