/**
 * Shared plumbing for the visual-story edit routes (Next route files may only
 * export handlers, so the common parts live here).
 */

import { NextRequest, NextResponse } from 'next/server';
import { rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { visualStoryLimiter } from '@/lib/visual-story-rate-limit';
import {
  VisualStoryDomainError,
  NotFoundError,
  CapBelowCommittedError,
} from '@/infrastructure/database/VisualStoryRepository';
import { deriveStartSecs, tilesWindow } from '@/types/visualStory';
import type { Shot, VisualStory } from '@/types/visualStory';

export const fail = (error: string, status: number) =>
  NextResponse.json({ success: false, error }, { status });

/** Per-admin rate limit for a mutation. Returns a Response to send, or null to proceed. */
export function limitMutation(
  auth: { userId?: string; email?: string },
  request: NextRequest
): Response | null {
  const rl = visualStoryLimiter.check(auth.userId || auth.email || clientIp(request));
  return rl.allowed ? null : rateLimitedResponse(rl);
}

export function mapError(err: unknown) {
  if (err instanceof CapBelowCommittedError) return fail(err.message, 409);
  if (err instanceof NotFoundError) return fail('That item no longer exists.', 404);
  if (err instanceof VisualStoryDomainError) return fail(err.message, 400);
  console.error('visual-story route failed', err instanceof Error ? err.name : 'error');
  return fail('Something went wrong.', 500);
}

/** Shots with startSec recomputed, plus whether they tile the story's window. */
export function timelineOf(story: Pick<VisualStory, 'windowStartSec' | 'windowEndSec'>, shots: Shot[]) {
  const starts = deriveStartSecs(shots);
  const windowSec = story.windowEndSec - story.windowStartSec;
  return {
    shots: shots.map((s, n) => ({ ...s, startSec: starts[n] })),
    tiling: {
      totalSec: shots.reduce((sum, s) => sum + s.durationSec, 0),
      windowSec,
      tiles: tilesWindow(shots, windowSec),
    },
  };
}
