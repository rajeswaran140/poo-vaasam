/**
 * /api/admin/visual-story/[vsId]/video-jobs/[jobId] — one Grok video job.
 *
 * GET  — advance the job ONE step (poll Grok; on success copy the clip into
 *        private storage, record the candidate and settle the reservation;
 *        end a job stale after an hour) and return it: `{ success, data: GenJob }`
 *        (Ruling V2). Every settle is behind a conditional transition, so
 *        concurrent polls settle at most once; like the draft-job poll, the
 *        GET stays cookie-or-bearer.
 * POST — `{ op: 'cancel' }`: cancel a submitted|running job (409 once it has
 *        finished). A mutation that settles money, so it needs a bearer token.
 *
 * Neither handler forwards the request's abort signal: a client navigating
 * away must not cut a poll or a clip copy short (R10).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { getVideoProvider } from '@/services/video/providers';
import { advanceGenJob, cancelGenJob } from '@/services/video/gen-job';
import { isGenJobId, isVsId } from '@/types/visualStory';
import { fail, limitMutation, mapError } from '@/lib/visual-story-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ vsId: string; jobId: string }> };

const GONE = 'That video no longer exists.';
const FINISHED = 'This video already finished.';

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { vsId, jobId } = await params;
  if (!isVsId(vsId) || !isGenJobId(jobId)) return fail(GONE, 404);

  try {
    const repo = new VisualStoryRepository();
    const found = await repo.getGenJob(vsId, jobId);
    if (!found) return fail(GONE, 404);
    // No request.signal anywhere below.
    const job = await advanceGenJob(repo, getVideoProvider('grok'), vsId, found);
    return NextResponse.json({ success: true, data: job });
  } catch (err) {
    return mapError(err);
  }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  let auth;
  try {
    auth = await requireAdmin(request);
    requireBearer(request); // settles money — reject cookie-only auth (CSRF)
  } catch (err) {
    return authErrorResponse(err);
  }
  const limited = limitMutation(auth, request);
  if (limited) return limited;

  const { vsId, jobId } = await params;
  if (!isVsId(vsId) || !isGenJobId(jobId)) return fail(GONE, 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('Unknown request.', 400);
  }
  if (!body || typeof body !== 'object' || (body as { op?: unknown }).op !== 'cancel') {
    return fail('Unknown request.', 400);
  }

  try {
    const repo = new VisualStoryRepository();
    const found = await repo.getGenJob(vsId, jobId);
    if (!found) return fail(GONE, 404);
    const cancelled = await cancelGenJob(repo, vsId, found);
    if (!cancelled) return fail(FINISHED, 409);
    return NextResponse.json({ success: true, data: cancelled });
  } catch (err) {
    return mapError(err);
  }
}
