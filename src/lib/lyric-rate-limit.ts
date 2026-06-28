/**
 * Per-admin rate limiter for POST /api/admin/compose/lyrics.
 *
 * Lyric generation fires a Sonnet call per request — cap it PER ADMIN so a
 * single account (or a stolen session) can't spawn unbounded concurrent runs.
 * 10/min is far above any human authoring rate. Kept independent of the
 * composeLimiter so the two costs don't share a budget.
 *
 * Lives in its own module (not the route) because Next validates that a route
 * module exports only known handlers/config — so the test-reset hook can't be
 * exported from the route itself.
 */

import { RateLimiter } from '@/lib/rate-limit';

export const lyricLimiter = new RateLimiter({ windowMs: 60_000, max: 10 });

/** Test hook: reset limiter state so cases don't bleed into one another. */
export function __resetLyricRateLimitForTests(): void {
  lyricLimiter.reset();
}
