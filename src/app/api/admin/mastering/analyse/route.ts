/**
 * POST /api/admin/mastering/analyse — measure a source before anything is
 * decided about it. Body: { s3Key, partBKey? }.
 *
 * Runs where the audio is: Event-invokes the master-worker (ffmpeg layer,
 * bucket access) and returns an id the Studio polls. Read-only — it decodes the
 * source and writes nothing but numbers.
 *
 * The keys get the same workspace guard as every other path into the worker:
 * this route hands it TWO keys to fetch, and the role can read the whole bucket.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { MasterAnalysisRepository } from '@/infrastructure/database/MasterAnalysisRepository';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { awsConfig } from '@/lib/aws-config';
import { isMasteringKey } from '@/lib/mastering-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_WORKER_FUNCTION = process.env.MASTER_WORKER_FUNCTION || 'tamilagaval-master-worker';

const bodySchema = z.object({
  s3Key: z.string().min(1),
  partBKey: z.string().min(1).nullable().optional(),
});

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'A source key is required.' }, { status: 400 });
  }
  const { s3Key } = parsed.data;
  const partBKey = parsed.data.partBKey ?? null;

  if (!isMasteringKey(s3Key) || (partBKey && !isMasteringKey(partBKey))) {
    return NextResponse.json(
      { success: false, error: 'Analysis sources must be in the mastering workspace.' },
      { status: 400 }
    );
  }

  const id = randomUUID();
  try {
    await new MasterAnalysisRepository().create(id, { s3Key, partBKey });
    const lambda = new LambdaClient({
      region: awsConfig.region,
      ...(awsConfig.credentials ? { credentials: awsConfig.credentials } : {}),
    });
    await lambda.send(
      new InvokeCommand({
        FunctionName: MASTER_WORKER_FUNCTION,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ analyse: { analysisId: id, s3Key, partBKey } })),
      })
    );
    return NextResponse.json({ success: true, analysisId: id, status: 'queued' }, { status: 202 });
  } catch (err) {
    console.error('[api/mastering/analyse] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not start the analysis.' }, { status: 502 });
  }
}
