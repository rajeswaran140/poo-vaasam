/**
 * Per-admin rate limiter for POST /api/admin/compose.
 *
 * Compose fires an off-platform Sonnet generation (~30-40s, ~6k output tokens
 * + a Lambda invocation) — the costliest operation in the app. Cap it PER ADMIN
 * so a single account (or a stolen session) can't spawn unbounded concurrent
 * Sonnet runs. 10/min is far above any human compose rate.
 *
 * This lives in its own module (not the route file) because Next validates that
 * a route module exports only known handlers/config — so the test-reset hook
 * can't be exported from the route itself.
 */

import { RateLimiter } from '@/lib/rate-limit';

export const composeLimiter = new RateLimiter({ windowMs: 60_000, max: 10 });

/** Test hook: reset limiter state so cases don't bleed into one another. */
export function __resetComposeRateLimitForTests(): void {
  composeLimiter.reset();
}
