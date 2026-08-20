/**
 * GET /api/twitch/callback — the Twitch OAuth redirect target.
 *
 * This is the URL registered in the Twitch developer console.
 *
 * ⚠️ AUTH MODEL — READ BEFORE CHANGING. This route is NOT `requireAdmin`-gated,
 * and that is deliberate rather than an omission:
 *
 *  - Twitch redirects the BROWSER here. Amplify keeps Cognito tokens in browser
 *    storage rather than cookies (see the comment in lib/auth-helper.ts), so a
 *    top-level navigation arriving from another origin cannot be relied upon to
 *    carry an Authorization header. Gating on it would make connecting fail
 *    intermittently *after* the admin had already authorised at Twitch.
 *  - The actual gate is the signed, expiring `state` token. It can only be
 *    minted by GET /api/admin/twitch/connect, which IS admin-gated. An attacker
 *    cannot forge one without the server secret, cannot reuse an old one past
 *    its TTL, and cannot replay one usefully because the authorization code
 *    itself is single-use at Twitch.
 *
 * That is precisely the job OAuth state exists to do; adding a second, weaker
 * check on top would not make it safer.
 *
 * It lives at /api/twitch/* rather than /api/admin/twitch/* so that the auth
 * boundary is visible in the URL — a route under /api/admin that skipped the
 * admin check would be a trap for the next reader.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTwitchConfig, oauthStateSecret } from '@/lib/twitch/config';
import { verifyOAuthState } from '@/lib/twitch/oauth-state';
import { completeConnection } from '@/application/use-cases/ConnectTwitch';
import { TwitchApiError } from '@/services/twitch/twitch-client';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('twitch:callback');

/** Send the admin back to the panel with a status they can read. */
function back(request: NextRequest, status: string) {
  const url = new URL('/admin/twitch', request.nextUrl.origin);
  url.searchParams.set('status', status);
  return NextResponse.redirect(url.toString());
}

export async function GET(request: NextRequest) {
  const config = getTwitchConfig();
  if (!config) return back(request, 'not_configured');

  const params = request.nextUrl.searchParams;

  // The user pressed "Cancel" on Twitch's consent screen.
  const oauthError = params.get('error');
  if (oauthError) {
    log.info('twitch authorization declined', { result: oauthError });
    return back(request, oauthError === 'access_denied' ? 'denied' : 'error');
  }

  // CSRF: verify state before touching the code.
  const state = verifyOAuthState(params.get('state'), oauthStateSecret(config));
  if (!state) {
    log.warn('rejected twitch callback with an invalid or expired state', {
      result: 'invalid_state',
    });
    return back(request, 'invalid_state');
  }

  const code = params.get('code');
  if (!code) return back(request, 'missing_code');

  try {
    await completeConnection(config, state.t, code);
    return back(request, 'connected');
  } catch (error) {
    // Never echo the authorization code or the Twitch body into the log.
    log.error('twitch connection failed', error, { tenantId: state.t, result: 'failed' });
    if (error instanceof TwitchApiError && error.requiresReauth) {
      return back(request, 'rejected');
    }
    return back(request, 'error');
  }
}
