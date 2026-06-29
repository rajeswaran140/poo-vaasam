/**
 * POST /api/admin/compose/critique — enqueue a lyric critique. Admin-gated.
 *
 * A full-ballad critique is ~50-70s on Sonnet, well over Amplify's managed-compute
 * ~30s ceiling (the inline version 504'd). So this route does NOT critique inline:
 * it creates a `processing` job in DynamoDB, asynchronously invokes the shared
 * worker Lambda (kind:'critique' → runs critiqueLyric off-Amplify and writes the
 * result back), and returns the job id immediately. The client polls
 * GET /api/admin/compose/critique/[jobId].
 *
 * Body: a LyricCritiqueInput (lyrics, optional focus[], optional notes)
 *   →  202 { success: true, jobId, status: 'processing' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { lyricCriticLimiter } from '@/lib/lyric-critic-rate-limit';
import { lyricCritiqueInputSchema } from '@/services/ai/lyricCriticSchema';
import { CriticJobRepository } from '@/infrastructure/database/CriticJobRepository';
import { LexiconRepository } from '@/infrastructure/database/LexiconRepository';
import { lexiconHints } from '@/lib/lexicon-hints';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { awsConfig } from '@/lib/aws-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Shared AI-job worker (see worker/compose-worker.ts) — handles both compose and
// critique. Overridable via env; hardcoded fallback is the deployed function name.
const WORKER_FUNCTION = process.env.COMPOSE_WORKER_FUNCTION || 'tamilagaval-compose-worker';

export async function POST(request: NextRequest) {
  let auth;
  try {
    auth = await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  // Per-admin rate limit before any cost.
  const rl = lyricCriticLimiter.check(auth.userId || auth.email || clientIp(request));
  if (!rl.allowed) return rateLimitedResponse(rl);

  const body = await request.json().catch(() => null);
  const parsed = lyricCritiqueInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || 'Invalid request body' },
      { status: 400 }
    );
  }

  const jobId = `critic_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

  // Pull the poet's lexicon so the critique prefers their own vocabulary for
  // wordIdeas. Best-effort: a lexicon read must NEVER block a critique.
  let lexicon: string[] = [];
  try {
    lexicon = lexiconHints(await new LexiconRepository().findAll());
  } catch (err) {
    console.warn('[api/admin/compose/critique] lexicon fetch skipped:', err instanceof Error ? err.message : String(err));
  }

  try {
    // 1. Record the job so the client has something to poll immediately.
    await new CriticJobRepository().create(jobId);

    // 2. Fire-and-forget the worker (InvocationType 'Event' returns at once).
    const lambda = new LambdaClient({
      region: awsConfig.region,
      ...(awsConfig.credentials ? { credentials: awsConfig.credentials } : {}),
    });
    await lambda.send(
      new InvokeCommand({
        FunctionName: WORKER_FUNCTION,
        InvocationType: 'Event',
        Payload: Buffer.from(
          JSON.stringify({
            kind: 'critique',
            jobId,
            lyrics: parsed.data.lyrics,
            focus: parsed.data.focus,
            ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
            ...(lexicon.length ? { lexicon } : {}),
          })
        ),
      })
    );

    return NextResponse.json({ success: true, jobId, status: 'processing' }, { status: 202 });
  } catch (err) {
    console.error('[api/admin/compose/critique] enqueue failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { success: false, error: 'Could not start the critique job. Please try again.' },
      { status: 502 }
    );
  }
}
