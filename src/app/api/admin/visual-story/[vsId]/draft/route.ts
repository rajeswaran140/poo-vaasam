/**
 * POST /api/admin/visual-story/[vsId]/draft — { lyrics } — start a storyboard
 * draft (spec §6.5) on the background worker, under the story's hard cap.
 *
 * Why a job (R14, owner decision 2026-11-04): a real draft takes ~45-65 s
 * (measured live), far past Amplify's ~30 s ceiling — inline, every draft
 * died before it could settle. So this route only ENQUEUES:
 *   reserve (402 when it would cross the cap) → DRAFTJOB#<jobId> 'queued'
 *   → async-invoke the compose worker (kind 'storyboard') → 202 { jobId }.
 * The worker calls Claude, saves the draft and settles; the client polls
 * GET .../draft/jobs/[jobId]. A job that died on the worker is failed +
 * released by the sweep on that poll, on every story load, and here before
 * reserving.
 *
 * Money: the reservation is bounded by the lyrics length (draftReserveUsd).
 * If the job cannot be written or the worker cannot be invoked, the
 * reservation is released here (unbilled) — for a failed invoke only via the
 * conditional queued → failed transition, so a worker that did receive the
 * event and claimed the job settles instead (exactly one settle).
 *
 * Privacy (spec §12): the lyrics go only into the worker's invoke payload and
 * from there to the model. Never stored (the job item has no lyrics, the draft
 * keeps a SHA-256), never returned, never logged.
 */

import { NextRequest, NextResponse } from 'next/server';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { awsConfig } from '@/lib/aws-config';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { draftReserveUsd } from '@/services/video/cost';
import { settleQuietly, sweepStaleDraftJobs, type StoryboardJobEvent } from '@/services/video/storyboard-job';
import { draftRequestSchema, isVsId, newId, type DraftJob } from '@/types/visualStory';
import { fail, limitMutation, mapError } from '@/lib/visual-story-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ vsId: string }> };

/** Same worker and invoke pattern as /api/admin/compose. */
const workerFunction = () => process.env.COMPOSE_WORKER_FUNCTION || 'tamilagaval-compose-worker';
const ENQUEUE_ERROR = 'Could not start the draft. Please try again.';

export async function POST(request: NextRequest, { params }: Ctx) {
  let auth;
  try {
    auth = await requireAdmin(request);
    requireBearer(request); // mutation that spends money — reject cookie-only auth (CSRF)
  } catch (err) {
    return authErrorResponse(err);
  }
  const limited = limitMutation(auth, request);
  if (limited) return limited;

  const { vsId } = await params;
  if (!isVsId(vsId)) return fail('That story no longer exists.', 404);

  const parsed = draftRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || 'Invalid request body', 400);
  const { lyrics } = parsed.data;

  const repo = new VisualStoryRepository();
  let story;
  let reserveUsd = 0;
  let reserved: boolean;
  try {
    story = await repo.findById(vsId);
    if (!story) return fail('That story no longer exists.', 404);
    // A dead job's hold must not cause a false 402 (never throws).
    await sweepStaleDraftJobs(repo, vsId);
    // A longer window may write more tokens, so it reserves more.
    reserveUsd = draftReserveUsd(lyrics, story.windowEndSec - story.windowStartSec);
    reserved = await repo.reserve(vsId, reserveUsd);
  } catch (err) {
    return mapError(err);
  }
  if (!reserved) {
    return fail(
      `This would go over the story's budget ($${story.spentUsd.toFixed(2)} of $${story.budgetUsdCap.toFixed(2)}).`,
      402
    );
  }

  // From here a reservation is held: it is released here on every failure path,
  // or handed to the worker (which settles it) once the invoke is accepted.
  const now = new Date().toISOString();
  const job: DraftJob = { jobId: newId('dj'), status: 'queued', createdAt: now, updatedAt: now, reservedUsd: reserveUsd };
  try {
    await repo.createDraftJob(vsId, job);
  } catch (err) {
    await settleQuietly(repo, vsId, reserveUsd, 0, 'draft enqueue');
    return mapError(err);
  }

  const event: StoryboardJobEvent = {
    kind: 'storyboard',
    jobId: job.jobId,
    vsId,
    lyrics,
    windowSec: story.windowEndSec - story.windowStartSec,
    aspectRatio: story.aspectRatio,
    // Absent when the story has none, so the event keeps its original shape.
    ...(story.style ? { style: story.style } : {}),
  };
  try {
    const lambda = new LambdaClient({
      region: awsConfig.region,
      ...(awsConfig.credentials ? { credentials: awsConfig.credentials } : {}),
    });
    await lambda.send(
      new InvokeCommand({
        FunctionName: workerFunction(),
        InvocationType: 'Event', // returns at once; the worker runs off-Amplify
        Payload: Buffer.from(JSON.stringify(event)),
      })
    );
  } catch (err) {
    console.error('visual-story draft: worker invoke failed', err instanceof Error ? err.name : 'error');
    try {
      const failed = await repo.transitionDraftJob(vsId, job.jobId, ['queued'], 'failed', {
        code: 'enqueue',
        error: ENQUEUE_ERROR,
      });
      // Lost the transition: the worker got the event after all and owns the job.
      if (!failed) return NextResponse.json({ success: true, data: { jobId: job.jobId } }, { status: 202 });
      await settleQuietly(repo, vsId, reserveUsd, 0, 'draft enqueue');
    } catch (e) {
      // Job left queued: the job route's sweep fails and releases it after 10 minutes.
      console.error('visual-story draft: could not fail the job', e instanceof Error ? e.name : 'error');
    }
    return fail(ENQUEUE_ERROR, 502);
  }

  return NextResponse.json({ success: true, data: { jobId: job.jobId } }, { status: 202 });
}
