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
    // Distinguish "not configured" (503) from generic upstream failure (502).
    const status = /not configured|API key/i.test(result.error) ? 503 : 502;
    return NextResponse.json({ success: false, error: result.error }, { status });
  }

  return NextResponse.json({ success: true, data: result.data });
}
