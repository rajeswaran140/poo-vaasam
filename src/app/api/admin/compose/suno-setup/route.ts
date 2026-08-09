/**
 * POST /api/admin/compose/suno-setup — a finished lyric becomes a pasteable
 * generation setup (lyrics block, style box, two sliders, exclude list).
 *
 * Admin-gated. Runs inline rather than through the compose worker: one Sonnet
 * call at low temperature, comfortably inside the platform's request ceiling,
 * so a job/poll round trip would add latency and failure modes for nothing.
 *
 * Always 200 on a successful generation EVEN WHEN the deterministic checks
 * fail. `ready:false` plus `findings` is the useful answer — the writer can fix
 * a contradiction by hand faster than a regeneration, and hiding the output
 * behind an error would throw away work that is mostly correct.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { lyricLimiter } from '@/lib/lyric-rate-limit';
import { generateSunoSetup, type SunoSetupErrorCode } from '@/services/ai/sunoSetup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS_BY_CODE: Record<SunoSetupErrorCode, number> = {
  invalid_input: 400,
  not_configured: 503,
  auth: 500, // a server-side key problem — not the caller's fault
  rate_limit: 429,
  upstream: 502,
  bad_response: 502,
};

export async function POST(request: NextRequest) {
  let auth;
  try {
    auth = await requireAdmin(request);
    requireBearer(request); // paid mutation — reject cookie-only auth (CSRF)
  } catch (err) {
    return authErrorResponse(err);
  }

  // Shares the lyric limiter: both are one Sonnet call per request from the
  // same person during the same act of writing, so one budget is the honest
  // model. A separate limiter would let a loop through both double the spend.
  const rl = lyricLimiter.check(auth.userId || auth.email || clientIp(request));
  if (!rl.allowed) return rateLimitedResponse(rl);

  const body = await request.json().catch(() => null);
  const result = await generateSunoSetup(body);

  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: STATUS_BY_CODE[result.code] ?? 500 }
    );
  }

  return NextResponse.json({
    success: true,
    setup: result.data,
    findings: result.findings,
    ready: result.ready,
  });
}
