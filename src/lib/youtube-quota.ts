/**
 * YouTube API quota accounting — DURABLE, not in-process.
 *
 * Amplify SSR runs on Lambda: every route handler and cron hit may land on a
 * different (or cold) container, so a module-level counter undercounts and a
 * "stop at 80%" guard built on one would never fire. The counter therefore
 * lives in DynamoDB as an atomic `ADD` on a per-day item, exactly as the shared
 * tier of `lib/rate-limit.ts` does for request limiting.
 *
 *   PK = "YTQUOTA#<YYYY-MM-DD>"   SK = "COUNTER#DATA" | "COUNTER#ANALYTICS"
 *
 * TWO LEDGERS, NOT ONE. Data API v3 and Analytics API v2 are metered
 * SEPARATELY by Google. A single counter would let Analytics queries eat the
 * Data budget — tripping the stop early on one surface while the other's
 * ceiling goes completely unmonitored. They are split at the sort key with
 * independent limits.
 *
 * QUOTA DAY IS PACIFIC, NOT UTC AND NOT TORONTO. Google resets Data API quota
 * at midnight America/Los_Angeles. Keying the counter on a UTC or Eastern date
 * would roll the counter over at the wrong moment — spending against a fresh
 * budget while Google still counts the old day, or blocking on a full counter
 * hours after Google has already reset. This is the single easiest thing to get
 * wrong here, so the day key is computed explicitly in Pacific.
 *
 * ORDERING: we ADD first and judge afterwards (same as rate-limit). A caller
 * that is refused has therefore already counted the units it did not spend, so
 * the counter drifts CONSERVATIVELY high — it stops early rather than late,
 * which is the safe direction for a hard quota.
 *
 * Pure helpers are separated from the I/O so the threshold and date maths are
 * unit-tested without a database.
 */

import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';

/** Which Google quota pool a call is billed against. */
export type QuotaSurface = 'data' | 'analytics';

/**
 * Documented unit costs for the DATA API. `search.list` is listed ONLY so a
 * reader sees why it is banned: at 100 units it burns 1% of the daily budget
 * per call, and everything it offers is available from
 * `playlistItems`/`videos.list` at 1 unit.
 */
export const QUOTA_COST = {
  channelsList: 1,
  videosList: 1,
  playlistItemsList: 1,
  /** FORBIDDEN — see the note above. Present for cost documentation only. */
  searchList: 100,
} as const;

/** Data API v3 default: 10,000 units/day. Well documented and stable. */
export const DEFAULT_QUOTA_LIMIT = 10_000;

/**
 * Analytics API v2 is metered separately, in QUERIES per day rather than
 * weighted units, and the figure varies by project. This default is a
 * deliberately conservative placeholder so the guard is never the thing that
 * silently permits a runaway — confirm the real number in the Cloud console for
 * this project and override via env before quoting it as fact in the README.
 */
export const DEFAULT_ANALYTICS_QUOTA_LIMIT = 10_000;

export const DEFAULT_WARN_THRESHOLD = 0.8;

/**
 * Backstop ceiling for a SINGLE container when the durable ledger is
 * unavailable. Steady-state usage is ~350 units/day (288 for the 5-minute
 * snapshot plus the daily sync), so the durable 80% stop never fires in normal
 * operation — its only real job is catching a runaway retry loop. That is
 * exactly the scenario where the loop hammers DynamoDB too, ledger writes start
 * failing, and a pure fail-open would remove the guard at the moment it was
 * built for. A per-container counter is weak as a primary mechanism but
 * adequate as a backstop: one runaway container still gets stopped, while a
 * genuine transient blip stays invisible.
 */
export const FAILOPEN_CONTAINER_CEILING = 50;

/** Keep a spent day around briefly after it ends so late reads still see it. */
const TTL_GRACE_SECONDS = 2 * 24 * 60 * 60;

/** Per-container spend counted only while the durable ledger is unreachable. */
const degradedSpend = new Map<string, number>();

export interface QuotaState {
  /** Pacific calendar day this counter belongs to. */
  day: string;
  surface: QuotaSurface;
  used: number;
  limit: number;
  remaining: number;
  /** 0–1. */
  fraction: number;
  /** At or past the warn threshold — log, but callers may proceed. */
  warn: boolean;
  /** At or past the threshold — callers MUST NOT make the request. */
  blocked: boolean;
  /**
   * True when the durable ledger was unreachable and this verdict came from the
   * per-container backstop instead. Surfaced so /health can show "quota
   * accounting degraded" rather than a falsely reassuring low number.
   */
  degraded: boolean;
}

/**
 * The Pacific calendar day (YYYY-MM-DD) a timestamp falls in — the day Google
 * bills against. `Intl` carries the DST rules, so this stays correct across the
 * March/November shifts without a date library.
 */
export function quotaDayKey(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Seconds-since-epoch at which a quota day's row may be reaped. */
export function quotaRowExpiry(now: Date): number {
  return Math.floor(now.getTime() / 1000) + TTL_GRACE_SECONDS;
}

/** Sort key for a surface's counter. */
export function quotaSortKey(surface: QuotaSurface): string {
  return `COUNTER#${surface.toUpperCase()}`;
}

/** Default budget for a surface. */
export function defaultLimitFor(surface: QuotaSurface): number {
  return surface === 'analytics' ? DEFAULT_ANALYTICS_QUOTA_LIMIT : DEFAULT_QUOTA_LIMIT;
}

/** Pure verdict for an already-known usage figure. */
export function evaluateQuota(
  used: number,
  day: string,
  limit: number = DEFAULT_QUOTA_LIMIT,
  threshold: number = DEFAULT_WARN_THRESHOLD,
  surface: QuotaSurface = 'data',
  degraded = false
): QuotaState {
  // A zero/negative limit means "no budget", not "unlimited" — block rather
  // than divide by zero and sail past the guard.
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 0;
  const safeUsed = Number.isFinite(used) && used > 0 ? used : 0;
  const fraction = safeLimit === 0 ? 1 : safeUsed / safeLimit;
  const over = fraction >= threshold;
  return {
    day,
    surface,
    used: safeUsed,
    limit: safeLimit,
    remaining: Math.max(0, safeLimit - safeUsed),
    fraction,
    warn: over,
    blocked: over,
    degraded,
  };
}

export interface ConsumeOptions {
  surface?: QuotaSurface;
  limit?: number;
  threshold?: number;
  /** Injected for tests; defaults to now. */
  now?: Date;
}

/**
 * Atomically charge `units` against today's budget for a surface and return the
 * verdict.
 *
 * On a DynamoDB failure this falls back to a BOUNDED per-container counter (see
 * FAILOPEN_CONTAINER_CEILING) rather than allowing unlimited spend: a transient
 * blip stays invisible, but a runaway loop on one container is still stopped.
 */
export async function consumeQuota(units: number, opts: ConsumeOptions = {}): Promise<QuotaState> {
  const now = opts.now ?? new Date();
  const day = quotaDayKey(now);
  const surface = opts.surface ?? 'data';
  const limit = opts.limit ?? defaultLimitFor(surface);
  const threshold = opts.threshold ?? DEFAULT_WARN_THRESHOLD;
  const charge = Number.isFinite(units) && units > 0 ? Math.trunc(units) : 0;

  try {
    const attrs = await DynamoDBOperations.update({
      key: { PK: `YTQUOTA#${day}`, SK: quotaSortKey(surface) },
      updateExpression: 'SET #ttl = if_not_exists(#ttl, :exp) ADD #used :units',
      expressionAttributeNames: { '#ttl': 'ttl', '#used': 'used' },
      expressionAttributeValues: { ':units': charge, ':exp': quotaRowExpiry(now) },
    });
    const used = Number((attrs as { used?: number } | undefined)?.used ?? charge);
    return evaluateQuota(used, day, limit, threshold, surface, false);
  } catch (err) {
    const bucket = `${day}#${surface}`;
    const spent = (degradedSpend.get(bucket) ?? 0) + charge;
    degradedSpend.set(bucket, spent);
    console.error(
      `[yt-quota] ledger unavailable for ${surface}; backstop counter at ${spent}/${FAILOPEN_CONTAINER_CEILING}:`,
      err instanceof Error ? err.message : String(err)
    );
    // Judge against the container ceiling, not the daily budget — the durable
    // figure is unknown, so the only defensible bound is what THIS container
    // has spent since the ledger went dark.
    return evaluateQuota(spent, day, FAILOPEN_CONTAINER_CEILING, threshold, surface, true);
  }
}

/** Read a surface's counter without charging it (powers the health endpoint). */
export async function readQuota(opts: ConsumeOptions = {}): Promise<QuotaState> {
  const now = opts.now ?? new Date();
  const day = quotaDayKey(now);
  const surface = opts.surface ?? 'data';
  const limit = opts.limit ?? defaultLimitFor(surface);
  const threshold = opts.threshold ?? DEFAULT_WARN_THRESHOLD;
  try {
    const item = await DynamoDBOperations.get({ PK: `YTQUOTA#${day}`, SK: quotaSortKey(surface) });
    const used = Number((item as { used?: number } | undefined)?.used ?? 0);
    return evaluateQuota(used, day, limit, threshold, surface, false);
  } catch {
    return evaluateQuota(0, day, limit, threshold, surface, true);
  }
}

/** Test hook: clear the per-container degraded counters. */
export function __resetDegradedQuotaForTests(): void {
  degradedSpend.clear();
}
