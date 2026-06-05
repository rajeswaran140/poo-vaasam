/**
 * POST /api/admin/compose
 *
 * Run AI Composer on Tamil lyrics. Admin-gated.
 *
 * The full Sonnet brief takes ~33s, which exceeds Amplify's managed-CloudFront
 * ~30s origin timeout. So we DON'T return a plain JSON response — we return a
 * text stream that emits a heartbeat space every few seconds while the model
 * generates (keeping the connection from idling out), then writes the final
 * `{ success, data | error }` JSON as the last chunk. The client accumulates
 * the stream and JSON.parses the trimmed payload.
 *
 * Auth (401) and body-validation (400) still return immediately as plain JSON.
 *
 * Body: { lyrics: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { composeFromLyrics } from '@/services/ai/composer';

// The Anthropic SDK + AWS SDK need the Node runtime, not edge.
export const runtime = 'nodejs';
// Sonnet generation runs ~33s; declare headroom so the platform doesn't kill
// the function before the heartbeat-padded stream finishes. (Amplify may or may
// not honour this — see HARDENING.md — but it's the correct declaration and is
// honoured by other Next hosts.)
export const maxDuration = 60;

const schema = z.object({
  lyrics: z.string().min(1, 'Lyrics required').max(8000, 'Lyrics too long'),
});

const HEARTBEAT_MS = 4000;

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Invalid request body' },
      { status: 400 }
    );
  }

  const { lyrics } = parsed.data;
  const encoder = new TextEncoder();

  // If the client disconnects (navigates away / supersedes the request), the
  // stream is cancelled and we abort the in-flight Anthropic call — otherwise it
  // (and this Lambda + the heartbeat) would run to completion, burning tokens
  // and compute for a response nobody will read.
  const abort = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // First byte immediately so the streaming response is established, then a
      // space every HEARTBEAT_MS to keep CloudFront from timing out the origin.
      controller.enqueue(encoder.encode(' '));
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(' '));
        } catch {
          /* controller already closed */
        }
      }, HEARTBEAT_MS);

      let payload:
        | { success: true; data: unknown }
        | { success: false; error: string; code: string };
      try {
        const result = await composeFromLyrics(lyrics, { signal: abort.signal });
        payload = result.ok
          ? { success: true, data: result.data }
          // Carry the structured code so the client can tell a retryable failure
          // (rate_limit / upstream) from a pointless-to-retry one (auth / not_configured).
          : { success: false, error: result.error, code: result.code };
      } catch {
        payload = { success: false, error: 'The AI service failed to respond. Please try again.', code: 'upstream' };
      } finally {
        clearInterval(heartbeat);
      }

      // Newline separates the heartbeat padding from the JSON; the client trims.
      try {
        controller.enqueue(encoder.encode('\n' + JSON.stringify(payload)));
        controller.close();
      } catch {
        /* stream already cancelled by the client — nothing to deliver */
      }
    },
    cancel() {
      // Client went away mid-generation: stop the upstream work.
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      // Discourage proxy buffering so the heartbeat actually flushes.
      'X-Accel-Buffering': 'no',
    },
  });
}
