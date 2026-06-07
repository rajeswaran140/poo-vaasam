/**
 * POST /api/admin/deploy — kick off an Amplify RELEASE build so newly-published
 * content goes live. Admin-gated. Returns the Amplify jobId.
 *
 * 503 if AMPLIFY_APP_ID isn't configured; 502 if the StartJob call fails
 * (e.g. the runtime identity lacks amplify:StartJob).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { triggerRelease } from '@/lib/amplify-deploy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const appId = process.env.AMPLIFY_APP_ID;
  const branch = process.env.AMPLIFY_BRANCH || 'master';
  if (!appId) {
    return NextResponse.json(
      { success: false, error: 'AMPLIFY_APP_ID is not configured' },
      { status: 503 }
    );
  }

  const result = await triggerRelease(appId, branch);
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: 502 });
  }
  return NextResponse.json({ success: true, jobId: result.jobId ?? null }, { status: 202 });
}
