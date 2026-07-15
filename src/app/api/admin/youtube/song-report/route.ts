/**
 * GET /api/admin/youtube/song-report?videoId=<id>
 *
 * The consolidated per-song LIFECYCLE report — the self-serve form of the manual
 * song write-ups: lifetime summary, weekly lifecycle, traffic-source trend (the
 * impression proxy), subscribed-vs-stranger retention, device mix, share rate,
 * and a decline DIAGNOSIS (reach cool-down vs engagement problem).
 *
 * Admin-gated. 503 when Analytics OAuth is unconfigured. Every upstream read is
 * best-effort (Promise.allSettled) so one failure degrades a section rather than
 * 500ing the report; the pure builder (lib/youtube-song-report) tolerates the
 * missing pieces (e.g. totals=null → summary omitted).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import {
  isYouTubeAnalyticsConfigured,
  dateRange,
  fetchVideoDailySeries,
  fetchVideoTotals,
  fetchVideoTrafficSources,
  fetchVideoSubscribedSplit,
  fetchVideoDeviceMix,
} from '@/lib/youtube-analytics';
import { fetchVideoStatsById } from '@/lib/youtube-api';
import { isValidYouTubeId } from '@/lib/youtube-api';
import { buildSongReport, type SongReportInput } from '@/lib/youtube-song-report';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Enough to span any song's whole life; capped for quota safety.
const LIFETIME_DAYS = 400;

function unwrap<T>(r: PromiseSettledResult<{ ok: true; data: T } | { ok: false; error: string }>, fallback: T): T {
  if (r.status !== 'fulfilled') return fallback;
  return r.value.ok ? r.value.data : fallback;
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const videoId = request.nextUrl.searchParams.get('videoId')?.trim() ?? '';
  if (!isValidYouTubeId(videoId)) {
    return NextResponse.json({ success: false, error: 'valid videoId is required' }, { status: 400 });
  }
  if (!isYouTubeAnalyticsConfigured()) {
    return NextResponse.json(
      { success: false, error: 'YouTube Analytics OAuth not configured' },
      { status: 503 }
    );
  }

  // Need the upload date to bucket weeks and to window the lifetime totals.
  const meta = await fetchVideoStatsById(videoId);
  if (!meta || !meta.publishedAt) {
    return NextResponse.json({ success: false, error: 'video not found' }, { status: 404 });
  }

  const asOf = new Date().toISOString().slice(0, 10);
  const lifetime = dateRange(LIFETIME_DAYS); // {startDate, endDate=yesterday}
  const startDate = meta.publishedAt.slice(0, 10); // don't fetch before upload
  const recent = dateRange(7); // trailing 7d ending yesterday
  const prior = { startDate: dateRange(14).startDate, endDate: dateRange(8).endDate }; // the 7d before that

  const [totalsR, dailyR, srcLifeR, srcRecentR, srcPriorR, subR, devR] = await Promise.allSettled([
    fetchVideoTotals(videoId, startDate, lifetime.endDate),
    fetchVideoDailySeries(videoId, LIFETIME_DAYS),
    fetchVideoTrafficSources(videoId, startDate, lifetime.endDate),
    fetchVideoTrafficSources(videoId, recent.startDate, recent.endDate),
    fetchVideoTrafficSources(videoId, prior.startDate, prior.endDate),
    fetchVideoSubscribedSplit(videoId, startDate, lifetime.endDate),
    fetchVideoDeviceMix(videoId, startDate, lifetime.endDate),
  ]);

  const dailyRaw = unwrap(dailyR, []);
  const input: SongReportInput = {
    videoId,
    title: meta.title,
    publishedAt: meta.publishedAt,
    durationSeconds: meta.durationSeconds,
    asOf,
    totals: unwrap<SongReportInput['totals']>(totalsR, null),
    daily: dailyRaw.map((d) => ({
      date: d.date,
      views: d.views,
      subscribersGained: d.subscribersGained,
      averageViewPercentage: d.averageViewPercentage ?? 0,
    })),
    sourcesLifetime: unwrap(srcLifeR, []),
    sourcesRecent: unwrap(srcRecentR, []),
    sourcesPrior: unwrap(srcPriorR, []),
    subscribedSplit: unwrap(subR, []),
    deviceMix: unwrap(devR, []).map((d) => ({ device: d.device, views: d.views })),
  };

  return NextResponse.json({ success: true, report: buildSongReport(input) });
}
