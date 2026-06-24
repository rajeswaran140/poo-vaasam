/**
 * Lightweight in-memory IP rate limiter for the unauthenticated AI/TTS
 * endpoints (OpenAI / Anthropic / Google TTS spend on attacker-supplied input).
 *
 * Scope & limits: this is a per-instance sliding-window limiter, not a globally
 * consistent one — Amplify SSR Lambdas don't share memory and there's no Redis.
 * It still meaningfully caps a single scripted client hammering one warm
 * instance, which is the realistic abuse vector. Move to a shared store
 * (DynamoDB TTL / Upstash) if/when we need cross-instance guarantees.
 */

import { NextRequest } from 'next/server';

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

/**
 * Best-effort client IP from proxy headers (Amplify/CloudFront sets
 * x-forwarded-for). Falls back to a constant so a missing header degrades to a
 * single shared bucket rather than throwing.
 */
export function clientIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
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
 * Convenience: build a limiter + check the request's IP in one call. Pass a
 * module-level `RateLimiter` so state persists across requests on a warm
 * instance. Returns the result; caller returns `rateLimitedResponse` when
 * `!allowed`.
 */
export function checkRateLimit(limiter: RateLimiter, request: NextRequest): RateLimitResult {
  return limiter.check(clientIp(request));
}
