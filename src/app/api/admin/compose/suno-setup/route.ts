/**
 * POST /api/admin/compose/suno-setup — enqueue an arrangement job.
 *
 * ⚠️ THIS ROUTE USED TO RUN THE MODEL INLINE AND 504'd ON EVERY REAL SONG.
 * Amplify's SSR compute caps at ~30s; arranging a full song is the same class of
 * Sonnet call as a compose brief, which measured 41s on the worker. Do not move
 * it back inline — the ceiling is the platform's, not the model's.
 *
 * So: create a `processing` job, async-invoke the shared worker
 * (kind:'suno-setup'), return 202 + jobId. The panel polls
 * GET /api/admin/compose/suno-setup/[jobId].
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { lyricLimiter } from '@/lib/lyric-rate-limit';
import { sunoSetupInputSchema } from '@/services/ai/sunoSetupSchema';
import { SunoSetupJobRepository } from '@/infrastructure/database/SunoSetupJobRepository';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { awsConfig } from '@/lib/aws-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WORKER_FUNCTION = process.env.COMPOSE_WORKER_FUNCTION || 'tamilagaval-compose-worker';

export async function POST(request: NextRequest) {
  let auth;
  try {
    auth = await requireAdmin(request);
    requireBearer(request); // mutation (paid LLM job) — reject cookie-only auth (CSRF)
  } catch (err) {
    return authErrorResponse(err);
  }

  // Shares the lyric limiter: both are one Sonnet call per request from the same
  // person during the same act of writing, so one budget is the honest model.
  const rl = lyricLimiter.check(auth.userId || auth.email || clientIp(request));
  if (!rl.allowed) return rateLimitedResponse(rl);

  const body = await request.json().catch(() => null);
  const parsed = sunoSetupInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || 'Invalid request body' },
      { status: 400 }
    );
  }

  const jobId = `suno_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

  try {
    await new SunoSetupJobRepository().create(jobId);

    const lambda = new LambdaClient({
      region: awsConfig.region,
      ...(awsConfig.credentials ? { credentials: awsConfig.credentials } : {}),
    });
    await lambda.send(
      new InvokeCommand({
        FunctionName: WORKER_FUNCTION,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ kind: 'suno-setup', jobId, ...parsed.data })),
      })
    );

    return NextResponse.json({ success: true, jobId, status: 'processing' }, { status: 202 });
  } catch (err) {
    console.error('[api/admin/compose/suno-setup] enqueue failed:', err instanceof Error ? err.message : String(err));
    // Drop the orphaned `processing` row — otherwise the panel polls a job
    // nothing will finish and the user waits out the whole timeout for an error
    // that was already known here.
    await new SunoSetupJobRepository().delete(jobId).catch(() => {});
    return NextResponse.json(
      { success: false, error: 'Could not start the SUNO setup job. Please try again.' },
      { status: 502 }
    );
  }
}
