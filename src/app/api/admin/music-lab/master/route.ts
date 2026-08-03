/**
 * POST /api/admin/music-lab/master — enqueue an async mastering job for a "hot"
 * take. Body: { s3Key, target=-14, edit? }. Admin-gated, Node runtime.
 *
 * `edit` is an optional trim/fade the worker applies in a lossless pre-pass
 * BEFORE the loudnorm passes — see src/lib/master-edit.ts for why that ordering
 * is not negotiable. Omitting it masters the full source, exactly as before.
 *
 * Creates a `processing` MasterJob in DynamoDB, fire-and-forget invokes the
 * `master-worker` Lambda (Event invocation — returns instantly), and returns the
 * jobId. The worker (ffmpeg layer, up to 15 min) does the two-pass loudnorm off
 * the request path; the client polls GET /api/admin/music-lab/master/[jobId].
 * (Repo idiom: Event-invoke + DynamoDB job, NOT SQS.)
 *
 * The source key is constrained to the mastering workspace prefix, matching the
 * download route: without it an admin session could run the ffmpeg worker
 * against ANY object in the bucket. The bucket is likewise NOT caller-supplied —
 * the worker reads its own TAKES_BUCKET — so a request can't point the worker at
 * an arbitrary bucket.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { awsConfig } from '@/lib/aws-config';
import { isValidTarget, isMasterKey, MIN_TARGET_LUFS, MAX_TARGET_LUFS } from '@/lib/loudness-measure';
import { isMasteringKey } from '@/lib/mastering-storage';
import { parseMasterEdit, isNoOpEdit } from '@/lib/master-edit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_WORKER_FUNCTION = process.env.MASTER_WORKER_FUNCTION || 'tamilagaval-master-worker';

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    // Defense-in-depth CSRF: reject cookie-only auth on this mutation
    // (matches the pattern on the other admin mutation routes).
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const body = await request.json().catch(() => null);
  const s3Key = (body?.s3Key as string)?.replace(/^\/+/, '');
  // Only keys inside the mastering workspace may be enqueued — an admin session
  // must not be able to run the worker against arbitrary bucket objects.
  if (!isMasteringKey(s3Key)) {
    return NextResponse.json(
      { success: false, error: 'That key is not in the mastering workspace.' },
      { status: 400 }
    );
  }
  if (isMasterKey(s3Key)) {
    return NextResponse.json(
      { success: false, error: 'That key is already a mastering output — master the original source instead.' },
      { status: 400 }
    );
  }
  // Reject a bad target outright rather than silently falling back to -14: a
  // caller asking for Apple's -16 and getting -14 would never notice.
  const target = body?.target === undefined ? -14 : body.target;
  if (!isValidTarget(target)) {
    return NextResponse.json(
      { success: false, error: `target must be a number in [${MIN_TARGET_LUFS}, ${MAX_TARGET_LUFS}] LUFS` },
      { status: 400 }
    );
  }
  // Trim/fade is optional and absent from every pre-existing caller, so a
  // missing `edit` parses to the identity rather than failing. A malformed one
  // is rejected here instead of failing deep inside ffmpeg 30 seconds later.
  const parsedEdit = parseMasterEdit(body?.edit);
  if (!parsedEdit.ok) {
    return NextResponse.json({ success: false, error: parsedEdit.error }, { status: 400 });
  }
  // Store null for "no edit" so the job record can't imply an edit happened.
  const edit = isNoOpEdit(parsedEdit.edit) ? null : parsedEdit.edit;

  const jobId = randomUUID();

  try {
    await new MasterJobRepository().create(jobId, { s3Key, target, edit });
    const lambda = new LambdaClient({
      region: awsConfig.region,
      ...(awsConfig.credentials ? { credentials: awsConfig.credentials } : {}),
    });
    await lambda.send(
      new InvokeCommand({
        FunctionName: MASTER_WORKER_FUNCTION,
        InvocationType: 'Event', // async — returns at once
        Payload: Buffer.from(JSON.stringify({ jobId, s3Key, target, edit })),
      })
    );
    return NextResponse.json({ success: true, jobId, status: 'queued' }, { status: 202 });
  } catch (err) {
    console.error('[api/music-lab/master] enqueue failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not start the mastering job.' }, { status: 502 });
  }
}
