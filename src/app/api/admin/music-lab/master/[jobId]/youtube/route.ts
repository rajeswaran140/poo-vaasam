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
    // cannot disagree. The worker re-runs it on the event it receives.
    const plan = planUpload(job, parsed.data);
    if (!plan.ok) {
      return NextResponse.json({ success: false, error: uploadRefusalMessage(plan.reason) }, { status: 409 });
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
    console.error('[api/music-lab/master/:jobId/youtube] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not start the upload.' }, { status: 502 });
  }
}
