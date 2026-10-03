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
import type { StemSet } from '@/types/stemSet';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { awsConfig } from '@/lib/aws-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_WORKER_FUNCTION = process.env.MASTER_WORKER_FUNCTION || 'tamilagaval-master-worker';

async function savedMaster(masterJobId: string) {
  const job = await new MasterJobRepository().get(masterJobId);
  return job && job.savedAt ? job : null;
}

/** A stem set with nothing in it — planRemix on this always refuses, in its own words. */
function emptySet(masterJobId: string): StemSet {
  return { masterJobId, order: [], stems: {}, mix: {}, remix: null, createdAt: '', updatedAt: '' };
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
    const plan = planRemix(set ?? emptySet(masterJobId));
    if (!plan.ok) {
      return NextResponse.json({ success: false, error: plan.message }, { status: 409 });
    }

    await repo.markRemixRequested(masterJobId);

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

    return NextResponse.json({ success: true, status: 'queued' }, { status: 202 });
  } catch (err) {
    console.error('[api/admin/stems] remix failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not start the remix.' }, { status: 502 });
  }
}
