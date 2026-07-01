/**
 * POST /api/admin/compose — enqueue a brief. Admin-gated.
 *
 * The full Sonnet brief takes ~33s, which exceeds Amplify's managed-compute
 * ~30s execution ceiling (a probe confirmed `after()` background work is dropped
 * there too). So this route does NOT generate the brief inline: it creates a
 * `processing` job in DynamoDB, asynchronously invokes the dedicated worker
 * Lambda (which runs the generation off-Amplify and writes the result back), and
 * returns the job id immediately. The client polls GET /api/admin/compose/[jobId].
 *
 * Body: { lyrics: string }  →  202 { jobId, status: 'processing' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { ComposeJobRepository } from '@/infrastructure/database/ComposeJobRepository';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { awsConfig } from '@/lib/aws-config';
import { rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { composeLimiter } from '@/lib/compose-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  lyrics: z.string().min(1, 'Lyrics required').max(8000, 'Lyrics too long'),
});

// Off-Amplify worker that runs composeFromLyrics with Sonnet (see
// worker/compose-worker.ts). Overridable via env; hardcoded fallback is the
// deployed function name.
const WORKER_FUNCTION = process.env.COMPOSE_WORKER_FUNCTION || 'tamilagaval-compose-worker';

export async function POST(request: NextRequest) {
  let auth;
  try {
    auth = await requireAdmin(request);
    requireBearer(request); // mutation (paid LLM job) — reject cookie-only auth (CSRF)
  } catch (err) {
    return authErrorResponse(err);
  }

  // Per-admin rate limit (stable user id first, then email, then IP) — checked
  // before we create a job or invoke the worker, so a throttled caller costs
  // nothing downstream.
  const rl = composeLimiter.check(auth.userId || auth.email || clientIp(request));
  if (!rl.allowed) return rateLimitedResponse(rl);

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || 'Invalid request body' },
      { status: 400 }
    );
  }

  const jobId = `compose_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

  try {
    // 1. Record the job so the client has something to poll immediately.
    await new ComposeJobRepository().create(jobId);

    // 2. Fire-and-forget the worker (InvocationType 'Event' returns at once).
    const lambda = new LambdaClient({
      region: awsConfig.region,
      ...(awsConfig.credentials ? { credentials: awsConfig.credentials } : {}),
    });
    await lambda.send(
      new InvokeCommand({
        FunctionName: WORKER_FUNCTION,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ jobId, lyrics: parsed.data.lyrics })),
      })
    );

    return NextResponse.json({ success: true, jobId, status: 'processing' }, { status: 202 });
  } catch (err) {
    console.error('[api/admin/compose] enqueue failed:', err instanceof Error ? err.message : String(err));
    // Best-effort: drop the orphaned `processing` row if the worker invoke
    // failed after the job was created, so it doesn't dangle until TTL.
    await new ComposeJobRepository().delete(jobId).catch(() => {});
    return NextResponse.json(
      { success: false, error: 'Could not start the compose job. Please try again.' },
      { status: 502 }
    );
  }
}
