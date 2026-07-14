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
 * Convenience: build a limiter + check the request's IP in one call. Pass a
 * module-level `RateLimiter` so state persists across requests on a warm
 * instance. Returns the result; caller returns `rateLimitedResponse` when
 * `!allowed`.
 */
export function checkRateLimit(limiter: RateLimiter, request: NextRequest): RateLimitResult {
  return limiter.check(clientIp(request));
}
