/**
 * GET /api/admin/analytics?days=28
 *
 * Website-analytics for the admin portal. Aggregates:
 *  - GA4 (Data API): traffic snapshot + daily timeseries, top pages, traffic
 *    sources, geography, devices, and the tracked user activities (audio plays,
 *    subscribe clicks, YouTube opens).
 *  - First-party: per-content view counts from DynamoDB (independent of GA4).
 *
 * Admin-gated. When GA4 isn't configured it returns `ga4Configured:false` and
 * still serves the first-party section, so the dashboard renders a config
 * banner instead of failing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import {
  isGA4Configured,
  fetchTrafficSnapshot,
  fetchTrafficTimeseries,
  fetchTopPages,
  fetchTrafficSources,
  fetchGeo,
  fetchDevices,
  fetchAudioPlays,
  fetchSubscribeClicksBySource,
  fetchYouTubeOpens,
  type Result,
} from '@/lib/ga4-api';
import { fetchContentViewSummary, type ContentViewSummary } from '@/lib/site-analytics';
import { fetchEventSummary, type EventSummary } from '@/lib/analytics-store';

export const dynamic = 'force-dynamic';

/** Flatten a Result into a UI-friendly `{ data }` or `{ error }`. */
function unwrap<T>(r: Result<T>): { data: T } | { error: string } {
  return r.ok ? { data: r.data } : { error: r.error };
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const daysParam = Number(request.nextUrl.searchParams.get('days') ?? '28');
  const days = Number.isFinite(daysParam) ? Math.max(1, Math.min(90, daysParam)) : 28;

  // First-party signals — independent of GA4, so fetch regardless. Content
  // views accrue from the view beacon; events from the /api/events beacon
  // (ad-block-resilient plays/shares/outbound clicks).
  let contentViews: ContentViewSummary | null = null;
  try {
    contentViews = await fetchContentViewSummary(10);
  } catch (err) {
    console.error('[analytics] first-party content views failed:', err);
  }
  let events: EventSummary | null = null;
  try {
    events = await fetchEventSummary(days, 8);
  } catch (err) {
    console.error('[analytics] first-party events failed:', err);
  }

  if (!isGA4Configured()) {
    return NextResponse.json({ success: true, ga4Configured: false, days, contentViews, events, ga4: null });
  }

  const [snapshot, timeseries, topPages, sources, geo, devices, audioPlays, subscribeClicks, youtubeOpens] =
    await Promise.all([
      fetchTrafficSnapshot(days),
      fetchTrafficTimeseries(days),
      fetchTopPages(days),
      fetchTrafficSources(days),
      fetchGeo(days),
      fetchDevices(days),
      fetchAudioPlays(days),
      fetchSubscribeClicksBySource(days),
      fetchYouTubeOpens(days),
    ]);

  return NextResponse.json({
    success: true,
    ga4Configured: true,
    days,
    contentViews,
    events,
    ga4: {
      snapshot: unwrap(snapshot),
      timeseries: unwrap(timeseries),
      topPages: unwrap(topPages),
      sources: unwrap(sources),
      geo: unwrap(geo),
      devices: unwrap(devices),
      audioPlays: unwrap(audioPlays),
      subscribeClicks: unwrap(subscribeClicks),
      youtubeOpens: unwrap(youtubeOpens),
    },
  });
}
