/**
 * GET /api/admin/twitch/callback?code=X&state=Y — the OAuth redirect target.
 *
 * Twitch redirects the user's browser here after authorization. This route is
 * PUBLIC (no `requireAdmin` — the browser has just come back from Twitch, not
 * from the admin UI, so no Bearer token is available on the request). Auth is
 * enforced instead by the signed state cookie that the /connect route set:
 * a cross-site attacker can neither read the cookie (httpOnly) nor forge it
 * (HMAC-SHA256 with a server-side secret).
 *
 * Flow:
 *   1. Verify `state` query param matches the state cookie (HMAC-signed).
 *   2. Refuse on any mismatch / stale / tampered state.
 *   3. Exchange the code for tokens.
 *   4. Fetch the authenticated Twitch user.
 *   5. Persist tokens in SSM, upsert the DDB connection record.
 *   6. Clear the state cookie.
 *   7. Redirect the browser to /admin/twitch?connected=1 so the admin UI can
 *      refresh and show the connected state.
 *
 * On error: redirect to /admin/twitch?error=<code> — we don't want an ugly
 * JSON response in the user's browser mid-flow. The admin page renders a
 * human-friendly error message for known error codes.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  TWITCH_STATE_COOKIE,
  oauthStateClearCookieOptions,
  verifyOAuthState,
} from '@/lib/twitch/oauth-state';
import {
  exchangeCodeForTokens,
  fetchAuthenticatedUser,
} from '@/lib/twitch/oauth';
import { storeTokens, accessTokenParamName, refreshTokenParamName } from '@/lib/twitch/tokens';
import { TwitchConnectionRepository } from '@/infrastructure/database/TwitchConnectionRepository';
import { currentTenantId } from '@/lib/twitch/tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resolveRedirectUri(req: NextRequest): string {
  const configured = process.env.TWITCH_OAUTH_REDIRECT_URI;
  if (configured && configured.length > 0) return configured;
  return `${req.nextUrl.origin}/api/admin/twitch/callback`;
}

/** Redirect to /admin/twitch with a query-string outcome for the UI to display. */
function returnToAdmin(request: NextRequest, params: Record<string, string>): NextResponse {
  const url = new URL('/admin/twitch', request.nextUrl.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url);
  // Always clear the state cookie on exit — success or failure, it's single-use.
  res.cookies.set(TWITCH_STATE_COOKIE, '', oauthStateClearCookieOptions());
  return res;
}

export async function GET(request: NextRequest) {
  // Twitch surfaces user-denied consent as ?error=access_denied. Handle it
  // gracefully — no need to attempt a token exchange.
  const twitchError = request.nextUrl.searchParams.get('error');
  if (twitchError) {
    return returnToAdmin(request, { error: twitchError });
  }

  const code = request.nextUrl.searchParams.get('code');
  const stateParam = request.nextUrl.searchParams.get('state');
  const stateCookie = request.cookies.get(TWITCH_STATE_COOKIE)?.value;

  if (!code || !stateParam || !stateCookie) {
    return returnToAdmin(request, { error: 'missing_state_or_code' });
  }
  if (stateParam !== stateCookie) {
    // The query param must be the SAME signed token that was set in the cookie.
    // Cheap byte-compare BEFORE the HMAC verify — a mismatch here is a clear
    // CSRF attempt, no need to compute a hash for it.
    return returnToAdmin(request, { error: 'state_mismatch' });
  }
  const statePayload = verifyOAuthState(stateCookie);
  if (!statePayload) {
    return returnToAdmin(request, { error: 'state_invalid' });
  }

  try {
    const redirectUri = resolveRedirectUri(request);
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    const user = await fetchAuthenticatedUser(tokens.access_token);

    const tenantId = currentTenantId();
    await storeTokens(tenantId, tokens);

    const repo = new TwitchConnectionRepository();
    const existing = await repo.get(tenantId);
    const now = new Date().toISOString();
    const accessTokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    await repo.put({
      tenantId,
      twitchUserId: user.id,
      twitchLogin: user.login,
      displayName: user.display_name,
      broadcasterId: user.id,
      profileImageUrl: user.profile_image_url || null,
      connectionStatus: 'connected',
      scopes: tokens.scope,
      accessTokenSsmParam: accessTokenParamName(tenantId),
      refreshTokenSsmParam: refreshTokenParamName(tenantId),
      accessTokenExpiresAt,
      // Preserve the ORIGINAL first-connect timestamp across reconnects.
      connectedAt: existing?.connectedAt || now,
      updatedAt: now,
      disconnectedAt: null,
    });

    return returnToAdmin(request, { connected: '1' });
  } catch (err) {
    // Deliberately generic error string — token exchange failures may echo
    // the code we posted, which we never want in a URL.
    console.error('[api/admin/twitch/callback] failed:', err instanceof Error ? err.message : String(err));
    return returnToAdmin(request, { error: 'exchange_failed' });
  }
}
