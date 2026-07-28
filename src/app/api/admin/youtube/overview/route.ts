/**
 * GET /api/admin/youtube/overview?range=28d
 *   or ?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Studio-parity Overview: window totals plus the period-over-period delta.
 *
 * Serves from our OWN stored series (METRICSNAP#CHANNEL), never from a live
 * Analytics call, so the panel never waits on Google and a Google outage
 * degrades to stale-but-present data. The window maths lives in
 * lib/youtube-overview and is pure; this route only fetches and shapes.
 *
 * TWO HONESTY GUARDS, both of which exist because the stored history is much
 * shorter than the range selector implies:
 *   - `insufficientHistory` when the comparison window would reach back before
 *     real data begins (2026-05-22). We return the flag and `availableFrom`
 *     rather than a zero-padded total that looks like a real answer.
 *   - `isPartial` + `dataThroughDate`, because Analytics lags 48-72h so the
 *     window ends on the last FINALIZED day, not today.
 *
 * Revenue is fetched SEPARATELY and is allowed to fail on its own: it needs the
 * monetary OAuth scope, which the current refresh token lacks, and mixing
 * monetary and non-monetary metrics in one query is the usual cause of a 403
 * that takes the whole payload down with it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { readChannelMetricSeries } from '@/lib/youtube-metrics-history';
import { fetchEstimatedRevenue } from '@/lib/youtube-analytics';
import { latestSubscriberAnchor } from '@/config/youtube-subscriber-anchor';
import {
  RANGE_DAYS,
  resolveWindow,
  resolveCustomWindow,
  summariseOverview,
  deriveExactSubscribers,
  isPartial,
  type RangeKey,
  type DailyPoint,
} from '@/lib/youtube-overview';

export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const params = request.nextUrl.searchParams;
  const rangeRaw = params.get('range') ?? '28d';
  const from = params.get('from');
  const to = params.get('to');

  const isCustom = rangeRaw === 'custom';
  if (!isCustom && !(rangeRaw in RANGE_DAYS)) {
    return NextResponse.json(
      { error: { code: 'BAD_RANGE', message: `range must be custom or one of ${Object.keys(RANGE_DAYS).join(', ')}` } },
      { status: 400 }
    );
  }
  if (isCustom && (!from || !to || !ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to)) {
    return NextResponse.json(
      { error: { code: 'BAD_CUSTOM_RANGE', message: 'custom range needs from/to as YYYY-MM-DD with from <= to' } },
      { status: 400 }
    );
  }

  try {
    // 400 days covers the widest range plus its comparison period.
    const series = await readChannelMetricSeries(400);
    if (!series.length) {
      return NextResponse.json(
        {
          error: {
            code: 'NO_STORED_METRICS',
            message: 'no METRICSNAP history yet — run the metrics snapshot capture',
            staleDataAvailable: false,
          },
        },
        { status: 503 }
      );
    }

    const points: DailyPoint[] = series.map((p) => ({
      date: p.date,
      views: p.views,
      estimatedMinutesWatched: p.estimatedMinutesWatched,
      subscribersGained: p.subscribersGained,
      subscribersLost: p.subscribersLost ?? 0,
    }));
    const dates = points.map((p) => p.date).sort();
    const dataStart = dates[0];
    const dataEnd = dates[dates.length - 1];

    const resolved = isCustom
      ? resolveCustomWindow(from as string, to as string, dataStart)
      : resolveWindow(rangeRaw as RangeKey, dataStart, dataEnd);

    const metrics = summariseOverview(points, resolved);

    // The anchor is deliberately NOT filtered by dataThroughDate: a fresh
    // Studio reading is normally NEWER than the finalized series, and filtering
    // it out would discard the only exact figure we have.
    const exact = deriveExactSubscribers(latestSubscriberAnchor(), points, dataEnd);

    // Revenue on its own, allowed to fail without taking the payload with it.
    let estimatedRevenue: { value: number; currency: string } | null = null;
    let revenueUnavailableReason: string | null = null;
    try {
      const rev = await fetchEstimatedRevenue(resolved.current.days);
      if (rev.ok) {
        estimatedRevenue = { value: rev.data.estimatedRevenue ?? 0, currency: 'USD' };
      } else {
        revenueUnavailableReason =
          rev.error ?? 'estimatedRevenue needs the yt-analytics-monetary.readonly scope';
      }
    } catch (err) {
      revenueUnavailableReason = err instanceof Error ? err.message : 'revenue fetch failed';
    }

    const today = new Date().toISOString().slice(0, 10);

    return NextResponse.json(
      {
        range: {
          key: resolved.range,
          from: resolved.current.from,
          to: resolved.current.to,
          days: resolved.current.days,
          previousFrom: resolved.previous.from,
          previousTo: resolved.previous.to,
        },
        metrics: { ...metrics, estimatedRevenue, revenueUnavailableReason },
        subscribers: exact,
        insufficientHistory: resolved.insufficientHistory,
        missingDays: resolved.missingDays,
        availableFrom: resolved.availableFrom,
        dataStart,
        dataThroughDate: dataEnd,
        isPartial: isPartial(dataEnd, today),
      },
      { headers: { 'Cache-Control': 'private, max-age=60' } }
    );
  } catch (err) {
    console.error('[yt-overview] failed:', err);
    return NextResponse.json(
      {
        error: {
          code: 'YT_OVERVIEW_UNAVAILABLE',
          message: err instanceof Error ? err.message : 'overview failed',
          staleDataAvailable: false,
        },
      },
      { status: 503 }
    );
  }
}
