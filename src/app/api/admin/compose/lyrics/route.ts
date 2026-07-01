/**
 * POST /api/admin/compose/lyrics — generate original Tamil lyrics from a brief.
 * Admin-gated. The inverse of POST /api/admin/compose (which analyses lyrics).
 *
 * Runs the Sonnet generation INLINE (not via the compose worker): a lyric is a
 * short single call (~5-15s), well under Amplify's ~30s ceiling, so there's no
 * job/poll indirection — the route returns the lyric directly.
 *
 * Body: a LyricBrief (theme, ranked emotions, structure, register, …)
 *   →  200 { success: true, data: Lyrics }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { lyricLimiter } from '@/lib/lyric-rate-limit';
import { lyricBriefSchema } from '@/services/ai/lyricistSchema';
import { generateLyrics, type LyricGenErrorCode } from '@/services/ai/lyricist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Map the service's error taxonomy to HTTP. Messages are already user-safe
// (the service never leaks raw upstream detail), so we pass them through.
const STATUS_BY_CODE: Record<LyricGenErrorCode, number> = {
  invalid_brief: 400,
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
    requireBearer(request); // mutation (paid LLM call) — reject cookie-only auth (CSRF)
  } catch (err) {
    return authErrorResponse(err);
  }

  // Per-admin rate limit before any upstream cost.
  const rl = lyricLimiter.check(auth.userId || auth.email || clientIp(request));
  if (!rl.allowed) return rateLimitedResponse(rl);

  const body = await request.json().catch(() => null);
  const parsed = lyricBriefSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || 'Invalid request body' },
      { status: 400 }
    );
  }

  // Cancel the upstream call if the client disconnects.
  const result = await generateLyrics(parsed.data, { signal: request.signal });

  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: STATUS_BY_CODE[result.code] ?? 502 }
    );
  }

  return NextResponse.json({ success: true, data: result.data }, { status: 200 });
}
