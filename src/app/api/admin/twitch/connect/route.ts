/**
 * GET /api/admin/twitch/connect — begins the Twitch OAuth flow.
 *
 * Admin-only. Mints a signed, expiring `state` token and RETURNS the Twitch
 * authorize URL as JSON; the client then navigates to it.
 *
 * ⚠️ Why JSON rather than a 302: Amplify keeps Cognito tokens in browser
 * storage rather than cookies, so the admin session travels in an Authorization
 * header that a top-level navigation would not send. Fetching this with
 * `adminFetch` and then setting `window.location` keeps the admin check
 * reliable and still lands the browser on Twitch's consent screen.
 *
 * The client secret never leaves the server, and the state is unforgeable
 * without it (see lib/twitch/oauth-state.ts).
 *
 * ⚠️ Phase 1 requests NO scopes — see lib/twitch/config.ts for the verification
 * behind that. The `scope` parameter is still sent (empty) so the intent is
 * explicit rather than accidental.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import {
  TWITCH_AUTHORIZE_URL,
  TWITCH_PHASE1_SCOPES,
  getTwitchConfig,
  missingTwitchConfigKeys,
  oauthStateSecret,
} from '@/lib/twitch/config';
import { createOAuthState } from '@/lib/twitch/oauth-state';
import { DEFAULT_TENANT_ID } from '@/types/twitch';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('twitch:connect-route');

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (error) {
    return authErrorResponse(error);
  }

  const config = getTwitchConfig();
  if (!config) {
    return NextResponse.json(
      { error: 'Twitch is not configured', missing: missingTwitchConfigKeys() },
      { status: 503 }
    );
  }

  const state = createOAuthState(DEFAULT_TENANT_ID, oauthStateSecret(config));

  const url = new URL(TWITCH_AUTHORIZE_URL);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', TWITCH_PHASE1_SCOPES.join(' '));
  url.searchParams.set('state', state);
  // Always show the consent screen, so reconnecting to a DIFFERENT channel is
  // possible without first logging out of Twitch in the browser.
  url.searchParams.set('force_verify', 'true');

  log.info('starting twitch oauth', { tenantId: DEFAULT_TENANT_ID, result: 'authorize_url' });

  return NextResponse.json({ success: true, url: url.toString() });
}
