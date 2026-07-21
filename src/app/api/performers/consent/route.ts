/**
 * POST /api/performers/consent — record the signed-in performer's acceptance of
 * the current performance terms as a durable, auditable server record.
 *
 * Gated by `requirePerformer`: the identity comes from the verified Cognito token
 * (never the request body), so a caller can only record consent for themselves.
 * Idempotent — the client posts it on first authenticated load; re-posts don't
 * rewrite the original acceptance (see recordPerformerConsent).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requirePerformer, authErrorResponse } from '@/lib/auth-helper';
import { recordPerformerConsent } from '@/lib/performer-consent';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let auth;
  try {
    auth = await requirePerformer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  if (!auth.userId) {
    return NextResponse.json({ success: false, error: 'Token carries no user id' }, { status: 400 });
  }

  try {
    const { recorded, consent } = await recordPerformerConsent({ userId: auth.userId, email: auth.email });
    return NextResponse.json(
      { success: true, recorded, termsVersion: consent.termsVersion, acceptedAt: consent.acceptedAt },
      { status: 200 }
    );
  } catch (err) {
    console.error('[POST /api/performers/consent] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to record consent' }, { status: 500 });
  }
}
