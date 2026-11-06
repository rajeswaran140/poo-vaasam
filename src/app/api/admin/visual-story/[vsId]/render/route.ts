/**
 * POST /api/admin/visual-story/[vsId]/render — queue an assembly of the story
 * (Phase 6, spec §7.4) → 202 { renderId, estimateSec }.
 *
 * Every refusal is decided here, before anything is queued: a shot with
 * nothing chosen, shots that do not fill the window, a render too long for
 * the worker, a render already running. The worker gets the exact shot list
 * (its role cannot Query) on its own `assemble` event key, and writes only
 * this render's RENDER# row. No money moves: assembly is our own compute.
 */

import { NextRequest, NextResponse } from 'next/server';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { awsConfig } from '@/lib/aws-config';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { isVsId, newId } from '@/types/visualStory';
import type { RenderJob } from '@/types/visualStory';
import { fail, limitMutation, mapError } from '@/lib/visual-story-route';
import { isRenderInFlight, planStoryRender, sweepStaleRenders } from '@/lib/visual-story-render';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_WORKER_FUNCTION = process.env.MASTER_WORKER_FUNCTION || 'tamilagaval-master-worker';

type Ctx = { params: Promise<{ vsId: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  let auth;
  try {
    auth = await requireAdmin(request);
    requireBearer(request); // mutation — reject cookie-only auth (CSRF)
  } catch (err) {
    return authErrorResponse(err);
  }
  const limited = limitMutation(auth, request);
  if (limited) return limited;

  const { vsId } = await params;
  if (!isVsId(vsId)) return fail('That story no longer exists.', 404);

  const repo = new VisualStoryRepository();
  let job: RenderJob;
  try {
    const tree = await repo.loadTree(vsId);
    if (!tree) return fail('That story no longer exists.', 404);

    const renders = await sweepStaleRenders(repo, vsId, tree.renders);
    if (renders.some(isRenderInFlight)) return fail('A render is already running for this story.', 409);

    const plan = planStoryRender(tree);
    if (!plan.ok) return fail(plan.message, 409);

    const now = new Date().toISOString();
    job = {
      renderId: newId('rd'),
      status: 'queued',
      aspectRatio: tree.story.aspectRatio,
      windowStartSec: tree.story.windowStartSec,
      windowEndSec: tree.story.windowEndSec,
      shots: plan.shots,
      estimateSec: plan.estimateSec,
      createdAt: now,
      updatedAt: now,
    };
    await repo.createRender(vsId, job);

    try {
      const lambda = new LambdaClient({
        region: awsConfig.region,
        ...(awsConfig.credentials ? { credentials: awsConfig.credentials } : {}),
      });
      await lambda.send(
        new InvokeCommand({
          FunctionName: MASTER_WORKER_FUNCTION,
          InvocationType: 'Event',
          Payload: Buffer.from(
            JSON.stringify({
              // Its own event key, branched on before any mastering guard.
              assemble: {
                vsId,
                renderId: job.renderId,
                audioKey: tree.story.audioKey,
                aspectRatio: job.aspectRatio,
                windowStartSec: job.windowStartSec,
                windowEndSec: job.windowEndSec,
                shots: job.shots,
              },
            })
          ),
        })
      );
    } catch (err) {
      console.error('[visual-story/render] invoke failed:', err instanceof Error ? err.name : 'error');
      await repo
        .transitionRender(vsId, job.renderId, ['queued'], 'failed', { error: 'The render could not be started. Please try again.' })
        .catch(() => null);
      return fail('Could not start the render. Please try again.', 502);
    }
  } catch (err) {
    return mapError(err);
  }
  return NextResponse.json({ success: true, data: { renderId: job.renderId, estimateSec: job.estimateSec } }, { status: 202 });
}
