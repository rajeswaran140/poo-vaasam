/**
 * Per-song LIFECYCLE REPORT builder — the consolidated "how is this song doing,
 * and is the decline a problem?" report, as a pure function over already-fetched
 * analytics. This is the code form of the per-song write-ups: weekly lifecycle,
 * the traffic-source trend (our stand-in for Studio-only impressions), the
 * subscribed-vs-stranger retention split, device mix, share rate, and a decline
 * DIAGNOSIS (reach cool-down vs engagement problem).
 *
 * Pure + deterministic (asOf passed in) so it unit-tests exactly and an LLM can
 * only DESCRIBE the result. The network fetches live in youtube-analytics; the
 * route composes them and hands the raw rows here.
 *
 * Honesty guards:
 *  - Impressions/CTR are Studio-only; we NEVER claim to report them. The traffic
 *    source trend (Suggested/Related views over time) is labelled a PROXY.
 *  - The decline verdict requires retention data to distinguish a healthy reach
 *    cool-down (views down, retention up) from a real engagement decline (both
 *    down). With retention unknown it stays 'indeterminate', never a false OK.
 */

import { assessChange, type SeriesPoint } from '@/lib/youtube-forecast';

// ── inputs (raw analytics rows the route fetches) ──────────────────────────────

export interface SongDailyPoint {
  date: string; // YYYY-MM-DD
  views: number;
  subscribersGained: number;
  averageViewPercentage: number; // 0..100
}
export interface SourceViews {
  source: string; // insightTrafficSourceType value, e.g. RELATED_VIDEO
  views: number;
}
export interface SubscribedRow {
  status: 'SUBSCRIBED' | 'UNSUBSCRIBED' | string;
  views: number;
  averageViewPercentage: number;
}
export interface DeviceRow {
  device: string; // MOBILE / DESKTOP / TV / TABLET
  views: number;
}
export interface SongTotals {
  views: number;
  estimatedMinutesWatched: number;
  averageViewDuration: number; // seconds
  averageViewPercentage: number;
  subscribersGained: number;
  subscribersLost: number;
  likes: number;
  comments: number;
  shares: number;
}

export interface SongReportInput {
  videoId: string;
  title: string;
  publishedAt: string; // ISO 8601
  durationSeconds: number;
  asOf: string; // YYYY-MM-DD
  totals: SongTotals | null;
  daily: SongDailyPoint[]; // per-song daily, oldest→newest not required
  sourcesLifetime: SourceViews[];
  sourcesRecent: SourceViews[]; // trailing 7d ending yesterday
  sourcesPrior: SourceViews[]; // the 7d before that
  subscribedSplit: SubscribedRow[];
  deviceMix: DeviceRow[];
}

// Canonical source keys we reason about explicitly.
const SUGGESTED = 'RELATED_VIDEO';
const PLAYLIST = 'PLAYLIST';
const SUBSCRIBER = 'SUBSCRIBER';

// ── outputs ────────────────────────────────────────────────────────────────────

export interface WeekBucket {
  week: number; // 1-based weeks since upload
  from: string;
  to: string;
  views: number;
  subscribersGained: number;
  averageViewPercentage: number; // view-weighted
}

export interface SourceTrendRow {
  source: string;
  lifetimeViews: number;
  lifetimePct: number; // share of lifetime views
  recentViews: number;
  priorViews: number;
  deltaPct: number | null; // recent vs prior; null when prior is 0
}

export interface SourceTrend {
  rows: SourceTrendRow[]; // sorted by lifetime views desc
  suggestedDeltaPct: number | null;
  ownedSharePct: number; // (SUBSCRIBER + PLAYLIST) / lifetime — the "floor"
  rentedSharePct: number; // RELATED_VIDEO / lifetime
  floor: 'durable' | 'moderate' | 'thin';
}

export interface SubscribedSplit {
  subscribedViews: number;
  subscribedRetention: number | null;
  unsubscribedViews: number;
  unsubscribedRetention: number | null;
  retentionGap: number | null; // subscribed − unsubscribed (pp)
}

export type DeclineVerdict =
  | 'reach-cooldown' // views down, retention holding/up → healthy distribution taper
  | 'engagement-decline' // views down AND retention down → investigate
  | 'stable' // views not significantly down
  | 'indeterminate'; // not enough signal (e.g. no retention data)

export interface Diagnosis {
  verdict: DeclineVerdict;
  headline: string;
  detail: string;
  viewsSignificantlyDown: boolean;
  retentionTrend: 'rising' | 'flat' | 'falling' | 'unknown';
}

export interface SongReport {
  videoId: string;
  title: string;
  publishedAt: string;
  asOf: string;
  ageDays: number;
  durationSeconds: number;
  summary: {
    views: number;
    watchHours: number;
    averageViewDuration: number;
    averageViewPercentage: number;
    netSubscribers: number;
    subscribersLost: number;
    likes: number;
    comments: number;
    shares: number;
    shareRatePer1k: number | null;
  } | null;
  weekly: WeekBucket[];
  sourceTrend: SourceTrend;
  subscribedSplit: SubscribedSplit;
  deviceMix: Array<{ device: string; views: number; pct: number }>;
  diagnosis: Diagnosis;
  impressionsCaveat: string;
}

export const IMPRESSIONS_CAVEAT =
  'Impressions and click-through rate are Studio-only — the Analytics API does not expose them. ' +
  'The traffic-source trend below (Suggested/Related views over time) is the faithful proxy for the impression trend.';

// ── helpers ────────────────────────────────────────────────────────────────────

function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(`${aIso.slice(0, 10)}T00:00:00.000Z`).getTime();
  const b = new Date(`${bIso.slice(0, 10)}T00:00:00.000Z`).getTime();
  return Math.floor((b - a) / 86_400_000);
}

/** Bucket the per-song daily series into 1-based weeks since upload. */
export function bucketByWeek(daily: SongDailyPoint[], publishedAt: string): WeekBucket[] {
  const pub = publishedAt.slice(0, 10);
  const byWeek = new Map<number, SongDailyPoint[]>();
  for (const p of daily) {
    const wk = Math.floor(daysBetween(pub, p.date) / 7);
    if (wk < 0) continue; // guard: data before the upload date
    (byWeek.get(wk) ?? byWeek.set(wk, []).get(wk)!).push(p);
  }
  return [...byWeek.keys()]
    .sort((a, b) => a - b)
    .map((wk) => {
      const pts = byWeek.get(wk)!;
      const dates = pts.map((p) => p.date).sort();
      const views = pts.reduce((s, p) => s + p.views, 0);
      const wsum = pts.reduce((s, p) => s + p.views * p.averageViewPercentage, 0);
      return {
        week: wk + 1,
        from: dates[0],
        to: dates[dates.length - 1],
        views,
        subscribersGained: pts.reduce((s, p) => s + p.subscribersGained, 0),
        averageViewPercentage: views > 0 ? wsum / views : 0,
      };
    });
}

function sumViews(rows: SourceViews[]): number {
  return rows.reduce((s, r) => s + r.views, 0);
}

export function computeSourceTrend(
  lifetime: SourceViews[],
  recent: SourceViews[],
  prior: SourceViews[]
): SourceTrend {
  const total = sumViews(lifetime) || 1;
  const recMap = new Map(recent.map((r) => [r.source, r.views]));
  const priMap = new Map(prior.map((r) => [r.source, r.views]));
  const rows: SourceTrendRow[] = lifetime
    .slice()
    .sort((a, b) => b.views - a.views)
    .map((r) => {
      const recentViews = recMap.get(r.source) ?? 0;
      const priorViews = priMap.get(r.source) ?? 0;
      return {
        source: r.source,
        lifetimeViews: r.views,
        lifetimePct: (r.views / total) * 100,
        recentViews,
        priorViews,
        deltaPct: priorViews > 0 ? ((recentViews - priorViews) / priorViews) * 100 : null,
      };
    });
  const lifeMap = new Map(lifetime.map((r) => [r.source, r.views]));
  const owned = (lifeMap.get(SUBSCRIBER) ?? 0) + (lifeMap.get(PLAYLIST) ?? 0);
  const ownedSharePct = (owned / total) * 100;
  const rentedSharePct = ((lifeMap.get(SUGGESTED) ?? 0) / total) * 100;
  const floor: SourceTrend['floor'] =
    ownedSharePct >= 30 ? 'durable' : ownedSharePct >= 15 ? 'moderate' : 'thin';
  return {
    rows,
    suggestedDeltaPct: rows.find((r) => r.source === SUGGESTED)?.deltaPct ?? null,
    ownedSharePct,
    rentedSharePct,
    floor,
  };
}

export function computeSubscribedSplit(rows: SubscribedRow[]): SubscribedSplit {
  const sub = rows.find((r) => r.status === 'SUBSCRIBED');
  const uns = rows.find((r) => r.status === 'UNSUBSCRIBED');
  const sR = sub ? sub.averageViewPercentage : null;
  const uR = uns ? uns.averageViewPercentage : null;
  return {
    subscribedViews: sub?.views ?? 0,
    subscribedRetention: sR,
    unsubscribedViews: uns?.views ?? 0,
    unsubscribedRetention: uR,
    retentionGap: sR != null && uR != null ? sR - uR : null,
  };
}

/**
 * Retention trend across the song's life: compare the view-weighted average-view
 * of the FIRST third of weeks vs the LAST third (min 1 week each). Rising =
 * viewers who arrive late watch more — the healthy-taper signature.
 */
function retentionTrend(weekly: WeekBucket[]): Diagnosis['retentionTrend'] {
  if (weekly.length < 2) return 'unknown';
  const first = weekly[0].averageViewPercentage;
  const last = weekly[weekly.length - 1].averageViewPercentage;
  const delta = last - first;
  if (delta > 3) return 'rising';
  if (delta < -3) return 'falling';
  return 'flat';
}

export function diagnose(
  daily: SongDailyPoint[],
  weekly: WeekBucket[],
  sourceTrend: SourceTrend
): Diagnosis {
  const series: SeriesPoint[] = daily
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => ({ date: p.date, views: p.views, netSubscribers: p.subscribersGained }));
  const viewsChange = assessChange(series, { metric: 'views' });
  const down = Boolean(viewsChange?.significant && viewsChange.direction === 'down');
  const rTrend = retentionTrend(weekly);

  if (!down) {
    return {
      verdict: 'stable',
      headline: 'Stable — views are not significantly down',
      detail:
        'The recent view level is within normal variation of the prior window; no decline to explain.',
      viewsSignificantlyDown: false,
      retentionTrend: rTrend,
    };
  }
  if (rTrend === 'unknown') {
    return {
      verdict: 'indeterminate',
      headline: 'Views down — not enough retention history to classify',
      detail: 'Views fell but there is too little weekly history to tell a reach taper from an engagement drop.',
      viewsSignificantlyDown: true,
      retentionTrend: rTrend,
    };
  }
  if (rTrend === 'falling') {
    return {
      verdict: 'engagement-decline',
      headline: 'Engagement decline — views AND retention are down',
      detail:
        'Both reach and how much people watch are falling together. This is the pattern worth investigating (hook, topic fit).',
      viewsSignificantlyDown: true,
      retentionTrend: rTrend,
    };
  }
  // views down, retention holding or rising → healthy distribution taper
  const sd = sourceTrend.suggestedDeltaPct;
  const sdText = sd != null ? ` Suggested-feed views are ${sd >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(sd))}% recent-vs-prior` : '';
  return {
    verdict: 'reach-cooldown',
    headline: 'Healthy reach cool-down — distribution receding, engagement strong',
    detail:
      `Views fell but retention is ${rTrend}, so viewers who arrive still watch — the algorithm is simply showing it to fewer new people as it ages.${sdText}. Not a content problem.`,
    viewsSignificantlyDown: true,
    retentionTrend: rTrend,
  };
}

/** Assemble the full per-song lifecycle report. Pure. */
export function buildSongReport(input: SongReportInput): SongReport {
  const weekly = bucketByWeek(input.daily, input.publishedAt);
  const sourceTrend = computeSourceTrend(input.sourcesLifetime, input.sourcesRecent, input.sourcesPrior);
  const subscribedSplit = computeSubscribedSplit(input.subscribedSplit);
  const diagnosis = diagnose(input.daily, weekly, sourceTrend);

  const devTotal = sumViews(input.deviceMix.map((d) => ({ source: d.device, views: d.views }))) || 1;
  const deviceMix = input.deviceMix
    .slice()
    .sort((a, b) => b.views - a.views)
    .map((d) => ({ device: d.device, views: d.views, pct: (d.views / devTotal) * 100 }));

  const t = input.totals;
  const summary = t
    ? {
        views: t.views,
        watchHours: t.estimatedMinutesWatched / 60,
        averageViewDuration: t.averageViewDuration,
        averageViewPercentage: t.averageViewPercentage,
        netSubscribers: t.subscribersGained - t.subscribersLost,
        subscribersLost: t.subscribersLost,
        likes: t.likes,
        comments: t.comments,
        shares: t.shares,
        shareRatePer1k: t.views > 0 ? (t.shares / t.views) * 1000 : null,
      }
    : null;

  return {
    videoId: input.videoId,
    title: input.title,
    publishedAt: input.publishedAt,
    asOf: input.asOf,
    ageDays: daysBetween(input.publishedAt, input.asOf),
    durationSeconds: input.durationSeconds,
    summary,
    weekly,
    sourceTrend,
    subscribedSplit,
    deviceMix,
    diagnosis,
    impressionsCaveat: IMPRESSIONS_CAVEAT,
  };
}
