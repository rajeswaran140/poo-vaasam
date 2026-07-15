/**
 * Publish Advisor — answers the one question Raj asks more than any other,
 * "should I upload now?", as a single deterministic recommendation: a verdict,
 * a target slot, a confidence, and the reasons behind it.
 *
 * It does NOT invent judgement — it composes signals that already exist:
 *  - the Friday → India-weekend timing heuristic (the "when"),
 *  - the reach-watch read: is suggested reach draining toward baseline?,
 *  - the satisfaction read: is top-video retention healthy / falling?,
 *  - momentum: net-sub pace + distance to the Tier-2 gate,
 *  - recency: did we JUST publish (don't split the algorithm's attention)?
 *
 * PURE + deterministic: no clock (asOf is passed in), no I/O, no LLM. The
 * reasons are deterministic templates, not model output, so the verdict is
 * always reproducible and auditable. The route gathers the inputs from the
 * existing Analytics helpers and hands them here.
 *
 * The reach-vs-satisfaction split is load-bearing (see the channel-status-
 * framing guidance): a reach dip with HEALTHY retention → ship a hero upload to
 * re-fuel suggested; a reach dip with FALLING retention → fix the content first,
 * because more reach can't cure a watch-time problem.
 */

import { assessChange, type SeriesPoint } from '@/lib/youtube-forecast';
import { isShort } from '@/lib/youtube-shorts';
import { ageInDays } from '@/lib/youtube-outliers';

export type Verdict = 'ship-now' | 'on-schedule' | 'let-it-ride' | 'hold-fix-content';

export interface AdvisorInput {
  asOf: string; // YYYY-MM-DD (today)
  recentViewsPerDay: number; // mean daily views over the recent finalized window
  baselineViewsPerDay?: number; // pre-surge baseline; default 5000
  viewsDeclining?: boolean; // significant downward view trend (from assessChange)
  suggestedDropPct?: number | null; // RELATED_VIDEO recent-vs-prior drop, 0..1 (neg = grew)
  topRetention?: number | null; // top-video averageViewPercentage; null if unknown
  priorTopRetention?: number | null; // prior read; null → can't detect a fall
  netSubsPerDay?: number | null;
  subsToTier2?: number | null; // subs remaining to 1,000 (null once cleared)
  daysSinceLastUpload?: number | null;
}

export interface AdvisorSignals {
  reachDraining: boolean;
  viewsNearBaseline: boolean;
  retentionKnown: boolean;
  retentionHealthy: boolean;
  retentionFalling: boolean;
  retentionFallPct: number | null;
  recentlyPublished: boolean;
  subsGrowing: boolean;
  reachSurging: boolean;
}

export interface Advice {
  verdict: Verdict;
  headline: string;
  recommendedDate: string | null; // YYYY-MM-DD of the target Friday; null when holding
  slotLabel: string | null; // e.g. "Friday · 7 PM Toronto (into the India weekend)"
  confidence: number; // 0–100
  reasons: string[];
  signals: AdvisorSignals;
}

export const DEFAULT_BASELINE_VPD = 5000;
const RETENTION_HEALTHY = 40; // averageViewPercentage floor for "content is fine"
const RETENTION_STRONG = 45;
const RETENTION_FALL_PCT = 0.15; // ≥15% relative drop in top retention = falling
const SUGGESTED_DROP_PCT = 0.4; // ≥40% drop in suggested reach = draining
const RECENT_UPLOAD_DAYS = 2; // published within this many days = "let it ride"

/**
 * Views-weighted mean retention over a set of videos. Weighting by views (not a
 * flat mean) means the songs people actually watch dominate the read, and — fed
 * only long-form rows by the caller — it keeps sub-minute Shorts (which sit near
 * 100%) from inflating the channel's apparent retention. Null when there is no
 * positive-view row to weight.
 */
export function weightedRetention(rows: Array<{ retentionPct: number; views: number }>): number | null {
  let weight = 0;
  let acc = 0;
  for (const r of rows) {
    if (!Number.isFinite(r.retentionPct) || !Number.isFinite(r.views) || r.views <= 0) continue;
    weight += r.views;
    acc += r.retentionPct * r.views;
  }
  return weight > 0 ? acc / weight : null;
}

/** Date (YYYY-MM-DD) of the coming Friday on/after asOf (asOf itself if it's a Friday). */
export function nextFriday(asOf: string): string {
  const d = new Date(`${asOf}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return asOf;
  const delta = (5 - d.getUTCDay() + 7) % 7; // Fri = 5; 0 when asOf is already Friday
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Compose the inputs into a single publish recommendation. Deterministic — same
 * inputs always yield the same verdict, confidence, and reasons.
 */
export function advisePublish(input: AdvisorInput): Advice {
  const baseline = input.baselineViewsPerDay ?? DEFAULT_BASELINE_VPD;
  const drop = input.suggestedDropPct;

  const viewsNearBaseline = input.recentViewsPerDay <= baseline * 1.3;
  const reachDraining =
    input.viewsDeclining === true ||
    (drop != null && drop >= SUGGESTED_DROP_PCT) ||
    input.recentViewsPerDay <= baseline * 1.1;

  const retentionKnown = input.topRetention != null;
  const retentionHealthy = !retentionKnown || (input.topRetention as number) >= RETENTION_HEALTHY;
  const retentionFallPct =
    retentionKnown && input.priorTopRetention != null && input.priorTopRetention > 0
      ? (input.priorTopRetention - (input.topRetention as number)) / input.priorTopRetention
      : null;
  const retentionFalling = retentionFallPct != null && retentionFallPct >= RETENTION_FALL_PCT;

  const recentlyPublished =
    input.daysSinceLastUpload != null && input.daysSinceLastUpload <= RECENT_UPLOAD_DAYS;
  const subsGrowing = input.netSubsPerDay != null && input.netSubsPerDay > 0;
  const reachSurging = drop != null && drop <= -0.15;

  const signals: AdvisorSignals = {
    reachDraining,
    viewsNearBaseline,
    retentionKnown,
    retentionHealthy,
    retentionFalling,
    retentionFallPct,
    recentlyPublished,
    subsGrowing,
    reachSurging,
  };

  // ── verdict (priority order) ──────────────────────────────────────────────
  let verdict: Verdict;
  if (retentionFalling || (reachDraining && retentionKnown && !retentionHealthy)) {
    verdict = 'hold-fix-content';
  } else if (recentlyPublished) {
    verdict = 'let-it-ride';
  } else if (reachDraining && retentionHealthy) {
    verdict = 'ship-now';
  } else {
    verdict = 'on-schedule';
  }

  // ── target slot ───────────────────────────────────────────────────────────
  const friday = nextFriday(input.asOf);
  const isToday = friday === input.asOf;
  const slotShort = isToday ? 'today (Fri) 7 PM Toronto' : 'Friday 7 PM Toronto';
  const recommendedDate = verdict === 'hold-fix-content' ? null : friday;
  const slotLabel =
    verdict === 'hold-fix-content'
      ? null
      : `${isToday ? 'Today (Friday)' : 'Friday'} · 7 PM Toronto (into the India weekend)`;

  // ── confidence ────────────────────────────────────────────────────────────
  let confidence: number;
  if (verdict === 'ship-now') {
    confidence = 55;
    if (viewsNearBaseline) confidence += 15;
    if (input.viewsDeclining) confidence += 15;
    if (drop != null && drop >= SUGGESTED_DROP_PCT) confidence += 10;
    if (retentionKnown && (input.topRetention as number) >= RETENTION_STRONG) confidence += 5;
    if (subsGrowing) confidence += 5;
    if (!retentionKnown) confidence -= 10; // can't confirm it's a reach (not content) problem
  } else if (verdict === 'on-schedule') {
    confidence = 65;
    if (retentionHealthy) confidence += 10;
    if (subsGrowing) confidence += 10;
    if (!reachDraining) confidence += 5;
  } else if (verdict === 'let-it-ride') {
    confidence = 70;
    if (reachSurging) confidence += 15;
    if (subsGrowing) confidence += 5;
  } else {
    confidence = 60;
    if (retentionFallPct != null && retentionFalling) confidence += Math.round(retentionFallPct * 100);
    else if (retentionKnown) confidence += Math.round(RETENTION_HEALTHY - (input.topRetention as number));
  }
  confidence = clamp(confidence, 40, 95);

  // ── headline ──────────────────────────────────────────────────────────────
  const headline =
    verdict === 'ship-now'
      ? `Ship a hero upload — target ${slotShort}`
      : verdict === 'on-schedule'
        ? `On track — publish ${slotShort}`
        : verdict === 'let-it-ride'
          ? `Let it ride — you just published; next drop ${slotShort}`
          : 'Hold — fix retention before the next upload';

  // ── reasons (deterministic templates) ─────────────────────────────────────
  const reasons: string[] = [];
  if (verdict !== 'hold-fix-content') {
    reasons.push(
      'Friday publish lands the first 24h on India’s weekend — the best window for a majority-India audience.'
    );
  }
  if (verdict === 'ship-now') {
    if (drop != null && drop >= SUGGESTED_DROP_PCT) {
      reasons.push(`Suggested-video reach is down ~${Math.round(drop * 100)}% — a fresh hero upload re-fuels it.`);
    } else if (input.viewsDeclining) {
      reasons.push('Daily views are trending down — a fresh upload re-fuels suggested before they hit baseline.');
    } else if (viewsNearBaseline) {
      reasons.push(
        `Daily views (~${Math.round(input.recentViewsPerDay)}/day) are near your pre-surge baseline — time to re-fuel.`
      );
    }
    if (retentionKnown && retentionHealthy) {
      reasons.push(
        `Top-video retention is healthy (${(input.topRetention as number).toFixed(0)}%) — this is a reach lever, not a content problem.`
      );
    }
    if (!retentionKnown) {
      reasons.push('Note: retention data was unavailable, so this assumes content health is steady.');
    }
  }
  if (verdict === 'hold-fix-content') {
    if (retentionFalling && retentionFallPct != null) {
      reasons.push(
        `Top-video retention fell ~${Math.round(retentionFallPct * 100)}% — fix the opening before pumping reach; a new upload won’t cure a watch-time dip.`
      );
    } else if (retentionKnown) {
      reasons.push(
        `Top-video retention is low (${(input.topRetention as number).toFixed(0)}%) — strengthen the first 15s before shipping more; reach can’t fix watch-time.`
      );
    }
  }
  if (verdict === 'let-it-ride') {
    reasons.push(
      `You published ${input.daysSinceLastUpload}d ago — let it breathe so the algorithm doesn’t split attention.`
    );
  }
  if (input.subsToTier2 != null && input.subsToTier2 > 0) {
    reasons.push(
      `~${input.subsToTier2} subs to Tier-2 (1,000)${input.netSubsPerDay ? ` at ~${Math.round(input.netSubsPerDay)}/day` : ''} — a strong upload speeds the last stretch.`
    );
  }
  if (verdict === 'ship-now' || verdict === 'on-schedule') {
    reasons.push('Seed it on WhatsApp at publish so early diaspora views warm the signal before India wakes.');
  }

  return { verdict, headline, recommendedDate, slotLabel, confidence, reasons, signals };
}

// ── input derivation (shared by the route AND the server page) ──────────────────

const TIER2_SUBS = 1000;

export interface AdviceInputs {
  recentViewsPerDay: number;
  viewsDeclining: boolean;
  longFormRetention: number | null;
  netSubsPerDay: number;
  subsToTier2: number | null;
  daysSinceLastUpload: number | null;
  finalizedDays: number;
}

export interface AdviceBundle {
  advice: Advice;
  inputs: AdviceInputs;
  caveats: string[];
}

/**
 * Derive the advice from already-fetched Analytics data — the SINGLE source of
 * the reach/retention/momentum/recency signals, so the route and the dashboard
 * page produce identical advice without fetching the same series/videos twice.
 * Pure (asOf passed in). Minimal structural inputs so it doesn't couple to the
 * fetchers' full row types.
 *  - series: daily channel rows (the lagging final day is dropped here).
 *  - videos: catalogue with durations (for Shorts exclusion + recency).
 *  - videoAnalytics: per-video window rows (avgViewDuration) for LONG-FORM
 *    retention; null when unavailable → retention omitted (score renormalizes).
 */
export function buildPublishAdvice(data: {
  asOf: string;
  series: Array<{ date: string; views: number; subscribersGained: number; subscribersLost?: number }>;
  channel: { subscriberCount: number } | null;
  videos: Array<{ id: string; publishedAt: string; duration?: string; durationSeconds: number }>;
  videoAnalytics: Array<{ videoId: string; views: number; averageViewDuration: number }> | null;
}): AdviceBundle {
  const caveats: string[] = [];
  // Drop the lagging final day; recent days settle and would read as a false dip.
  const finalized = data.series.length > 1 ? data.series.slice(0, -1) : data.series;
  if (finalized.length < 8) {
    caveats.push('Fewer than 8 finalized days of history — treat the read as tentative.');
  }
  const recentN = Math.min(7, Math.max(1, Math.floor(finalized.length / 2)));
  const recent = finalized.slice(-recentN);
  const meanOf = (xs: number[]): number => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);

  const recentViewsPerDay = meanOf(recent.map((d) => d.views));
  const netSubsPerDay = meanOf(recent.map((d) => d.subscribersGained - (d.subscribersLost ?? 0)));

  const points: SeriesPoint[] = finalized.map((d) => ({
    date: d.date,
    views: d.views,
    netSubscribers: d.subscribersGained,
  }));
  const viewsChange = assessChange(points, { metric: 'views', recentDays: recentN, priorDays: recentN });
  const viewsDeclining = viewsChange?.significant === true && viewsChange.direction === 'down';

  const subsToTier2 =
    data.channel && data.channel.subscriberCount < TIER2_SUBS
      ? TIER2_SUBS - data.channel.subscriberCount
      : null;

  const latestLongForm = data.videos.find((v) => v.publishedAt && !isShort(v));
  const daysSinceLastUpload = latestLongForm ? ageInDays(latestLongForm.publishedAt, data.asOf) : null;

  let longFormRetention: number | null = null;
  if (data.videoAnalytics) {
    const durationById = new Map(data.videos.map((v) => [v.id, v.durationSeconds]));
    const shortIds = new Set(data.videos.filter((v) => isShort(v)).map((v) => v.id));
    const rows = data.videoAnalytics
      .filter((r) => !shortIds.has(r.videoId))
      .map((r) => ({ dur: durationById.get(r.videoId), avd: r.averageViewDuration, views: r.views }))
      .filter((x): x is { dur: number; avd: number; views: number } => x.dur != null && x.dur > 0)
      .map((x) => ({ retentionPct: (x.avd / x.dur) * 100, views: x.views }));
    longFormRetention = weightedRetention(rows);
  }

  if (!data.channel && data.videos.length === 0) {
    caveats.push('YouTube Data API unavailable — subs-to-Tier-2 and last-upload recency were omitted.');
  }
  caveats.push(
    'Retention is the views-weighted average of LONG-FORM songs only (Shorts excluded); a falling-retention trend isn’t wired in yet.'
  );
  caveats.push(
    'Suggested-vs-prior reach breakdown is not wired in yet — the reach signal comes from the finalized daily-views trend.'
  );

  const advice = advisePublish({
    asOf: data.asOf,
    recentViewsPerDay,
    viewsDeclining,
    topRetention: longFormRetention,
    priorTopRetention: null,
    netSubsPerDay,
    subsToTier2,
    daysSinceLastUpload,
  });

  return {
    advice,
    inputs: {
      recentViewsPerDay: Math.round(recentViewsPerDay),
      viewsDeclining,
      longFormRetention,
      netSubsPerDay: Math.round(netSubsPerDay),
      subsToTier2,
      daysSinceLastUpload,
      finalizedDays: finalized.length,
    },
    caveats,
  };
}
