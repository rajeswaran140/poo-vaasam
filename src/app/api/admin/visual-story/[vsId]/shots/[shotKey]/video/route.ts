/**
 * POST /api/admin/visual-story/[vsId]/shots/[shotKey]/video — start one Grok
 * Imagine video clip for a shot (spec §6.2.1), under the story's hard budget
 * cap (spec §11 layer 3). `shotKey` is `nnn-mmm` (sceneOrder-shotOrder). No body.
 *
 * Flow: reserve the estimate → write a `submitted` GENJOB → submit to Grok.
 * Accepted ⇒ the job moves to `running` with the provider task id and the
 * reservation stays HELD — the job's poller settles it (billed or not) when
 * the job ends. Refused or thrown ⇒ the job moves to `failed` and the
 * reservation is released (nothing was billed), but only if that conditional
 * transition won: whoever ends the job settles it, exactly once.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { getVideoProvider, type SubmitResult, type VideoGenRequest } from '@/services/video/providers';
import { buildVideoRequest } from '@/services/video/gen-job';
import { settleQuietly } from '@/services/video/storyboard-job';
import { estimateCostUsd } from '@/services/video/cost';
import { candIdForJob, isVsId, newId } from '@/types/visualStory';
import type { GenJob } from '@/types/visualStory';
import { fail, limitMutation, mapError } from '@/lib/visual-story-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ vsId: string; shotKey: string }> };

const SHOT_KEY = /^(\d{3})-(\d{3})$/;

const STATUS_BY_CODE: Record<string, number> = {
  not_configured: 503,
  billing: 503,
  rate_limit: 429,
  content_policy: 422,
};

const errName = (e: unknown) => (e instanceof Error ? e.name : 'error');

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

  const { vsId, shotKey } = await params;
  const m = SHOT_KEY.exec(shotKey);
  if (!isVsId(vsId)) return fail('That story no longer exists.', 404);
  if (!m) return fail('That shot no longer exists.', 404);
  const sceneOrder = Number(m[1]);
  const shotOrder = Number(m[2]);

  const repo = new VisualStoryRepository();
  const provider = getVideoProvider('grok');
  let tree;
  let videoReq: VideoGenRequest;
  let est: number;
  let reserved: boolean;
  try {
    tree = await repo.loadTree(vsId);
    if (!tree) return fail('That story no longer exists.', 404);
    const shot = tree.shots.find((s) => s.sceneOrder === sceneOrder && s.shotOrder === shotOrder);
    if (!shot) return fail('That shot no longer exists.', 404);
    if (!shot.visualPrompt.trim()) return fail('Write a visual prompt first.', 400);
    const busy = tree.genJobs.some(
      (j) =>
        j.sceneOrder === sceneOrder &&
        j.shotOrder === shotOrder &&
        (j.status === 'submitted' || j.status === 'running')
    );
    if (busy) return fail('A video is already rendering for this shot.', 409);
    if (!(await provider.isConfigured())) return fail('Grok video generation is not configured.', 503);

    // Signed before reserving: a signing failure must not strand a reservation.
    videoReq = await buildVideoRequest(tree, shot);
    est = estimateCostUsd('grok', 'HERO', shot.durationSec);
    reserved = await repo.reserve(vsId, est);
  } catch (err) {
    return mapError(err);
  }
  if (!reserved) {
    const { spentUsd, budgetUsdCap } = tree.story;
    return fail(
      `This would go over the story's budget ($${spentUsd.toFixed(2)} of $${budgetUsdCap.toFixed(2)}).`,
      402
    );
  }

  // From here a reservation is held.
  const now = new Date().toISOString();
  const jobId = newId('gj');
  const job: GenJob = {
    jobId,
    sceneOrder,
    shotOrder,
    status: 'submitted',
    providerId: provider.id,
    providerTaskId: null,
    reservedUsd: est,
    candId: candIdForJob(jobId),
    attempts: 0,
    copyFailures: 0,
    lastPolledAt: null,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await repo.createGenJob(vsId, job);
  } catch (err) {
    // No job and no provider call: release the hold here, once.
    await settleQuietly(repo, vsId, est, 0, 'video');
    return mapError(err);
  }

  let result: SubmitResult;
  try {
    // No request.signal: a client navigating away must not abort a call xAI
    // may already have accepted (and will bill).
    result = await provider.submit(videoReq);
  } catch (err) {
    console.error('visual-story video: submit threw', errName(err));
    result = { ok: false, code: 'upstream', error: 'Video generation failed. Please try again.' };
  }

  if (result.ok) {
    try {
      const moved = await repo.transitionGenJob(vsId, jobId, ['submitted'], 'running', {
        providerTaskId: result.providerTaskId,
      });
      if (!moved) console.error('visual-story video: running transition lost', jobId, result.providerTaskId);
    } catch (err) {
      console.error('visual-story video: running transition failed', jobId, result.providerTaskId, errName(err));
    }
    // The reservation stays held; the job's poller settles it.
    return NextResponse.json({ success: true, data: { jobId } }, { status: 202 });
  }

  // Refused before a task existed: nothing was billed. Settle only if this side ended the job.
  let ended: GenJob | null = null;
  try {
    ended = await repo.transitionGenJob(vsId, jobId, ['submitted'], 'failed', {
      code: result.code,
      error: result.error,
    });
  } catch (err) {
    // Left `submitted`; the stale sweep ends and settles it.
    console.error('visual-story video: failed transition failed', jobId, errName(err));
  }
  if (ended) await settleQuietly(repo, vsId, est, 0, 'video');
  return fail(result.error, STATUS_BY_CODE[result.code] ?? 502);
}
