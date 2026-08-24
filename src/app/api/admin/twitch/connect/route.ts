/**
 * POST /api/admin/twitch/connect — start the Twitch OAuth Authorization Code
 * flow. Mints a signed CSRF `state`, sets it as an httpOnly cookie, and
 * returns the Twitch authorize URL for the client to redirect the browser to.
 *
 * The state cookie is the ONLY thing tying the callback back to this request,
 * so the client MUST NOT modify or store it — it rides automatically on the
 * return redirect from Twitch. Admin-gated + Bearer-required (mutation route).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { buildAuthorizeUrl } from '@/lib/twitch/oauth';
import {
  TWITCH_STATE_COOKIE,
  mintOAuthState,
  oauthStateCookieOptions,
} from '@/lib/twitch/oauth-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Callback URL used at the Twitch authorize step. Must EXACTLY match one of
 * the redirect URIs registered in the Twitch developer console for our
 * client-id, or Twitch rejects the flow. Config-driven so preview / staging /
 * production each provide their own without a code change.
 */
function resolveRedirectUri(req: NextRequest): string {
  const configured = process.env.TWITCH_OAUTH_REDIRECT_URI;
  if (configured && configured.length > 0) return configured;
  // Dev fallback — derive from the incoming request's origin.
  return `${req.nextUrl.origin}/api/admin/twitch/callback`;
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  try {
    const redirectUri = resolveRedirectUri(request);
    const { token } = mintOAuthState();
    const authorizeUrl = buildAuthorizeUrl(token, redirectUri);

    const res = NextResponse.json({ success: true, url: authorizeUrl });
    // Cookie options are set by the helper; keep the header shape in one place.
    res.cookies.set(TWITCH_STATE_COOKIE, token, oauthStateCookieOptions());
    return res;
  } catch (err) {
    console.error('[api/admin/twitch/connect] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { success: false, error: 'Could not start the Twitch connect flow.' },
      { status: 502 }
    );
  }
}
