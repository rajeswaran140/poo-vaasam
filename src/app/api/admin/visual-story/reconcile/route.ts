/**
 * POST /api/admin/visual-story/reconcile — the "Check rendering videos" sweep.
 *
 * Advances every in-flight video job ONE step, sequentially, and stops
 * starting new ones once RECONCILE_BUDGET_MS has elapsed; the rest are
 * reported as still rendering and the next press picks them up.
 * → { success, data: { checked, finished, stillRunning } }
 *
 * Button-only (owner's decision): nothing calls this on page load. A mutation
 * that can settle money, so it needs a bearer token. The request's abort
 * signal is never forwarded — a client navigating away must not cut a poll or
 * a clip copy short (R10). advanceGenJob settles behind conditional
 * transitions, so overlapping sweeps/polls settle each job at most once.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { getVideoProvider } from '@/services/video/providers';
import { advanceGenJob } from '@/services/video/gen-job';
import { limitMutation, mapError } from '@/lib/visual-story-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RECONCILE_BUDGET_MS = 20_000;

export async function POST(request: NextRequest) {
  let auth;
  try {
    auth = await requireAdmin(request);
    requireBearer(request); // settles money — reject cookie-only auth (CSRF)
  } catch (err) {
    return authErrorResponse(err);
  }
  const limited = limitMutation(auth, request);
  if (limited) return limited;

  try {
    const repo = new VisualStoryRepository();
    const inflight = await repo.listInflight();
    const provider = getVideoProvider('grok');
    const startedAt = Date.now();
    let checked = 0;
    let finished = 0;
    for (const { vsId, job } of inflight) {
      if (Date.now() - startedAt >= RECONCILE_BUDGET_MS) break;
      checked++;
      try {
        // No request.signal anywhere here.
        const after = await advanceGenJob(repo, provider, vsId, job);
        if (after.status === 'succeeded' || after.status === 'failed' || after.status === 'cancelled') finished++;
      } catch (err) {
        console.error('visual-story reconcile: advance failed', err instanceof Error ? err.name : 'error');
      }
    }
    return NextResponse.json({
      success: true,
      data: { checked, finished, stillRunning: inflight.length - finished },
    });
  } catch (err) {
    return mapError(err);
  }
}
