/**
 * Per-admin rate limiter for the visual-story create route.
 * Own module because Next route files may only export handlers/config.
 */

import { RateLimiter } from '@/lib/rate-limit';

export const visualStoryLimiter = new RateLimiter({ windowMs: 60_000, max: 20 });

/** Test hook: reset limiter state so cases don't bleed into one another. */
export function __resetVisualStoryRateLimitForTests(): void {
  visualStoryLimiter.reset();
}
