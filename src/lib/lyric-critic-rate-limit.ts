/**
 * Per-admin rate limiter for POST /api/admin/compose/critique.
 *
 * Critique fires a Sonnet call per request — cap it PER ADMIN so a single
 * account (or a stolen session) can't spawn unbounded concurrent runs. 15/min is
 * comfortably above any human review rate. Kept independent of the lyric/compose
 * limiters so the costs don't share a budget.
 *
 * Lives in its own module (not the route) because Next validates that a route
 * module exports only known handlers/config — so the test-reset hook can't be
 * exported from the route itself.
 */

import { RateLimiter } from '@/lib/rate-limit';

export const lyricCriticLimiter = new RateLimiter({ windowMs: 60_000, max: 15 });

/** Test hook: reset limiter state so cases don't bleed into one another. */
export function __resetLyricCriticRateLimitForTests(): void {
  lyricCriticLimiter.reset();
}
