/**
 * The seam preview — hear a two-part crossfade without mastering the song.
 *
 * POST enqueues a render of ~20 seconds around the join. GET reports whether
 * that render has landed and, if so, presigns it.
 *
 * NO JOB ID, ANYWHERE. A preview belongs to a set of SETTINGS, not to a job:
 * the operator is still deciding the crossfade, and at that point there is
 * usually no MasterJob at all — both parts are uploaded to the workspace but
 * nothing has been mastered. The key is a fingerprint of the exact settings, so
 * the same seam is never rendered twice and a nudged trim never overwrites the
 * preview still playing.
 *
 * The GET is a HeadObject, which is also how the two loudness readings come
 * back: the worker puts them on the object's own metadata, so the poll that
 * asks "is it ready" gets "and here is why the seam sounds like that" for free.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { S3Client, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { awsConfig } from '@/lib/aws-config';
import { parseMasterEdit } from '@/lib/master-edit';
import { parseMasterJoin } from '@/lib/master-join';
import {
  planSeamPreview,
  seamRefusalMessage,
  isSeamPreviewKey,
  summariseSeamLevels,
  describeSeamLevels,
} from '@/lib/seam-preview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_WORKER_FUNCTION = process.env.MASTER_WORKER_FUNCTION || 'tamilagaval-master-worker';
const TAKES_BUCKET = process.env.TAKES_BUCKET || 'tamil-web-media';
const PRESIGN_SECONDS = 15 * 60;

const bodySchema = z.object({
  partAKey: z.string().min(1),
  editA: z.unknown().optional(),
  join: z.unknown(),
});

function s3() {
  return new S3Client({
    region: process.env.TAKES_BUCKET_REGION || 'us-east-1',
    ...(awsConfig.credentials ? { credentials: awsConfig.credentials } : {}),
  });
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Part A and a crossfade are required.' }, { status: 400 });
  }

  // Both shapes are parsed by the SAME functions the mastering route uses, so a
  // crossfade that previews is a crossfade that will master.
  const edit = parseMasterEdit(parsed.data.editA ?? null);
  if (!edit.ok) return NextResponse.json({ success: false, error: edit.error }, { status: 400 });
  const join = parseMasterJoin(parsed.data.join ?? null);
  if (!join.ok) return NextResponse.json({ success: false, error: join.error }, { status: 400 });
  if (!join.join) {
    return NextResponse.json({ success: false, error: seamRefusalMessage('no-join') }, { status: 409 });
  }

  const plan = planSeamPreview({
    partAKey: parsed.data.partAKey,
    partBKey: join.join.partBKey,
    editA: edit.edit,
    join: join.join,
  });
  if (!plan.ok) {
    return NextResponse.json({ success: false, error: seamRefusalMessage(plan.reason) }, { status: 409 });
  }

  try {
    // Already rendered? The fingerprint means identical settings produce the
    // identical key, so re-asking costs one HeadObject instead of a Lambda.
    const existing = await head(plan.previewKey);
    if (existing) {
      return NextResponse.json({ success: true, previewKey: plan.previewKey, status: 'ready', ...existing });
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
            // No jobId, deliberately — a preview belongs to no job, and the
            // worker's seam branch runs before every mastering guard.
            seam: {
              partAKey: plan.spec.partAKey,
              partBKey: plan.spec.partBKey,
              editA: plan.spec.editA,
              join: plan.spec.join,
            },
          })
        ),
      })
    );
    return NextResponse.json({ success: true, previewKey: plan.previewKey, status: 'queued' }, { status: 202 });
  } catch (err) {
    console.error('[api/mastering/seam-preview] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not start the seam preview.' }, { status: 502 });
  }
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const key = request.nextUrl.searchParams.get('key') ?? '';
  // Only keys this module produced. An admin session must not be able to turn
  // this into a presigner for arbitrary bucket objects.
  if (!isSeamPreviewKey(key)) {
    return NextResponse.json({ success: false, error: 'Not a seam preview key' }, { status: 400 });
  }

  try {
    const found = await head(key);
    if (!found) return NextResponse.json({ success: true, status: 'pending' });

    const url = await getSignedUrl(
      s3(),
      new GetObjectCommand({ Bucket: TAKES_BUCKET, Key: key }),
      { expiresIn: PRESIGN_SECONDS }
    );
    return NextResponse.json({ success: true, status: 'ready', url, ...found });
  } catch (err) {
    console.error('[api/mastering/seam-preview] read failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not read the seam preview.' }, { status: 502 });
  }
}

/**
 * Does the preview exist, and what did the worker measure?
 *
 * A miss is `null`, not a throw: "not rendered yet" is the ordinary state while
 * polling, and raising on it would make every poll look like a failure.
 */
async function head(key: string): Promise<{ levels: ReturnType<typeof summariseSeamLevels>; levelsNote: string } | null> {
  try {
    const r = await s3().send(new HeadObjectCommand({ Bucket: TAKES_BUCKET, Key: key }));
    const num = (v: string | undefined) => {
      if (!v) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const levels = summariseSeamLevels(
      num(r.Metadata?.['seam-tail-lufs']),
      num(r.Metadata?.['seam-head-lufs'])
    );
    return { levels, levelsNote: describeSeamLevels(levels) };
  } catch {
    return null;
  }
}
