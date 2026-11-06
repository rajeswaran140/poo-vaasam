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
import type { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { deriveStartSecs, tilesWindow } from '@/types/visualStory';
import type { Shot, VisualStory } from '@/types/visualStory';

export const fail = (error: string, status: number) =>
  NextResponse.json({ success: false, error }, { status });

/** True while any of the story's video clips is still being made. */
export function hasRenderingVideo(tree: { genJobs?: { status: string }[] }): boolean {
  return (tree.genJobs ?? []).some((j) => j.status === 'submitted' || j.status === 'running');
}

/** 409 for a structural edit while a clip renders, so a clip never lands on a moved or missing shot. */
export const failRendering = () => fail('Wait for the video to finish first.', 409);

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

/**
 * After a new picture is saved: choose it if the shot has nothing chosen yet.
 * Best effort: the picture exists (and may be paid for), so a failure here is
 * logged and never changes the response.
 */
export async function chooseIfNone(
  repo: Pick<VisualStoryRepository, 'selectCandidateIfNone'>,
  vsId: string,
  sceneOrder: number,
  shotOrder: number,
  candId: string
): Promise<void> {
  try {
    await repo.selectCandidateIfNone(vsId, sceneOrder, shotOrder, candId);
  } catch (err) {
    console.error('visual-story: auto-choose failed', err instanceof Error ? err.name : 'error');
  }
}
