/**
 * Storyboard check.
 *
 * POST { lyrics? } — start a check on the background worker (check-job.ts):
 *   one at a time per story → build the storyboard input → reserve (402 over
 *   the cap) → CHECK#<checkId> 'queued' → async-invoke the compose worker
 *   with the whole storyboard in the event → 202 { checkId }.
 * GET — the newest check, swept, with `outOfDate` when the storyboard has
 *   changed since it ran.
 *
 * Lyrics, when pasted, go only into the invoke payload (never stored, logged
 * or returned) — the same privacy rule as drafts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { awsConfig } from '@/lib/aws-config';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { buildCheckInput, buildCheckMessage } from '@/lib/visual-story-check';
import { storyboardHash } from '@/services/ai/storyboard-checker';
import { checkReserveUsd } from '@/services/video/cost';
import { settleQuietly } from '@/services/video/storyboard-job';
import {
  MAX_CHECK_EVENT_BYTES,
  isCheckInFlight,
  sweepStaleChecks,
  type CheckJobEvent,
} from '@/services/video/check-job';
import { checkRequestSchema, isVsId, newId, type StoryCheck } from '@/types/visualStory';
import { fail, limitMutation, mapError } from '@/lib/visual-story-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ vsId: string }> };

const workerFunction = () => process.env.COMPOSE_WORKER_FUNCTION || 'tamilagaval-compose-worker';
const ENQUEUE_ERROR = 'Could not start the check. Please try again.';

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { vsId } = await params;
  if (!isVsId(vsId)) return fail('That story no longer exists.', 404);
  try {
    const repo = new VisualStoryRepository();
    const tree = await repo.loadTree(vsId);
    if (!tree) return fail('That story no longer exists.', 404);
    const checks = await sweepStaleChecks(repo, vsId);
    const check = [...checks].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
    const outOfDate = !!check && check.shotsHash !== storyboardHash(buildCheckInput(tree));
    return NextResponse.json({ success: true, data: { check, outOfDate } });
  } catch (err) {
    return mapError(err);
  }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  let auth;
  try {
    auth = await requireAdmin(request);
    requireBearer(request); // spends money — reject cookie-only auth (CSRF)
  } catch (err) {
    return authErrorResponse(err);
  }
  const limited = limitMutation(auth, request);
  if (limited) return limited;

  const { vsId } = await params;
  if (!isVsId(vsId)) return fail('That story no longer exists.', 404);
  const parsed = checkRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || 'Invalid request body', 400);
  const lyrics = parsed.data.lyrics || undefined;

  const repo = new VisualStoryRepository();
  let story;
  let event: CheckJobEvent;
  let reserveUsd: number;
  let shotsHash: string;
  try {
    const tree = await repo.loadTree(vsId);
    if (!tree) return fail('That story no longer exists.', 404);
    story = tree.story;
    if (tree.shots.length === 0) return fail('Add some shots first: there is nothing to check yet.', 400);
    if ((await sweepStaleChecks(repo, vsId)).some(isCheckInFlight)) {
      return fail('A check is already running. Wait for it to finish.', 409);
    }
    const input = buildCheckInput(tree);
    shotsHash = storyboardHash(input);
    reserveUsd = checkReserveUsd(buildCheckMessage(input, lyrics).length);
    event = { kind: 'story-check', checkId: newId('ck'), vsId, input, ...(lyrics ? { lyrics } : {}) };
    if (Buffer.byteLength(JSON.stringify(event)) > MAX_CHECK_EVENT_BYTES) {
      return fail('This storyboard is too long to check in one go.', 413);
    }
    if (!(await repo.reserve(vsId, reserveUsd))) {
      return fail(
        `This would go over the story's budget ($${story.spentUsd.toFixed(2)} of $${story.budgetUsdCap.toFixed(2)}).`,
        402
      );
    }
  } catch (err) {
    return mapError(err);
  }

  // A reservation is held from here: released on every failure path, or
  // handed to the worker (which settles it) once the invoke is accepted.
  const now = new Date().toISOString();
  const check: StoryCheck = {
    checkId: event.checkId,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    reservedUsd: reserveUsd,
    shotsHash,
    withLyrics: !!lyrics,
  };
  try {
    await repo.createCheck(vsId, check);
  } catch (err) {
    await settleQuietly(repo, vsId, reserveUsd, 0, 'check enqueue');
    return mapError(err);
  }

  try {
    const lambda = new LambdaClient({
      region: awsConfig.region,
      ...(awsConfig.credentials ? { credentials: awsConfig.credentials } : {}),
    });
    await lambda.send(
      new InvokeCommand({
        FunctionName: workerFunction(),
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify(event)),
      })
    );
  } catch (err) {
    console.error('visual-story check: worker invoke failed', err instanceof Error ? err.name : 'error');
    try {
      const failed = await repo.transitionCheck(vsId, check.checkId, ['queued'], 'failed', {
        code: 'enqueue',
        error: ENQUEUE_ERROR,
      });
      // Lost the transition: the worker got the event after all and owns the check.
      if (!failed) return NextResponse.json({ success: true, data: { checkId: check.checkId } }, { status: 202 });
      await settleQuietly(repo, vsId, reserveUsd, 0, 'check enqueue');
    } catch (e) {
      // Left queued: the sweep fails and releases it after CHECK_STALE_MS.
      console.error('visual-story check: could not fail the check', e instanceof Error ? e.name : 'error');
    }
    return fail(ENQUEUE_ERROR, 502);
  }

  return NextResponse.json({ success: true, data: { checkId: check.checkId } }, { status: 202 });
}
