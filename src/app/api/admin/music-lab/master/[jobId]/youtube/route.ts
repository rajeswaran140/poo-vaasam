/**
 * POST /api/admin/music-lab/master/[jobId]/youtube — upload an already-rendered
 * video to YouTube as a PRIVATE draft.
 *
 * WHY IT IS A JOB RATHER THAN A RESPONSE. Amplify managed compute caps
 * execution near 30 s and drops `after()`, so this Event-invokes the worker and
 * returns immediately, exactly as the render route does. The Studio polls the
 * existing status route — `youtubeVideoId` appears when the upload lands.
 *
 * WHY THE TOKEN IS NOT HERE. Uploading needs the force-ssl scope, which can
 * also delete videos and post comments. This app holds readonly analytics
 * scope and keeps it; only the private worker reads the write token from SSM.
 *
 * Nothing here publishes publicly. The upload is private, and the Data API
 * cannot create a Premiere — that stays a Studio action, permanently.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { awsConfig } from '@/lib/aws-config';
import { planUpload, uploadRefusalMessage } from '@/lib/youtube-upload';
import { consumeQuota, youtubeUploadCost } from '@/lib/youtube-quota';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_WORKER_FUNCTION = process.env.MASTER_WORKER_FUNCTION || 'tamilagaval-master-worker';

const bodySchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().min(1).max(5000),
  tags: z.array(z.string()).max(60).default([]),
  playlistIds: z.array(z.string()).max(10).default([]),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const { jobId } = await params;
  if (!jobId) return NextResponse.json({ success: false, error: 'jobId required' }, { status: 400 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'A title and description are required.' }, { status: 400 });
  }

  try {
    const repo = new MasterJobRepository();
    const job = await repo.get(jobId);
    if (!job) return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });

    // Every eligibility rule lives in the planner, so the route and the worker
    // cannot disagree. The worker re-runs it on the event it receives — at
    // `stage: 'execute'`, because by then THIS request has already marked the
    // job queued and the worker is the upload that status refers to.
    //
    // 'enqueue' is this route's role: the gate, standing outside the upload.
    // It is the one caller that must honour the `in-flight` refusal, which is
    // what makes a double-click lose the race below.
    const plan = planUpload(job, parsed.data, { stage: 'enqueue' });
    if (!plan.ok) {
      return NextResponse.json({ success: false, error: uploadRefusalMessage(plan.reason) }, { status: 409 });
    }

    // CHARGE THE QUOTA LEDGER BEFORE ENQUEUEING, never after.
    //
    // An upload is the most expensive thing this project does — videos.insert
    // alone is 1600 of a 10,000/day budget shared with the analytics routes,
    // and the thumbnail and each playlist add 50 more. Until 2026-09-16 none
    // of it was charged: an audit found the ledger reading 65 units on a day
    // roughly 2,100 had been spent. The guard would have reported headroom
    // right up to the moment Google started returning 403.
    //
    // Charged here rather than in the worker because the worker is fire-and-
    // forget: if it fails or is throttled, the units it already sent to Google
    // are spent regardless. Over-charging when an upload later fails is the
    // safe direction; under-charging is what leaves the operator staring at an
    // unexplained 403 with a ledger that says there is room.
    const cost = youtubeUploadCost({
      withThumbnail: Boolean(plan.coverKey),
      playlistCount: plan.playlistIds.length,
    });
    const quota = await consumeQuota(cost, { surface: 'data' });
    if (quota.blocked) {
      return NextResponse.json(
        {
          success: false,
          error: `Daily YouTube quota guard tripped (${quota.used}/${quota.limit} for ${quota.day} Pacific). An upload costs ${cost} units. Resets at midnight Pacific.`,
        },
        { status: 429 }
      );
    }

    // Queued BEFORE the invoke, so a double-click loses the race at the
    // planner's `in-flight` guard rather than starting two uploads.
    await repo.markUploadQueued(jobId);

    const lambda = new LambdaClient({
      region: awsConfig.region,
      ...(awsConfig.credentials ? { credentials: awsConfig.credentials } : {}),
    });
    await lambda.send(new InvokeCommand({
      FunctionName: MASTER_WORKER_FUNCTION,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ jobId, youtube: parsed.data })),
    }));

    return NextResponse.json({ success: true, status: 'queued' }, { status: 202 });
  } catch (err) {
    // NO COMPENSATING WRITE HERE ON PURPOSE. If `lambda.send` throws after
    // `markUploadQueued` already succeeded, the job is left sitting at
    // `queued` with (as far as this route knows) no worker running, and the
    // caller gets a 502. Rolling `uploadStatus` back to something retryable
    // would be worse: a network timeout can follow a request the Lambda
    // service actually accepted, so a rollback could let a second invoke
    // start while the first is genuinely running — exactly the duplicate
    // video this whole queued-before-invoke ordering exists to prevent.
    // Leaving it `queued` fails closed. `markUploadQueued` stamps
    // `updatedAt`, so `UPLOAD_STALE_AFTER_MS` is the recovery path: once the
    // Lambda's 900s ceiling plus margin has passed with no update, the job is
    // provably not still running and `planUpload` lets the operator retry.
    console.error('[api/music-lab/master/:jobId/youtube] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not start the upload.' }, { status: 502 });
  }
}
