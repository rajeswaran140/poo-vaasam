/**
 * GET /api/admin/youtube/analytics-health
 *
 * Status dot for the analytics panel header. Answers the one question the tiles
 * cannot: is the data still ARRIVING?
 *
 * The failure this exists for is silent. If the snapshot scheduler dies, no
 * error surfaces anywhere — the 48h tile just starts reporting a longer and
 * longer window, which reads as a data quirk rather than a dead cron. So the
 * snapshot stream gets an explicit dead-man check (stale past ~20 minutes)
 * rather than being inferred from a tile looking odd.
 *
 * Reads only; no Google calls, no quota spend.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { loadLatestSnapshot, snapshotFreshness } from '@/lib/youtube-realtime';
import { readQuota } from '@/lib/youtube-quota';
import { readChannelMetricSeries } from '@/lib/youtube-metrics-history';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const now = new Date();

  // Each source degrades on its own — a health endpoint that 500s is useless
  // precisely when it is needed.
  const [snapRes, dataQuotaRes, analyticsQuotaRes, seriesRes] = await Promise.allSettled([
    loadLatestSnapshot(),
    readQuota({ surface: 'data', now }),
    readQuota({ surface: 'analytics', now }),
    readChannelMetricSeries(400),
  ]);

  const latest = snapRes.status === 'fulfilled' ? snapRes.value : null;
  const freshness = snapshotFreshness(latest?.capturedAt ?? null, now);

  const series = seriesRes.status === 'fulfilled' ? seriesRes.value : [];
  const dates = series.map((p) => p.date).sort();
  const dailyMetrics = dates.length
    ? {
        days: dates.length,
        dataStart: dates[0],
        dataThroughDate: dates[dates.length - 1],
      }
    : { days: 0, dataStart: null, dataThroughDate: null };

  const quota = {
    data: dataQuotaRes.status === 'fulfilled' ? dataQuotaRes.value : null,
    analytics: analyticsQuotaRes.status === 'fulfilled' ? analyticsQuotaRes.value : null,
  };

  // Overall dot: the snapshot stream is the thing most likely to die quietly,
  // so it dominates. A tripped or degraded quota ledger is a warning, not an
  // outage — the panel still has data.
  const degradedLedger = Boolean(quota.data?.degraded || quota.analytics?.degraded);
  const quotaWarn = Boolean(quota.data?.warn || quota.analytics?.warn);
  const status =
    freshness.status === 'ok' && !degradedLedger && !quotaWarn
      ? 'ok'
      : freshness.status === 'never' || freshness.status === 'stale'
        ? 'error'
        : 'warn';

  return NextResponse.json(
    {
      status,
      snapshots: freshness,
      dailyMetrics,
      quota,
      checkedAt: now.toISOString(),
      notes:
        freshness.status === 'stale'
          ? `No channel snapshot for ${freshness.ageMinutes} minutes — the 5-minute scheduler is probably not running. The "views last 48h" tile will silently widen its window until this is fixed.`
          : freshness.status === 'never'
            ? 'No channel snapshot has ever been captured — the realtime tiles cannot render until the scheduler runs.'
            : null,
    },
    { headers: { 'Cache-Control': 'private, max-age=30' } }
  );
}
