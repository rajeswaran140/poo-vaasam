/**
 * POST /api/admin/music-lab/master — enqueue an async mastering job for a "hot"
 * take. Body: { s3Key, bucket?, target=-14 }. Admin-gated, Node runtime.
 *
 * Creates a `processing` MasterJob in DynamoDB, fire-and-forget invokes the
 * `master-worker` Lambda (Event invocation — returns instantly), and returns the
 * jobId. The worker (ffmpeg layer, up to 15 min) does the two-pass loudnorm off
 * the request path; the client polls GET /api/admin/music-lab/master/[jobId].
 * (Repo idiom: Event-invoke + DynamoDB job, NOT SQS.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { awsConfig } from '@/lib/aws-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_WORKER_FUNCTION = process.env.MASTER_WORKER_FUNCTION || 'tamilagaval-master-worker';

const validKey = (k: unknown): k is string =>
  typeof k === 'string' && k.length > 0 && k.length <= 1024 && !k.includes('..') && !/^https?:\/\//i.test(k);

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const body = await request.json().catch(() => null);
  const s3Key = (body?.s3Key as string)?.replace(/^\/+/, '');
  if (!validKey(s3Key)) {
    return NextResponse.json({ success: false, error: 'A valid s3Key is required' }, { status: 400 });
  }
  const target = Number.isFinite(body?.target) ? Number(body.target) : -14;
  const bucket = typeof body?.bucket === 'string' ? body.bucket : undefined;
  const jobId = randomUUID();

  try {
    await new MasterJobRepository().create(jobId, { s3Key, target });
    const lambda = new LambdaClient({
      region: awsConfig.region,
      ...(awsConfig.credentials ? { credentials: awsConfig.credentials } : {}),
    });
    await lambda.send(
      new InvokeCommand({
        FunctionName: MASTER_WORKER_FUNCTION,
        InvocationType: 'Event', // async — returns at once
        Payload: Buffer.from(JSON.stringify({ jobId, s3Key, ...(bucket ? { bucket } : {}), target })),
      })
    );
    return NextResponse.json({ success: true, jobId, status: 'queued' }, { status: 202 });
  } catch (err) {
    console.error('[api/music-lab/master] enqueue failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not start the mastering job.' }, { status: 502 });
  }
}
