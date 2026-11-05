/**
 * GET /api/admin/visual-story/[vsId]/draft/jobs/[jobId] — poll a storyboard
 * draft job (R14). Shaped for `pollJob()` (src/lib/poll-job.ts):
 *   queued | running → { status }               (keep polling)
 *   done             → { status: 'done', result: { draftId } }
 *   failed           → { status: 'error', error: { code, message } }
 * `data` carries the job itself (never lyrics — the item has none).
 *
 * The sweep: a queued|running job older than 10 minutes cannot still be on the
 * worker (its Lambda timeout is far shorter), so this read fails it and
 * releases its reservation — by a conditional transition, so it happens at
 * most once and never after the worker finished. That write is server-decided
 * and idempotent (it only ever releases a dead job's hold), so the GET stays
 * cookie-or-bearer like every other admin read.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { sweepStaleDraftJob } from '@/services/video/storyboard-job';
import { isDraftJobId, isVsId } from '@/types/visualStory';
import { fail, mapError } from '@/lib/visual-story-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ vsId: string; jobId: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { vsId, jobId } = await params;
  if (!isVsId(vsId) || !isDraftJobId(jobId)) return fail('That draft no longer exists.', 404);

  try {
    const repo = new VisualStoryRepository();
    const found = await repo.getDraftJob(vsId, jobId);
    if (!found) return fail('That draft no longer exists.', 404);
    const job = await sweepStaleDraftJob(repo, vsId, found);

    const data = {
      jobId: job.jobId,
      status: job.status,
      draftId: job.draftId ?? null,
      code: job.code ?? null,
      error: job.error ?? null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
    if (job.status === 'done') {
      return NextResponse.json({ success: true, status: 'done', result: { draftId: job.draftId }, error: null, data });
    }
    if (job.status === 'failed') {
      return NextResponse.json({
        success: true,
        status: 'error',
        result: null,
        error: { code: job.code ?? 'upstream', message: job.error || 'The draft failed. Please try again.' },
        data,
      });
    }
    return NextResponse.json({ success: true, status: job.status, result: null, error: null, data });
  } catch (err) {
    return mapError(err);
  }
}
