/**
 * Pure helpers for the /admin/youtube "Weekly digest + anomaly alerts" feature.
 *
 * Turns a daily analytics series + this week's per-video rows into:
 *   - week-over-week growth (views / subs / watch-time)
 *   - a view-trend anomaly classification that distinguishes a genuine decline
 *     from a stall (which is often just counter-lag, not a real drop — the
 *     exact confusion that keeps causing false alarms)
 *   - this week's top videos
 *   - a one-line headline
 *
 * All pure (no network) so the digest math is exhaustively unit-testable and
 * runs the same on the server, the API route, and a scheduled job.
 */

import type { VideoAnalyticsRow } from '@/lib/youtube-analytics';

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  views: number;
  subscribersGained: number;
  estimatedMinutesWatched: number;
}

export interface Metric {
  current: number;
  prior: number;
  deltaPct: number | null; // null when prior is 0 (no baseline)
}

export interface WeekOverWeek {
  views: Metric;
  subscribersGained: Metric;
  watchTimeMinutes: Metric;
}

export type AnomalyStatus = 'normal' | 'surging' | 'cooling' | 'stalled' | 'insufficient';

export interface Anomaly {
  status: AnomalyStatus;
  recentAvg: number;
  baselineAvg: number;
  message: string;
}

export interface TopVideo {
  videoId: string;
  views: number;
  subscribersGained: number;
}

export interface Digest {
  weekOverWeek: WeekOverWeek;
  anomaly: Anomaly;
  topByViews: TopVideo[];
  topBySubs: TopVideo[];
  headline: string;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;

function metric(current: number, prior: number, hasBaseline = true): Metric {
  return {
    current,
    prior,
    deltaPct: hasBaseline && prior > 0 ? round1(((current - prior) / prior) * 100) : null,
  };
}

/**
 * Fill gaps in an ascending daily series with zero-value days. YouTube's `day`
 * dimension omits zero-activity days, which would otherwise let a 7-element
 * `slice` span more than 7 calendar days and skew the week boundaries.
 */
export function densifyDaily(series: DailyPoint[]): DailyPoint[] {
  if (series.length < 2) return [...series];
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(sorted.map((d) => [d.date, d]));
  const out: DailyPoint[] = [];
  const cur = new Date(`${sorted[0].date}T00:00:00Z`);
  const end = new Date(`${sorted[sorted.length - 1].date}T00:00:00Z`);
  while (cur <= end) {
    const key = cur.toISOString().slice(0, 10);
    out.push(
      byDate.get(key) ?? { date: key, views: 0, subscribersGained: 0, estimatedMinutesWatched: 0 }
    );
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/**
 * Last 7 days vs the 7 days before, from an ascending-by-date daily series.
 * When there aren't a full 7 prior days, deltaPct is null (no baseline) rather
 * than comparing against a short window — which would report a false swing.
 */
export function summarizeWeekOverWeek(series: DailyPoint[]): WeekOverWeek {
  const last7 = series.slice(-7);
  const prev7 = series.slice(-14, -7);
  const hasBaseline = prev7.length === 7;
  return {
    views: metric(sum(last7.map((d) => d.views)), sum(prev7.map((d) => d.views)), hasBaseline),
    subscribersGained: metric(
      sum(last7.map((d) => d.subscribersGained)),
      sum(prev7.map((d) => d.subscribersGained)),
      hasBaseline
    ),
    watchTimeMinutes: metric(
      Math.round(sum(last7.map((d) => d.estimatedMinutesWatched))),
      Math.round(sum(prev7.map((d) => d.estimatedMinutesWatched))),
      hasBaseline
    ),
  };
}

/**
 * Classify a daily-views trend. The key case is 'stalled' — recent days near
 * zero after real activity — which is frequently YouTube's channel-total
 * counter LAG rather than a true drop, so the message says to verify per-video
 * before alarming. Needs ≥7 days; the last 3 are "recent", the rest "baseline".
 */
export function detectViewAnomaly(dailyViews: number[]): Anomaly {
  if (dailyViews.length < 7) {
    return { status: 'insufficient', recentAvg: 0, baselineAvg: 0, message: 'Not enough history yet (need ≥7 days).' };
  }
  const recent = dailyViews.slice(-3);
  const baseline = dailyViews.slice(0, -3);
  const recentAvg = round1(mean(recent));
  const baselineAvg = round1(mean(baseline));

  if (baselineAvg >= 5 && recentAvg <= baselineAvg * 0.15) {
    return {
      status: 'stalled',
      recentAvg,
      baselineAvg,
      message: `Views look stalled (~${recentAvg}/day vs ~${baselineAvg}/day baseline). Often this is channel-total counter LAG, not a real drop — verify by summing per-video counts before worrying.`,
    };
  }
  if (recentAvg >= baselineAvg * 1.6 && recentAvg - baselineAvg >= 5) {
    return { status: 'surging', recentAvg, baselineAvg, message: `Views surging (~${recentAvg}/day vs ~${baselineAvg}/day baseline).` };
  }
  if (baselineAvg >= 5 && recentAvg <= baselineAvg * 0.5) {
    return { status: 'cooling', recentAvg, baselineAvg, message: `Views cooling (~${recentAvg}/day vs ~${baselineAvg}/day baseline) — normal post-upload decay if no new release.` };
  }
  return { status: 'normal', recentAvg, baselineAvg, message: `Views steady (~${recentAvg}/day vs ~${baselineAvg}/day baseline).` };
}

function topN(videos: VideoAnalyticsRow[], key: (v: VideoAnalyticsRow) => number, n: number): TopVideo[] {
  return [...videos]
    .sort((a, b) => key(b) - key(a))
    .slice(0, n)
    .map((v) => ({ videoId: v.videoId, views: v.views, subscribersGained: v.subscribersGained }));
}

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

function headlineFor(wow: WeekOverWeek, anomaly: Anomaly): string {
  if (anomaly.status === 'stalled') {
    return '⚠ Views have stalled this week — likely counter-lag, verify per-video before alarming.';
  }
  const v = wow.views;
  const viewsPart = v.deltaPct == null ? `${v.current} views` : `Views ${signed(v.deltaPct)}% WoW`;
  return `${viewsPart} · ${signed(wow.subscribersGained.current)} subs · ${wow.watchTimeMinutes.current} min watched`;
}

/** Assemble the full weekly digest. */
export function buildDigest(series: DailyPoint[], weekVideos: VideoAnalyticsRow[]): Digest {
  // Densify first so week/anomaly windows count calendar days, not row count.
  const dense = densifyDaily(series);
  const weekOverWeek = summarizeWeekOverWeek(dense);
  const anomaly = detectViewAnomaly(dense.map((d) => d.views));
  return {
    weekOverWeek,
    anomaly,
    topByViews: topN(weekVideos, (v) => v.views, 5),
    topBySubs: topN(weekVideos, (v) => v.subscribersGained, 5),
    headline: headlineFor(weekOverWeek, anomaly),
  };
}
