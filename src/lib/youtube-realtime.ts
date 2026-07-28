/**
 * "Realtime" channel tiles — the approximation of Studio's Realtime card.
 *
 * There is NO public API behind Studio's realtime numbers, and scraping Studio
 * is out of the question, so both tiles are derived from our own frequent
 * snapshots of the public `channels.list` counters:
 *
 *   PK = "YTSNAP#CHANNEL"   SK = "<ISO capturedAt>"   (lexicographically sortable)
 *
 *   • subscribers — read straight from the latest snapshot. Google ROUNDS this
 *     to 3 significant figures above 1,000 (a true 1,118 is served as 1,110), so
 *     it is labelled approximate rather than presented as fact.
 *   • views in the last 48h — the DIFFERENCE between the latest snapshot's
 *     lifetime `viewCount` and the snapshot nearest 48h ago.
 *
 * Four things make the delta wrong if they are not handled explicitly, and all
 * four are handled here rather than in the route:
 *
 *  1. GAPS. "Nearest 48h ago" is only meaningful if a snapshot actually exists
 *     near there. If the cron missed a stretch, the nearest neighbour might be
 *     61 hours old — computing that and labelling it "48 hours" is an inflated
 *     number that looks perfectly normal. `pickAnchor` therefore requires the
 *     anchor to fall inside a tolerance band and reports the TRUE window length
 *     so the UI can say "last 61 hours" instead of lying.
 *  2. NON-MONOTONIC viewCount. YouTube sweeps invalid views and the lifetime
 *     counter can DROP. A negative delta must never surface as a negative
 *     "views last 48h", so it clamps at zero — but the raw negative is carried
 *     out so the caller can log it, because a large drop is real signal about a
 *     spam sweep rather than noise to swallow.
 *  3. UNBOUNDED READS. At 288 snapshots/day kept for 90 days this partition
 *     holds ~26k items, so the anchor is fetched with a sort-key RANGE query
 *     around the target instant, never by reading the partition and filtering
 *     in application code.
 *  4. DOUBLE-FIRED CRONS. External schedulers retry; two snapshots a second
 *     apart are harmless to the delta (the newest simply wins) and the write is
 *     a plain put, so calling the capture route twice is safe.
 *
 * Pure maths is separated from the I/O so every one of the above is unit-tested
 * without a database.
 */

import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';

export const SNAPSHOT_PK = 'YTSNAP#CHANNEL';

/** Target look-back for the "views last 48 hours" tile. */
export const REALTIME_WINDOW_HOURS = 48;

/**
 * How far from the 48h target an anchor may sit and still be called a 48h
 * window. At a 5-minute cadence a healthy series always has a snapshot within
 * minutes; ±2h tolerates a short outage without silently mislabelling a much
 * longer window.
 */
export const ANCHOR_TOLERANCE_HOURS = 2;

/** §6 retention: snapshots are pruned after 90 days (TTL is best-effort). */
export const SNAPSHOT_TTL_DAYS = 90;

/** Above this, Google rounds `subscriberCount` to 3 significant figures. */
export const SUBSCRIBER_ROUNDING_FLOOR = 1000;

const HOUR_MS = 60 * 60 * 1000;

export interface ChannelSnapshot {
  /** ISO-8601 instant the counters were read. */
  capturedAt: string;
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
}

export interface AnchorPick {
  snapshot: ChannelSnapshot;
  /** Actual elapsed time between the anchor and the reference instant, ms. */
  windowMs: number;
  /** Did the anchor land inside the tolerance band? */
  withinTolerance: boolean;
}

/**
 * Choose the snapshot closest to `targetIso` from a candidate list.
 *
 * Returns null for an empty list. `withinTolerance` is false — rather than the
 * pick being discarded — so the caller can decide between suppressing the tile
 * and relabelling it with the true window.
 */
export function pickAnchor(
  candidates: ChannelSnapshot[],
  targetIso: string,
  referenceIso: string,
  toleranceMs: number = ANCHOR_TOLERANCE_HOURS * HOUR_MS
): AnchorPick | null {
  if (!candidates.length) return null;
  const target = Date.parse(targetIso);
  const reference = Date.parse(referenceIso);
  if (!Number.isFinite(target) || !Number.isFinite(reference)) return null;

  let best: ChannelSnapshot | null = null;
  let bestDistance = Infinity;
  for (const c of candidates) {
    const t = Date.parse(c.capturedAt);
    if (!Number.isFinite(t)) continue;
    const distance = Math.abs(t - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = c;
    }
  }
  if (!best) return null;

  return {
    snapshot: best,
    windowMs: reference - Date.parse(best.capturedAt),
    withinTolerance: bestDistance <= toleranceMs,
  };
}

export interface ViewDelta {
  /** Never negative — safe to render. */
  views: number;
  /** True when the lifetime counter went DOWN (YouTube swept invalid views). */
  decreased: boolean;
  /** The unclamped difference, for logging when `decreased` is true. */
  raw: number;
}

/** Lifetime-counter difference, clamped so a spam sweep can't render negative. */
export function computeViewDelta(latestViewCount: number, anchorViewCount: number): ViewDelta {
  const raw = latestViewCount - anchorViewCount;
  return { views: Math.max(0, raw), decreased: raw < 0, raw };
}

/** Is this subscriber figure subject to Google's 3-significant-figure rounding? */
export function isSubscriberCountRounded(count: number): boolean {
  return count >= SUBSCRIBER_ROUNDING_FLOOR;
}

export interface RealtimeReading {
  subscribersApprox: number | null;
  subscribersRounded: boolean;
  /**
   * Deliberately null: an exact count needs a known-exact baseline to add
   * Analytics' gained/lost onto, and we have no such anchor. Reporting a
   * derived "exact" without one would be a confident wrong number.
   */
  subscribersExact: null;
  views48h: number | null;
  views48hAvailable: boolean;
  /** TRUE length of the window the delta covers — not assumed to be 48. */
  windowHours: number | null;
  /** False when the anchor sat outside tolerance; UI should relabel, not lie. */
  windowExact: boolean;
  viewCountDecreased: boolean;
  snapshotAt: string | null;
}

/** Assemble the tile payload from a latest snapshot and an anchor pick. */
export function deriveRealtime(
  latest: ChannelSnapshot | null,
  anchor: AnchorPick | null
): RealtimeReading {
  if (!latest) {
    return {
      subscribersApprox: null,
      subscribersRounded: false,
      subscribersExact: null,
      views48h: null,
      views48hAvailable: false,
      windowHours: null,
      windowExact: false,
      viewCountDecreased: false,
      snapshotAt: null,
    };
  }

  const base = {
    subscribersApprox: latest.subscriberCount,
    subscribersRounded: isSubscriberCountRounded(latest.subscriberCount),
    subscribersExact: null as null,
    snapshotAt: latest.capturedAt,
  };

  // No anchor at all = the first 48h after deployment. §3.1 requires null here
  // so the UI renders "—" rather than a wrong number.
  if (!anchor || anchor.windowMs <= 0) {
    return {
      ...base,
      views48h: null,
      views48hAvailable: false,
      windowHours: null,
      windowExact: false,
      viewCountDecreased: false,
    };
  }

  const delta = computeViewDelta(latest.viewCount, anchor.snapshot.viewCount);
  return {
    ...base,
    views48h: delta.views,
    views48hAvailable: true,
    windowHours: Number((anchor.windowMs / HOUR_MS).toFixed(1)),
    windowExact: anchor.withinTolerance,
    viewCountDecreased: delta.decreased,
  };
}

/** ISO instant `hours` before `now` — the anchor target. */
export function anchorTargetIso(now: Date, hours: number = REALTIME_WINDOW_HOURS): string {
  return new Date(now.getTime() - hours * HOUR_MS).toISOString();
}

// ---------------------------------------------------------------- I/O

/** Persist one snapshot. Plain put: a double-fired cron just writes twice. */
export async function recordChannelSnapshot(
  stats: Omit<ChannelSnapshot, 'capturedAt'>,
  now: Date = new Date()
): Promise<ChannelSnapshot> {
  const capturedAt = now.toISOString();
  const item: ChannelSnapshot = { capturedAt, ...stats };
  await DynamoDBOperations.put({
    PK: SNAPSHOT_PK,
    SK: capturedAt,
    ...item,
    ttl: Math.floor(now.getTime() / 1000) + SNAPSHOT_TTL_DAYS * 24 * 60 * 60,
  });
  return item;
}

const toSnapshot = (it: Record<string, unknown>): ChannelSnapshot => ({
  capturedAt: String(it.capturedAt ?? it.SK ?? ''),
  subscriberCount: Number(it.subscriberCount ?? 0),
  viewCount: Number(it.viewCount ?? 0),
  videoCount: Number(it.videoCount ?? 0),
});

/** Newest snapshot, or null before the first capture. */
export async function loadLatestSnapshot(): Promise<ChannelSnapshot | null> {
  const res = await DynamoDBOperations.query({
    keyConditionExpression: 'PK = :pk',
    expressionAttributeValues: { ':pk': SNAPSHOT_PK },
    scanIndexForward: false,
    limit: 1,
  });
  const items = (res.Items ?? []) as Record<string, unknown>[];
  return items.length ? toSnapshot(items[0]) : null;
}

/**
 * Candidate anchors around the target instant — a BOUNDED sort-key range query,
 * so this stays cheap as the partition grows past 26k items.
 */
export async function loadAnchorCandidates(
  targetIso: string,
  toleranceMs: number = ANCHOR_TOLERANCE_HOURS * HOUR_MS
): Promise<ChannelSnapshot[]> {
  const target = Date.parse(targetIso);
  const from = new Date(target - toleranceMs).toISOString();
  const to = new Date(target + toleranceMs).toISOString();
  const res = await DynamoDBOperations.query({
    keyConditionExpression: 'PK = :pk AND SK BETWEEN :from AND :to',
    expressionAttributeValues: { ':pk': SNAPSHOT_PK, ':from': from, ':to': to },
    // ±2h at a 5-minute cadence is ~49 rows; the cap is a runaway guard only.
    limit: 200,
  });
  return ((res.Items ?? []) as Record<string, unknown>[]).map(toSnapshot);
}

/** Full realtime reading: latest snapshot + bounded anchor lookup. */
export async function loadRealtime(now: Date = new Date()): Promise<RealtimeReading> {
  const latest = await loadLatestSnapshot();
  if (!latest) return deriveRealtime(null, null);
  const targetIso = anchorTargetIso(now);
  const candidates = await loadAnchorCandidates(targetIso);
  const anchor = pickAnchor(candidates, targetIso, latest.capturedAt);
  const reading = deriveRealtime(latest, anchor);
  if (reading.viewCountDecreased) {
    console.warn(
      `[yt-realtime] lifetime viewCount DECREASED over the last ${reading.windowHours}h ` +
        `— likely an invalid-view sweep, not a bug. Clamped to 0 for display.`
    );
  }
  return reading;
}
