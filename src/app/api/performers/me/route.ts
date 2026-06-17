/**
 * GET /api/performers/me
 *
 * Returns the signed-in performer's identity. Gated by `requirePerformer`
 * (any verified Cognito account), so it's the server-side source of truth for
 * the /performers portal: the client calls it via `performerFetch` to confirm
 * the session is genuinely valid (not just a stale Amplify cookie) and to greet
 * the user. Phase 2's gated lyrics/backing-track endpoints reuse the same gate.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requirePerformer, authErrorResponse } from '@/lib/auth-helper';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  let auth;
  try {
    auth = await requirePerformer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  return NextResponse.json({
    success: true,
    userId: auth.userId,
    email: auth.email,
  });
}
