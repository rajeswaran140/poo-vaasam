/**
 * Daily YouTube metrics history — the longitudinal store the statistical
 * analytics layer reads (changepoint / anomaly / forecast). It freezes a clean,
 * consistent per-day series so we don't depend on rolling API windows and can
 * detect a *real* reach shift vs daily noise.
 *
 *   PK = "METRICSNAP#<scope>"   scope = "CHANNEL" (per-video is a later increment)
 *   SK = "<YYYY-MM-DD>"          one point per day
 *
 * Capture is idempotent (put overwrites), so re-running for the last few days
 * upgrades YouTube's still-settling recent figures to their finalized values.
 *
 * The Analytics API already serves a historical daily series, so capture doubles
 * as BACKFILL: one call with a large `daysBack` seeds months of history at once
 * — we don't have to wait to accumulate it.
 */

import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';
import { fetchDailySeries, type Result } from '@/lib/youtube-analytics';

export const CHANNEL_SCOPE = 'CHANNEL';
const pkFor = (scope: string) => `METRICSNAP#${scope}`;
const nowIso = () => new Date().toISOString();

/** One finalized day of channel metrics. */
export interface DailyMetricPoint {
  scope: string;
  date: string; // YYYY-MM-DD the metrics are FOR
  views: number;
  estimatedMinutesWatched: number;
  subscribersGained: number;
  subscribersLost: number;
  /** Net subscriber change for the day (gained − lost). */
  netSubscribers: number;
  capturedAt: string; // provenance: when this row was last written
}

export interface CaptureResult {
  scope: string;
  daysCaptured: number;
  from: string | null;
  to: string | null;
}

/**
 * Fetch the channel's daily series for the trailing `daysBack` days and upsert
 * one point per day. Small `daysBack` (a daily cron) re-finalizes recent days;
 * large `daysBack` backfills history.
 */
export async function captureChannelMetrics(opts?: { daysBack?: number }): Promise<Result<CaptureResult>> {
  const daysBack = Math.max(1, Math.min(400, opts?.daysBack ?? 3));
  const series = await fetchDailySeries(daysBack);
  if (!series.ok) return series;

  const capturedAt = nowIso();
  const rows = series.data;
  await Promise.all(
    rows.map((r) => {
      const subscribersLost = r.subscribersLost ?? 0;
      return DynamoDBOperations.put({
        PK: pkFor(CHANNEL_SCOPE),
        SK: r.date,
        scope: CHANNEL_SCOPE,
        date: r.date,
        views: r.views,
        estimatedMinutesWatched: r.estimatedMinutesWatched,
        subscribersGained: r.subscribersGained,
        subscribersLost,
        netSubscribers: r.subscribersGained - subscribersLost,
        capturedAt,
      });
    })
  );

  const dates = rows.map((r) => r.date).sort();
  return {
    ok: true,
    data: {
      scope: CHANNEL_SCOPE,
      daysCaptured: rows.length,
      from: dates[0] ?? null,
      to: dates[dates.length - 1] ?? null,
    },
  };
}

/** Stored channel daily points, OLDEST→NEWEST (the order the stats layer wants). */
export async function readChannelMetricSeries(count = 180): Promise<DailyMetricPoint[]> {
  const res = await DynamoDBOperations.query({
    keyConditionExpression: 'PK = :pk',
    expressionAttributeValues: { ':pk': pkFor(CHANNEL_SCOPE) },
    scanIndexForward: false, // newest first from Dynamo…
    limit: count,
  });
  const items: DailyMetricPoint[] = (res.Items ?? []).map((it) => {
    const subscribersGained = Number(it.subscribersGained ?? 0);
    const subscribersLost = Number(it.subscribersLost ?? 0);
    return {
      scope: String(it.scope ?? CHANNEL_SCOPE),
      date: String(it.date ?? it.SK),
      views: Number(it.views ?? 0),
      estimatedMinutesWatched: Number(it.estimatedMinutesWatched ?? 0),
      subscribersGained,
      subscribersLost,
      // netSubscribers may predate the field for older rows → derive it.
      netSubscribers: it.netSubscribers != null ? Number(it.netSubscribers) : subscribersGained - subscribersLost,
      capturedAt: String(it.capturedAt ?? ''),
    };
  });
  // …return oldest→newest for time-series consumers.
  return items.sort((a, b) => a.date.localeCompare(b.date));
}
