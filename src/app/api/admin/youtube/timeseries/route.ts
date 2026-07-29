/**
 * GET /api/admin/youtube/timeseries?range=28d&metric=views
 *
 * Daily series for the panel's sparkline, served from our own stored
 * METRICSNAP history — no Google call, so it costs no quota and the chart
 * renders even during a YouTube outage.
 *
 * `isFinalized` is the point of this route. YouTube revises the trailing 2-3
 * days, and a provisional tail that dips looks exactly like a real decline —
 * which is the single most common misreading of this channel's dashboards.
 * Flagging each point lets the chart draw that tail dashed instead of letting
 * it masquerade as confirmed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { readChannelMetricSeries } from '@/lib/youtube-metrics-history';
import { RANGE_DAYS, type RangeKey } from '@/lib/youtube-overview';

export const dynamic = 'force-dynamic';

/** YouTube finalises roughly 3 days back; anything newer is still settling. */
const FINALIZED_LAG_DAYS = 3;

const METRICS = {
  views: (p: Point) => p.views,
  watchMinutes: (p: Point) => p.estimatedMinutesWatched,
  netSubscribers: (p: Point) => p.subscribersGained - (p.subscribersLost ?? 0),
} as const;
type MetricKey = keyof typeof METRICS;

interface Point {
  date: string;
  views: number;
  estimatedMinutesWatched: number;
  subscribersGained: number;
  subscribersLost?: number;
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const params = request.nextUrl.searchParams;
  const range = (params.get('range') ?? '28d') as RangeKey;
  const metric = (params.get('metric') ?? 'views') as MetricKey;

  if (!(range in RANGE_DAYS)) {
    return NextResponse.json(
      { error: { code: 'BAD_RANGE', message: `range must be one of ${Object.keys(RANGE_DAYS).join(', ')}` } },
      { status: 400 }
    );
  }
  if (!(metric in METRICS)) {
    return NextResponse.json(
      { error: { code: 'BAD_METRIC', message: `metric must be one of ${Object.keys(METRICS).join(', ')}` } },
      { status: 400 }
    );
  }

  try {
    const series = (await readChannelMetricSeries(400)) as Point[];
    if (!series.length) {
      return NextResponse.json({ metric, range, points: [], dataThroughDate: null });
    }

    const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
    const days = RANGE_DAYS[range];
    const window = sorted.slice(-days);

    const cutoff = new Date(Date.now() - FINALIZED_LAG_DAYS * 86_400_000).toISOString().slice(0, 10);
    const points = window.map((p) => ({
      date: p.date,
      value: METRICS[metric](p),
      isFinalized: p.date <= cutoff,
    }));

    return NextResponse.json(
      {
        metric,
        range,
        points,
        dataThroughDate: sorted[sorted.length - 1].date,
      },
      { headers: { 'Cache-Control': 'private, max-age=60' } }
    );
  } catch (err) {
    console.error('[yt-timeseries] failed:', err);
    return NextResponse.json(
      {
        error: {
          code: 'YT_TIMESERIES_UNAVAILABLE',
          message: err instanceof Error ? err.message : 'timeseries failed',
          staleDataAvailable: false,
        },
      },
      { status: 503 }
    );
  }
}
