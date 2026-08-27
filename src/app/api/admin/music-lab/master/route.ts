/**
 * POST /api/admin/music-lab/master — enqueue an async mastering job for a "hot"
 * take. Body: { s3Key, target=-14, edit? }. Admin-gated, Node runtime.
 *
 * `edit` is an optional trim/fade the worker applies in a lossless pre-pass
 * BEFORE the loudnorm passes — see src/lib/master-edit.ts for why that ordering
 * is not negotiable. Omitting it masters the full source, exactly as before.
 *
 * `join` is an optional two-part assembly (Part B + an equal-power crossfade),
 * applied in the SAME pre-pass so the song is spliced before it is measured —
 * mastering two halves separately and crossfading afterwards leaves neither on
 * target. See src/lib/master-join.ts.
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
import { isMasteringKey, isReferenceKey } from '@/lib/mastering-storage';
import { parseMasterEdit, isNoOpEdit } from '@/lib/master-edit';
import { parseMasterJoin } from '@/lib/master-join';
import { FEATURES } from '@/config/features';
import type { MatchingMethod } from '@/types/masterJob';

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

  // Two-part assembly. Optional and absent from every pre-existing caller.
  const parsedJoin = parseMasterJoin(body?.join);
  if (!parsedJoin.ok) {
    return NextResponse.json({ success: false, error: parsedJoin.error }, { status: 400 });
  }
  const join = parsedJoin.join;
  // Part B gets the SAME guards as Part A. Without this the join field would be
  // a second, unchecked route to running the worker against any object in the
  // bucket — the exact hole the s3Key check above exists to close.
  if (join && (!isMasteringKey(join.partBKey) || isMasterKey(join.partBKey))) {
    return NextResponse.json(
      { success: false, error: 'Part B must be an un-mastered file in the mastering workspace.' },
      { status: 400 }
    );
  }
  if (join && join.partBKey === s3Key) {
    // Crossfading a file into itself produces a shorter copy of the same song
    // and masters perfectly cleanly, so nothing downstream would flag it.
    return NextResponse.json(
      { success: false, error: 'Part B must be a different file from Part A.' },
      { status: 400 }
    );
  }

  // Reference-matched mastering (Phase 1B). All three fields optional;
  // absent → loudnorm-only, existing behaviour. Feature-flagged: when the
  // flag is off any use of these fields is refused with 501 rather than
  // silently ignored, because a silent ignore would let the UI ship the
  // feature "quietly" without ever being wired through.
  const rawMethod = body?.matchingMethod;
  const rawRefKey = typeof body?.referenceKey === 'string' ? body.referenceKey.replace(/^\/+/, '') : undefined;
  const rawRefId = typeof body?.referenceId === 'string' ? body.referenceId : undefined;
  const wantsMatchingFields = !!rawRefKey || rawMethod === 'matched' || rawMethod === 'both';
  if (wantsMatchingFields && !FEATURES.ADMIN.MASTERING_REFERENCE_MATCHING) {
    return NextResponse.json(
      { success: false, error: 'Reference-matched mastering is not enabled.' },
      { status: 501 }
    );
  }
  let matchingMethod: MatchingMethod | undefined;
  if (rawMethod !== undefined) {
    if (rawMethod === 'loudnorm' || rawMethod === 'matched' || rawMethod === 'both') {
      matchingMethod = rawMethod;
    } else {
      return NextResponse.json(
        { success: false, error: `matchingMethod must be 'loudnorm', 'matched' or 'both'` },
        { status: 400 }
      );
    }
  }
  let referenceKey: string | undefined;
  let referenceId: string | undefined;
  if (matchingMethod === 'matched' || matchingMethod === 'both') {
    if (!rawRefKey) {
      return NextResponse.json(
        { success: false, error: 'referenceKey is required when matchingMethod is matched or both' },
        { status: 400 }
      );
    }
    if (!isReferenceKey(rawRefKey)) {
      return NextResponse.json(
        { success: false, error: 'referenceKey must live under audio/references/' },
        { status: 400 }
      );
    }
    referenceKey = rawRefKey;
    referenceId = rawRefId; // may be undefined; matchedMasterKeyFor falls back to 'unknown'
  } else if (rawRefKey) {
    // referenceKey supplied without a matchingMethod that uses it — treat as
    // bad request rather than silently ignoring, since the caller clearly
    // intended matching. Prevents the class of "why isn't matching running?"
    // debugging where the answer is "you forgot matchingMethod".
    return NextResponse.json(
      { success: false, error: 'matchingMethod must be set when referenceKey is supplied' },
      { status: 400 }
    );
  }

  const jobId = randomUUID();

  try {
    await new MasterJobRepository().create(jobId, {
      s3Key, target, edit, join,
      referenceKey: referenceKey ?? null,
      referenceId: referenceId ?? null,
      matchingMethod: matchingMethod ?? null,
    });
    const lambda = new LambdaClient({
      region: awsConfig.region,
      ...(awsConfig.credentials ? { credentials: awsConfig.credentials } : {}),
    });
    await lambda.send(
      new InvokeCommand({
        FunctionName: MASTER_WORKER_FUNCTION,
        InvocationType: 'Event', // async — returns at once
        Payload: Buffer.from(JSON.stringify({
          jobId, s3Key, target, edit, join,
          // Only include reference-matching fields when actually requested —
          // keeps existing loudnorm-only payloads byte-identical to before.
          ...(referenceKey ? { referenceKey, referenceId, matchingMethod } : {}),
        })),
      })
    );
    return NextResponse.json({ success: true, jobId, status: 'queued' }, { status: 202 });
  } catch (err) {
    console.error('[api/music-lab/master] enqueue failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not start the mastering job.' }, { status: 502 });
  }
}
