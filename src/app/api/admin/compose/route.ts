/**
 * POST /api/admin/compose
 *
 * Run AI Composer on Tamil lyrics. Admin-gated. Returns the structured
 * production-brief JSON (or an error).
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

  const result = await composeFromLyrics(parsed.data.lyrics);
  if (!result.ok) {
    // Map the classified error code to an HTTP status. The message is already
    // user-safe (composer never returns raw upstream JSON), so we pass it through.
    const status = {
      not_configured: 503, // server misconfigured (key missing)
      auth: 503,           // key present but rejected — also a config problem
      rate_limit: 429,
      bad_response: 502,
      upstream: 502,
    }[result.code];
    return NextResponse.json({ success: false, error: result.error }, { status });
  }

  return NextResponse.json({ success: true, data: result.data });
}
