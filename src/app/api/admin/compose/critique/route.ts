/**
 * POST /api/admin/compose/critique — give structured FEEDBACK on the poet's own
 * draft lyric (draft → critique). Admin-gated. The augment-the-craft counterpart
 * to POST /api/admin/compose/lyrics (which generates): this one never writes or
 * rewrites — it helps the poet see their own work more clearly.
 *
 * Runs the Sonnet call INLINE (not via a worker): a single short call, returned
 * directly. (Shares the Lyricist's inline-timeout caveat vs Amplify's ~30s
 * ceiling — tracked as a follow-up.)
 *
 * Body: a LyricCritiqueInput (lyrics, optional focus[], optional notes)
 *   →  200 { success: true, data: LyricCritique }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { lyricCriticLimiter } from '@/lib/lyric-critic-rate-limit';
import { lyricCritiqueInputSchema } from '@/services/ai/lyricCriticSchema';
import { critiqueLyric, type LyricCritiqueErrorCode } from '@/services/ai/lyricCritic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Map the service's error taxonomy to HTTP. Messages are already user-safe
// (the service never leaks raw upstream detail), so we pass them through.
const STATUS_BY_CODE: Record<LyricCritiqueErrorCode, number> = {
  invalid_input: 400,
  not_configured: 503,
  auth: 500, // a server-side key problem — not the caller's fault, don't 401
  rate_limit: 429,
  upstream: 502,
  bad_response: 502,
};

export async function POST(request: NextRequest) {
  let auth;
  try {
    auth = await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  // Per-admin rate limit before any upstream cost.
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

  // Cancel the upstream call if the client disconnects.
  const result = await critiqueLyric(parsed.data, { signal: request.signal });

  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: STATUS_BY_CODE[result.code] ?? 502 }
    );
  }

  return NextResponse.json({ success: true, data: result.data }, { status: 200 });
}
