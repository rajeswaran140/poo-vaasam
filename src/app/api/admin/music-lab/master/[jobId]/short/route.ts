/**
 * POST /api/admin/music-lab/master/[jobId]/short — cut a vertical hook clip
 * (1080x1920, 30s) from a saved master, for Reels / Instagram / Shorts.
 *
 * The sibling of the `render` route, and deliberately shaped like it: a job,
 * not a response, Event-invoked on the same master-worker Lambda (which already
 * carries the ffmpeg layer and the bucket access). The Studio polls the existing
 * status route — `shortKey` appears on the job when the clip lands.
 *
 * Like `render`, this reads `job.masterKey` and never the web MP3: a clip is the
 * thing most likely to be re-encoded again by whatever platform it is posted to,
 * so it must not start life a generation down.
 *
 * Nothing here publishes. The MP4 lands in the mastering workspace, which is
 * Denied to CloudFront; the operator downloads it and posts it by hand. There is
 * no Meta API in this path and no scheduled posting.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { awsConfig } from '@/lib/aws-config';
import { planShort, shortRefusalMessage } from '@/lib/master-short';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_WORKER_FUNCTION = process.env.MASTER_WORKER_FUNCTION || 'tamilagaval-master-worker';

const bodySchema = z.object({
  coverKey: z.string().min(1),
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

  try {
    const job = await new MasterJobRepository().get(jobId);
    if (!job) return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });

    // Every eligibility rule lives in the planner, so the route and the worker
    // cannot disagree about what can produce a short.
    const plan = planShort(job, parsed.data.coverKey);
    if (!plan.ok) {
      return NextResponse.json(
        { success: false, error: shortRefusalMessage(plan.reason) },
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
            // A distinct shape again: the worker branches on `short` before the
            // mastering guards, so cutting a clip can never re-master (and
            // re-measure) a file that is already finished.
            short: { audioKey: plan.audioKey, coverKey: plan.coverKey },
          })
        ),
      })
    );

    return NextResponse.json(
      { success: true, shortKey: plan.shortKey, status: 'queued' },
      { status: 202 }
    );
  } catch (err) {
    console.error('[api/music-lab/master/:jobId/short] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not start the short render.' }, { status: 502 });
  }
}
