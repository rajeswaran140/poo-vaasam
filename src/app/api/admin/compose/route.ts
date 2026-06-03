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

      let payload: { success: true; data: unknown } | { success: false; error: string };
      try {
        const result = await composeFromLyrics(lyrics);
        payload = result.ok
          ? { success: true, data: result.data }
          : { success: false, error: result.error };
      } catch {
        payload = { success: false, error: 'The AI service failed to respond. Please try again.' };
      } finally {
        clearInterval(heartbeat);
      }

      // Newline separates the heartbeat padding from the JSON; the client trims.
      controller.enqueue(encoder.encode('\n' + JSON.stringify(payload)));
      controller.close();
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
