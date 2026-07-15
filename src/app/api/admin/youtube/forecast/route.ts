/**
 * GET /api/admin/youtube/forecast?target=1000&window=14
 *
 * The statistical read on the channel: when do we cross <target> subscribers
 * (with a 95% band), is the recent views/subs move real vs noise, and when did
 * reach actually shift. Admin-gated. Composes the PURE stats in
 * lib/youtube-forecast over the stored daily METRICSNAP series + the live
 * subscriber count (Data API).
 *
 * Degrades rather than 500s:
 *   - series too short  → forecast null, change reads still returned
 *   - subscriber count unavailable → forecast null (can't anchor), rest returned
 *   - Analytics OAuth unset does NOT block this: it reads the STORED series, not
 *     the live Analytics API.
 *
 * The narrator (LLM) may only DESCRIBE this payload — every number here is
 * computed deterministically server-side.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { readChannelMetricSeries } from '@/lib/youtube-metrics-history';
import { fetchChannelStats } from '@/lib/youtube-api';
import {
  forecastToTarget,
  assessChange,
  detectLevelShift,
  DEFAULT_RATE_WINDOW,
} from '@/lib/youtube-forecast';
import { SITE } from '@/config/site';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_TARGET = 1000; // YPP Tier-2 subscriber gate

function clampInt(raw: string | null, def: number, min: number, max: number): number {
  if (raw == null || raw.trim() === '') return def; // absent → default (Number(null) is 0, a finite trap)
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : def;
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const params = request.nextUrl.searchParams;
  const target = clampInt(params.get('target'), DEFAULT_TARGET, 1, 100_000_000);
  const window = clampInt(params.get('window'), DEFAULT_RATE_WINDOW, 5, 90);

  // Stored series (independent of live Analytics) + live subscriber count.
  const [seriesRes, statsRes] = await Promise.allSettled([
    readChannelMetricSeries(180),
    fetchChannelStats(SITE.youtube.channelId),
  ]);

  const series = seriesRes.status === 'fulfilled' ? seriesRes.value : [];
  const stats = statsRes.status === 'fulfilled' ? statsRes.value : null;
  const current = stats ? stats.subscriberCount : null;

  // asOf anchors the ETA date. `current` is the live count, so "today" is right.
  const asOf = new Date().toISOString().slice(0, 10);

  const forecast =
    current != null
      ? forecastToTarget(series, { current, target, asOf, window })
      : null;

  return NextResponse.json({
    asOf,
    target,
    window,
    current,
    seriesDays: series.length,
    seriesFrom: series[0]?.date ?? null,
    seriesTo: series[series.length - 1]?.date ?? null,
    forecast,
    viewsChange: assessChange(series, { metric: 'views' }),
    subsChange: assessChange(series, { metric: 'netSubscribers' }),
    reachShift: detectLevelShift(series, { metric: 'views' }),
    // Surfaced so the client can show WHY a forecast is missing.
    notes: {
      forecastAvailable: forecast != null,
      subscriberCountAvailable: current != null,
      enoughHistory: series.length >= window,
    },
  });
}
