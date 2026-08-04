/**
 * POST /api/admin/music-lab/master/[jobId]/render — build the YouTube video for
 * a saved master: cover art over the MASTERED audio, encoded once.
 *
 * WHY IT IS A JOB RATHER THAN A RESPONSE. A six-minute 1440p encode is well
 * past what an SSR request should hold open, so this Event-invokes the same
 * master-worker Lambda (which already carries the ffmpeg layer and the bucket
 * access) and returns immediately. The Studio polls the existing status route —
 * `videoKey` appears on the job when the render lands.
 *
 * The render deliberately reads `job.masterKey`, never the web MP3: feeding a
 * 192k file into the upload would stack a lossy generation in front of the one
 * YouTube performs anyway. `planRender` enforces that; this route only decides
 * whether the request is well-formed and allowed.
 *
 * Nothing here publishes. The MP4 lands in the mastering workspace, which is
 * Denied to CloudFront, and the admin downloads it and uploads to YouTube.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { awsConfig } from '@/lib/aws-config';
import { planRender, renderRefusalMessage, DEFAULT_VIDEO_HEIGHT } from '@/lib/master-video';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_WORKER_FUNCTION = process.env.MASTER_WORKER_FUNCTION || 'tamilagaval-master-worker';

const bodySchema = z.object({
  coverKey: z.string().min(1),
  height: z.number().int().optional(),
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
    return NextResponse.json({ success: false, error: 'A cover image is required.' }, { status: 400 });
  }
  const height = parsed.data.height ?? DEFAULT_VIDEO_HEIGHT;

  try {
    const job = await new MasterJobRepository().get(jobId);
    if (!job) return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });

    // Every eligibility rule lives in the planner, so the route and the worker
    // cannot disagree about what is renderable.
    const plan = planRender(job, parsed.data.coverKey, height);
    if (!plan.ok) {
      return NextResponse.json(
        { success: false, error: renderRefusalMessage(plan.reason) },
        { status: 409 }
      );
    }

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
            jobId,
            // A distinct shape from a mastering event: the worker branches on
            // `render` before any of the loudness passes, so a render can never
            // re-master (and re-measure) a file that is already finished.
            render: { audioKey: plan.audioKey, coverKey: plan.coverKey, height: plan.height },
          })
        ),
      })
    );

    return NextResponse.json(
      { success: true, videoKey: plan.videoKey, height: plan.height, status: 'queued' },
      { status: 202 }
    );
  } catch (err) {
    console.error('[api/music-lab/master/:jobId/render] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not start the video render.' }, { status: 502 });
  }
}
