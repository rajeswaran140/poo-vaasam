/**
 * GET /api/admin/youtube/channel-revenue-by-country?days=28
 *
 * Owner-scoped REVENUE by country for the WHOLE channel (no per-video filter).
 * Answers the "which markets pay this channel" question that the /admin/analytics
 * landing dashboard was missing — the existing per-video RevenueGeographyPanel
 * (inside PerSongDeepDive) only ever spoke about a single song.
 *
 * The derivation follows the same three rules as the per-video route
 * (lib/youtube-revenue-geography): per-country RPM is Σrevenue/Σviews on the
 * UNDIMENSIONED channel totals; the country rows are a distribution used only
 * for shares; small markets that bill without clearing YouTube's geo threshold
 * keep their revenue in the total but have RPM `null`, not zero.
 *
 * Admin-gated. 503 when Analytics OAuth isn't configured. A monetary-scope 403
 * from upstream surfaces as a 502 — silent zeros would read as "the channel
 * earns nothing", which is a different and wrong answer. The undimensioned
 * totals fetch is NON-FATAL: if it fails, the summary reports its rates as
 * country-attributed (see rule 4 in lib/youtube-revenue-geography) rather than
 * silently overstating them.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import {
  fetchChannelRevenueByCountry,
  fetchChannelRevenueTotals,
  isYouTubeAnalyticsConfigured,
} from '@/lib/youtube-analytics';
import { summarizeRevenueGeography } from '@/lib/youtube-revenue-geography';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  if (!isYouTubeAnalyticsConfigured()) {
    return NextResponse.json(
      { success: false, error: 'YOUTUBE_OAUTH_* env vars not configured' },
      { status: 503 }
    );
  }

  const daysRaw = Number(request.nextUrl.searchParams.get('days') ?? '28');
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(365, daysRaw)) : 28;

  const [geo, totals] = await Promise.all([
    fetchChannelRevenueByCountry(days),
    fetchChannelRevenueTotals(days),
  ]);

  if (!geo.ok) {
    return NextResponse.json({ success: false, error: geo.error }, { status: 502 });
  }

  // Non-fatal like the per-video route: without the undimensioned totals the
  // summary reports its rates as country-attributed rather than silently
  // overstating them (rule 4 in lib/youtube-revenue-geography).
  const channelTotals = totals.ok ? totals.data : undefined;
  const summary = summarizeRevenueGeography(geo.data, { videoTotals: channelTotals });

  return NextResponse.json({
    success: true,
    days,
    hasData: summary.rows.length > 0,
    ...summary,
  });
}
