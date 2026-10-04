/**
 * POST /api/admin/stems/[masterJobId]/remix — queue a render of the saved
 * mix.
 *
 * The request body carries no levels — the render always uses the STORED
 * mix (`StemSetRepository.saveMix`'s last write), never anything the client
 * sends here. That keeps "what you hear in the mixer" and "what the worker
 * renders" the same source of truth, and means a stale or forged body can't
 * change what gets rendered.
 *
 * `planRemix` runs against the stored set before anything is queued: a mix
 * with nothing audible in it (every stem muted, or at the fader floor) is
 * refused with its own message rather than invoking a worker that would
 * have nothing to render. The worker renders from the stems' full-quality
 * WAVs, not their listening-copy previews, so an in-flight preview is not a
 * gate here.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';
import { StemSetRepository } from '@/infrastructure/database/StemSetRepository';
import { isValidMasterJobId, planRemix } from '@/lib/stems';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { awsConfig } from '@/lib/aws-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_WORKER_FUNCTION = process.env.MASTER_WORKER_FUNCTION || 'tamilagaval-master-worker';
const NO_STEMS_MESSAGE = 'No stems yet — add the song’s stems before rendering a remix.';
const INVOKE_FAILED_MESSAGE = 'The remix could not be started — press Render remix again.';

async function savedMaster(masterJobId: string) {
  const job = await new MasterJobRepository().get(masterJobId);
  return job && job.savedAt ? job : null;
}

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

  try {
    const job = await savedMaster(masterJobId);
    if (!job) {
      return NextResponse.json(
        { success: false, error: 'No saved master with that id.' },
        { status: 404 }
      );
    }

    const repo = new StemSetRepository();
    const set = await repo.get(masterJobId);
    if (!set) {
      return NextResponse.json({ success: false, error: NO_STEMS_MESSAGE }, { status: 409 });
    }
    const plan = planRemix(set);
    if (!plan.ok) {
      return NextResponse.json({ success: false, error: plan.message }, { status: 409 });
    }

    await repo.markRemixRequested(masterJobId);

    try {
      const lambda = new LambdaClient({
        region: awsConfig.region,
        ...(awsConfig.credentials ? { credentials: awsConfig.credentials } : {}),
      });
      await lambda.send(
        new InvokeCommand({
          FunctionName: MASTER_WORKER_FUNCTION,
          InvocationType: 'Event',
          Payload: Buffer.from(JSON.stringify({ stemMix: { masterJobId } })),
        })
      );
    } catch (invokeErr) {
      console.error(
        '[api/admin/stems] remix worker invoke failed:',
        invokeErr instanceof Error ? invokeErr.message : String(invokeErr)
      );
      // Best-effort, like the stem-preview route's setPreviewError: the
      // response below is the authoritative 502, but a reload must see the
      // same failure, not a remix stuck forever on "requested".
      await repo.setRemixError(masterJobId, INVOKE_FAILED_MESSAGE).catch((e) =>
        console.error('[api/admin/stems] could not record the remix error:', e instanceof Error ? e.message : String(e))
      );
      return NextResponse.json({ success: false, error: INVOKE_FAILED_MESSAGE }, { status: 502 });
    }

    return NextResponse.json({ success: true, status: 'queued' }, { status: 202 });
  } catch (err) {
    console.error('[api/admin/stems] remix failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not start the remix.' }, { status: 502 });
  }
}
