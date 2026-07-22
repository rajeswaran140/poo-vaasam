/**
 * IP rate limiting for the unauthenticated endpoints — the AI/TTS routes (which
 * spend real money per request on attacker-supplied input) and the analytics
 * beacons (whose counters feed the admin dashboard).
 *
 * TWO TIERS.
 *  - `RateLimiter` is the original per-instance sliding window. Exact, cheap,
 *    but Amplify SSR Lambdas don't share memory, so an attacker spreading load
 *    across cold instances slipped past it.
 *  - `SharedRateLimiter` adds a DynamoDB fixed-window counter on top, giving
 *    cross-instance enforcement. It checks the local tier FIRST (fast path, no
 *    network) and only then the shared counter.
 *
 * Degradation is the point of the layering: if DynamoDB is throttled or errors,
 * the shared tier is skipped and the local verdict stands — i.e. behaviour falls
 * back to exactly what it was before, never worse. A limiter that fails closed
 * would take the site down on a DynamoDB blip; one that fails fully open would
 * hand out free AI spend. Falling back to per-instance limiting is the middle
 * that preserves both.
 *
 * The shared tier is a FIXED window, not a sliding one: a sliding window needs
 * every timestamp read back, while a fixed window is a single atomic ADD. The
 * known trade-off is that a client straddling a boundary can send up to 2×max
 * across the two adjacent windows. That's acceptable here — this caps abuse, it
 * isn't a billing meter.
 */

import { NextRequest } from 'next/server';
import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';

export interface RateLimitResult {
  allowed: boolean;
  /** Requests left in the current window after this check. */
  remaining: number;
  /** Epoch ms at which the window frees up (when the oldest hit ages out). */
  resetAt: number;
  limit: number;
}

export interface RateLimiterOptions {
  /** Window length in ms. */
  windowMs: number;
  /** Max requests allowed per key per window. */
  max: number;
  /** Injectable clock for tests; defaults to Date.now. */
  now?: () => number;
}

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly max: number;
  private readonly now: () => number;

  constructor({ windowMs, max, now }: RateLimiterOptions) {
    this.windowMs = windowMs;
    this.max = max;
    this.now = now ?? (() => Date.now());
  }

  check(key: string): RateLimitResult {
    const now = this.now();
    const windowStart = now - this.windowMs;

    // Drop timestamps that have aged out of the window.
    const recent = (this.hits.get(key) ?? []).filter((t) => t > windowStart);

    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      const oldest = recent[0];
      return {
        allowed: false,
        remaining: 0,
        resetAt: oldest + this.windowMs,
        limit: this.max,
      };
    }

    recent.push(now);
    this.hits.set(key, recent);

    // Opportunistic cleanup so the Map doesn't grow unbounded across many IPs.
    if (this.hits.size > 5000) this.prune(windowStart);

    return {
      allowed: true,
      remaining: this.max - recent.length,
      resetAt: now + this.windowMs,
      limit: this.max,
    };
  }

  /** Clear all tracked hits. Primarily for test isolation. */
  reset(): void {
    this.hits.clear();
  }

  private prune(windowStart: number): void {
    for (const [key, times] of this.hits) {
      const recent = times.filter((t) => t > windowStart);
      if (recent.length === 0) this.hits.delete(key);
      else this.hits.set(key, recent);
    }
  }
}

export interface SharedRateLimiterOptions extends RateLimiterOptions {
  /**
   * Namespace for the counter rows, so two endpoints sharing an IP don't share
   * a budget. Becomes part of the partition key.
   */
  bucket: string;
}

/** Keep counter rows a little past their window so a clock skew can't resurrect one. */
const TTL_GRACE_SECONDS = 300;

/** Only warn once per bucket per process — a DynamoDB outage shouldn't spam logs. */
const warned = new Set<string>();

/**
 * Cross-instance rate limiter: per-instance sliding window, then a shared
 * DynamoDB fixed-window counter. See the module header for why it degrades to
 * the local tier rather than failing open or closed.
 */
export class SharedRateLimiter {
  private readonly local: RateLimiter;
  private readonly bucket: string;
  private readonly windowMs: number;
  private readonly max: number;
  private readonly now: () => number;

  constructor({ bucket, windowMs, max, now }: SharedRateLimiterOptions) {
    this.bucket = bucket;
    this.windowMs = windowMs;
    this.max = max;
    this.now = now ?? (() => Date.now());
    this.local = new RateLimiter({ windowMs, max, now });
  }

  async check(key: string): Promise<RateLimitResult> {
    // Local first: if this instance alone has already seen too much, there's no
    // reason to pay for a DynamoDB round trip to confirm it.
    const local = this.local.check(key);
    if (!local.allowed) return local;

    try {
      return await this.checkShared(key);
    } catch (err) {
      if (!warned.has(this.bucket)) {
        warned.add(this.bucket);
        console.error(
          `[rate-limit] shared tier unavailable for "${this.bucket}"; falling back to per-instance limiting:`,
          err instanceof Error ? err.message : String(err)
        );
      }
      return local;
    }
  }

  /** Atomic +1 on the current window's counter; the returned count is the verdict. */
  private async checkShared(key: string): Promise<RateLimitResult> {
    const now = this.now();
    const windowStart = now - (now % this.windowMs);
    const resetAt = windowStart + this.windowMs;

    const attrs = await DynamoDBOperations.update({
      key: { PK: `RATELIMIT#${this.bucket}#${key}`, SK: String(windowStart) },
      updateExpression: 'SET #ttl = if_not_exists(#ttl, :exp) ADD #count :one',
      expressionAttributeNames: { '#ttl': 'ttl', '#count': 'count' },
      expressionAttributeValues: {
        ':one': 1,
        ':exp': Math.floor(resetAt / 1000) + TTL_GRACE_SECONDS,
      },
    });

    const count = Number((attrs as { count?: number } | undefined)?.count ?? 1);
    return {
      allowed: count <= this.max,
      remaining: Math.max(0, this.max - count),
      resetAt,
      limit: this.max,
    };
  }

  /** Clear the local tier. Shared rows expire via TTL. Primarily for tests. */
  reset(): void {
    this.local.reset();
  }
}

/** Test hook: forget which buckets have already logged a degradation warning. */
export function __resetSharedWarningsForTests(): void {
  warned.clear();
}

/**
 * Number of trusted proxies that append to `x-forwarded-for` between the viewer
 * and this code. Amplify is fronted by CloudFront, which appends exactly one
 * entry (the viewer IP) — so the default is 1. Override via env only if another
 * appending hop is introduced.
 */
const TRUSTED_PROXY_HOPS = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS) || 1);

/**
 * Client IP from proxy headers, used as the rate-limit bucket key.
 *
 * SECURITY: CloudFront does not *replace* a client-supplied `X-Forwarded-For` —
 * it APPENDS the real viewer IP to whatever the client sent. At our origin the
 * header therefore reads:
 *
 *     X-Forwarded-For: <anything the client made up>, <real viewer IP>
 *
 * So the leftmost entry is attacker-controlled and the RIGHTMOST entry (written
 * by the trusted proxy nearest us) is the only trustworthy one. Reading the
 * leftmost entry — as this did until 2026-07 — let an attacker rotate a fake
 * first hop and land in a fresh bucket on every request, defeating the limiter
 * entirely. That matters well beyond the analytics beacon: the same helper keys
 * the AI/TTS endpoints, which spend real money per request.
 *
 * `x-real-ip` is deliberately NOT consulted: nothing in our infrastructure sets
 * it, so honouring it would just reintroduce a spoofable bypass.
 *
 * Falls back to a constant so a missing header degrades to one shared bucket
 * (fail-safe: over-limits rather than under-limits) instead of throwing.
 */
export function clientIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for');
  if (!xff) return 'unknown';

  const hops = xff
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  if (hops.length === 0) return 'unknown';

  // Count back from the right by the number of proxies we trust to append.
  // Clamp at 0 so a shorter-than-expected chain still yields the leftmost hop
  // we have rather than undefined.
  const idx = Math.max(0, hops.length - TRUSTED_PROXY_HOPS);
  return hops[idx] ?? 'unknown';
}

/** Standard 429 response with Retry-After + rate-limit headers. */
export function rateLimitedResponse(result: RateLimitResult): Response {
  const retryAfterSec = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
  return new Response(
    JSON.stringify({ success: false, error: 'Too many requests. Please slow down.' }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfterSec),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
      },
    }
  );
}

/**
 * Convenience: check the request's IP against a module-level limiter (so state
 * persists across requests on a warm instance). Returns the result; caller
 * returns `rateLimitedResponse` when `!allowed`.
 *
 * Async because `SharedRateLimiter` consults DynamoDB. A plain `RateLimiter`
 * still resolves immediately without a round trip.
 */
export async function checkRateLimit(
  limiter: RateLimiter | SharedRateLimiter,
  request: NextRequest
): Promise<RateLimitResult> {
  return limiter.check(clientIp(request));
}
