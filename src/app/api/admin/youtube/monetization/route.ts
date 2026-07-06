/**
 * GET /api/admin/youtube/monetization
 *
 * YouTube Partner Program (YPP) gate tracker + estimated-revenue line for the
 * admin analytics dashboard. Admin-gated. Aggregates three independent sources,
 * each degrading on its own so one failure never sinks the panel:
 *   - subscribers      — public Data API (fetchChannelStats / YOUTUBE_API_KEY)
 *   - watchHours365     — owner Analytics 365-day snapshot (estMin/60)
 *   - pace              — owner Analytics 28-day snapshot (per-day net subs + hrs)
 *   - revenue           — owner Analytics estimatedRevenue (REQUIRES the monetary
 *                         scope; 403s until Raj re-auths → passed through as
 *                         { ok:false } so the panel shows a re-auth note)
 *
 * Never 500s on a partial upstream failure — missing fields degrade to null and
 * the client renders what it has. Unlike the other youtube routes this one does
 * NOT 503 when Analytics OAuth is unset: subscriber count (Data API) alone still
 * powers the subs half of the gate, so we return it with `configured:false`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import {
  fetchChannelAnalyticsSnapshot,
  fetchEstimatedRevenue,
  isYouTubeAnalyticsConfigured,
} from '@/lib/youtube-analytics';
import { fetchChannelStats } from '@/lib/youtube-api';
import { computeYppGates } from '@/lib/ypp-gates';
import { SITE } from '@/config/site';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const configured = isYouTubeAnalyticsConfigured();

  // All four reads are best-effort and independent. Promise.allSettled so a
  // rejection in any single upstream call can't reject the whole handler.
  const [statsRes, yearRes, recentRes, revenueRes] = await Promise.allSettled([
    fetchChannelStats(SITE.youtube.channelId),
    fetchChannelAnalyticsSnapshot(365),
    fetchChannelAnalyticsSnapshot(28),
    fetchEstimatedRevenue(28),
  ]);

  const stats = statsRes.status === 'fulfilled' ? statsRes.value : null;
  const subscribers = stats ? stats.subscriberCount : null;

  const year = yearRes.status === 'fulfilled' ? yearRes.value : null;
  const watchHours365 =
    year && year.ok ? Math.round(year.data.estimatedMinutesWatched / 60) : null;

  const recent = recentRes.status === 'fulfilled' ? recentRes.value : null;
  const pace =
    recent && recent.ok
      ? {
          netSubsPerDay: (recent.data.subscribersGained - recent.data.subscribersLost) / 28,
          watchHoursPerDay: recent.data.estimatedMinutesWatched / 60 / 28,
        }
      : null;

  // Pass the revenue Result straight through ({ ok, data | error }); a 403 for
  // the missing monetary scope arrives here as { ok:false } — expected, not an error.
  const revenue =
    revenueRes.status === 'fulfilled'
      ? revenueRes.value
      : { ok: false as const, error: 'Revenue lookup failed' };

  // Gates need a subscriber count; watch-hours + pace degrade to 0 so the subs
  // axis still tracks even when Analytics OAuth isn't wired up yet.
  const gates =
    subscribers != null
      ? computeYppGates({
          subscribers,
          watchHours365: watchHours365 ?? 0,
          netSubsPerDay: pace?.netSubsPerDay ?? 0,
          watchHoursPerDay: pace?.watchHoursPerDay ?? 0,
        })
      : null;

  return NextResponse.json({
    success: true,
    configured,
    subscribers,
    watchHours365,
    pace,
    gates,
    revenue,
  });
}
