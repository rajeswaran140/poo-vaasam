/**
 * POST /api/admin/stems/[masterJobId]/stems — register a stem already
 * uploaded to this master's own stem folder, then Event-invoke the worker
 * to render it a listening-copy preview.
 *
 * The upload itself happens earlier (a separate route, this task doesn't
 * touch it) via a presigned S3 POST; this route only records the key once
 * it lands. `isStemKeyFor` is the one guard standing between an arbitrary
 * S3 key and this master's DynamoDB row, so it is checked before anything
 * else touches the repository.
 *
 * The worker invoke is best-effort: if it throws, the stem is still saved
 * (storing it is the thing that matters) and the response says so via
 * `previewQueued: false` so the page can offer a Retry — a second POST with
 * the same key, which `addStem` must treat as a no-op append (see
 * StemSetRepository.addStem's idempotency check).
 *
 * ⚠️ AN INVOKE FAILURE IS WRITTEN TO THE STEM, NOT JUST RETURNED. Without
 * that write, a stem whose Lambda invoke never fired sits at
 * `previewKey: null, previewError: null` forever — indistinguishable from
 * one genuinely still rendering — and the only place that ever knew it
 * failed was this one HTTP response, gone the moment the page reloads.
 * `setPreviewError` is cleared before every invoke attempt (so a retry that
 * succeeds doesn't leave a stale message behind) and set if that attempt's
 * invoke throws.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';
import { StemSetRepository } from '@/infrastructure/database/StemSetRepository';
import { isValidMasterJobId, isStemKeyFor, stemIdFromKey } from '@/lib/stems';
import type { StemSet } from '@/types/stemSet';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { awsConfig } from '@/lib/aws-config';

const PREVIEW_INVOKE_FAILED_MESSAGE = 'The listening copy could not be started — press Retry.';

/** A shallow copy of `set` with one stem's `previewError` replaced. */
function withPreviewError(set: StemSet, stemId: string, message: string | null): StemSet {
  const stem = set.stems[stemId];
  if (!stem) return set;
  return { ...set, stems: { ...set.stems, [stemId]: { ...stem, previewError: message } } };
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_WORKER_FUNCTION = process.env.MASTER_WORKER_FUNCTION || 'tamilagaval-master-worker';

async function savedMaster(masterJobId: string) {
  const job = await new MasterJobRepository().get(masterJobId);
  return job && job.savedAt ? job : null;
}

const bodySchema = z.object({
  key: z.string().min(1).max(1024),
  filename: z.string().min(1).max(255),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ masterJobId: string }> }
) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const { masterJobId } = await params;
  if (!isValidMasterJobId(masterJobId)) {
    return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'key and filename are required.' }, { status: 400 });
  }
  const { key, filename } = parsed.data;

  if (!isStemKeyFor(masterJobId, key)) {
    return NextResponse.json(
      { success: false, error: 'That file is not in this song’s stem folder.' },
      { status: 400 }
    );
  }

  try {
    const job = await savedMaster(masterJobId);
    if (!job) {
      return NextResponse.json(
        { success: false, error: 'No saved master with that id.' },
        { status: 404 }
      );
    }

    const repo = new StemSetRepository();
    let set = await repo.addStem(masterJobId, key, filename);
    const stemId = stemIdFromKey(key);

    // Clear any old failure before trying again — a retry that this time
    // succeeds must not leave a stale "could not be started" message behind.
    // Best-effort, like the worker's own error-record write (see
    // makeStemPreview): the stem is already saved, so a failure writing
    // THIS field must not turn into a 502 for an add that otherwise worked.
    await repo.setPreviewError(masterJobId, stemId, null).catch((e) =>
      console.error('[api/admin/stems] could not clear the stem preview error:', e instanceof Error ? e.message : String(e))
    );
    set = withPreviewError(set, stemId, null);

    try {
      const lambda = new LambdaClient({
        region: awsConfig.region,
        ...(awsConfig.credentials ? { credentials: awsConfig.credentials } : {}),
      });
      await lambda.send(
        new InvokeCommand({
          FunctionName: MASTER_WORKER_FUNCTION,
          InvocationType: 'Event',
          Payload: Buffer.from(JSON.stringify({ stemPreview: { masterJobId, stemKey: key } })),
        })
      );
    } catch (invokeErr) {
      console.error(
        '[api/admin/stems] worker invoke failed:',
        invokeErr instanceof Error ? invokeErr.message : String(invokeErr)
      );
      await repo.setPreviewError(masterJobId, stemId, PREVIEW_INVOKE_FAILED_MESSAGE).catch((e) =>
        console.error('[api/admin/stems] could not record the stem preview error:', e instanceof Error ? e.message : String(e))
      );
      set = withPreviewError(set, stemId, PREVIEW_INVOKE_FAILED_MESSAGE);
      return NextResponse.json({ success: true, set, previewQueued: false }, { status: 201 });
    }

    return NextResponse.json({ success: true, set }, { status: 201 });
  } catch (err) {
    console.error('[api/admin/stems] add failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not add the stem.' }, { status: 502 });
  }
}
