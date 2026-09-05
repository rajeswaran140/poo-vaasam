/**
 * Twitch OAuth 2.0 — Authorization Code flow helpers.
 *
 * Endpoints and semantics per Twitch's current API docs:
 *   - Authorize:  https://id.twitch.tv/oauth2/authorize
 *   - Token:      https://id.twitch.tv/oauth2/token
 *   - Revoke:     https://id.twitch.tv/oauth2/revoke
 *   - Users:      https://api.twitch.tv/helix/users  (Client-Id header required)
 *
 * Scope choice for Phase 1: **empty**. `stream.online` and `stream.offline`
 * EventSub subscriptions do NOT require any user-context scope; we just need
 * enough OAuth to identify the connecting user (their user id + login), which
 * GET /helix/users returns for the authenticated user regardless of scopes.
 * When we add richer events later (channel.subscribe, channel.cheer, etc.),
 * add the scope required by that specific event type — one per event, and
 * document why in the caller.
 *
 * This module does NOT store tokens — it just returns them. Token persistence
 * lives in src/lib/twitch/tokens.ts (SSM SecureString).
 */

/** Twitch identity + Helix endpoints. */
const AUTH_URL = 'https://id.twitch.tv/oauth2/authorize';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const REVOKE_URL = 'https://id.twitch.tv/oauth2/revoke';
const HELIX_USERS_URL = 'https://api.twitch.tv/helix/users';

/**
 * Phase 1 OAuth scopes. Empty by design — see the docstring at the top of
 * this file for why. When adding a scope, put it here with a WHY comment.
 */
export const PHASE_1_SCOPES: readonly string[] = [];

export interface TwitchTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds until access token expires
  scope: string[];
  token_type: 'bearer';
}

export interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Twitch OAuth: required env var ${name} is not set`);
  }
  return v;
}

/**
 * Build the Twitch authorize URL for the connect flow. `state` MUST be the
 * signed value from mintOAuthState() — same value goes into the cookie the
 * callback verifies.
 */
export function buildAuthorizeUrl(state: string, redirectUri: string, scopes: readonly string[] = PHASE_1_SCOPES): string {
  const params = new URLSearchParams({
    client_id: requireEnv('TWITCH_CLIENT_ID'),
    redirect_uri: redirectUri,
    response_type: 'code',
    // `force_verify=true` makes Twitch always show the consent screen even for
    // a returning user — matters when we want the user to see + confirm the
    // scopes list on a re-connect.
    force_verify: 'true',
    scope: scopes.join(' '),
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange an authorization code for tokens. Called from the OAuth callback
 * route AFTER the state cookie has been HMAC-verified.
 *
 * Throws with a redacted message on any Twitch error — the raw Twitch
 * response may include the code we posted, which we don't want in logs.
 */
export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<TwitchTokenResponse> {
  const body = new URLSearchParams({
    client_id: requireEnv('TWITCH_CLIENT_ID'),
    client_secret: requireEnv('TWITCH_CLIENT_SECRET'),
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    // Deliberately do NOT include the response body — it can echo the code.
    throw new Error(`Twitch token exchange failed (HTTP ${res.status})`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  return normalizeTokenResponse(json);
}

/**
 * Refresh an access token using its refresh token. Twitch's refresh tokens
 * are single-use in some flows and rotating in others — always overwrite
 * BOTH tokens with whatever the response returned.
 */
export async function refreshAccessToken(refreshToken: string): Promise<TwitchTokenResponse> {
  const body = new URLSearchParams({
    client_id: requireEnv('TWITCH_CLIENT_ID'),
    client_secret: requireEnv('TWITCH_CLIENT_SECRET'),
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    // 400/401 here typically means the user revoked authorization from Twitch's
    // side. The caller should treat it as a "connection revoked" event and
    // flip the DDB record's status rather than retrying.
    throw new Error(`Twitch token refresh failed (HTTP ${res.status})`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  return normalizeTokenResponse(json);
}

/**
 * Revoke a token at Twitch (best-effort, called from the disconnect route).
 * A failure here doesn't undo the local disconnect — the tokens are also
 * deleted from SSM regardless.
 */
export async function revokeToken(token: string): Promise<void> {
  try {
    const body = new URLSearchParams({
      client_id: requireEnv('TWITCH_CLIENT_ID'),
      token,
    });
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch {
    // Never let a revoke error cascade — the local record is authoritative.
  }
}

/**
 * Fetch the authenticated user's profile from Twitch's Helix `users` endpoint.
 * The token is a user access token minted by exchangeCodeForTokens; passing
 * no `login` returns the currently-authenticated user.
 */
export async function fetchAuthenticatedUser(accessToken: string): Promise<TwitchUser> {
  const res = await fetch(HELIX_USERS_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': requireEnv('TWITCH_CLIENT_ID'),
    },
  });
  if (!res.ok) {
    throw new Error(`Twitch users lookup failed (HTTP ${res.status})`);
  }
  const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
  const first = json.data?.[0];
  if (!first || typeof first.id !== 'string' || typeof first.login !== 'string') {
    throw new Error('Twitch users lookup returned no user');
  }
  return {
    id: first.id,
    login: first.login,
    display_name: typeof first.display_name === 'string' ? first.display_name : first.login,
    profile_image_url: typeof first.profile_image_url === 'string' ? first.profile_image_url : '',
  };
}

/**
 * Coerce Twitch's raw JSON into TwitchTokenResponse. The response's `scope`
 * field is a string array in the code-exchange response and (historically)
 * a space-separated string in some older refresh responses — normalize both
 * shapes so the caller doesn't have to.
 */
function normalizeTokenResponse(json: Record<string, unknown>): TwitchTokenResponse {
  const scope = Array.isArray(json.scope)
    ? json.scope.filter((s): s is string => typeof s === 'string')
    : typeof json.scope === 'string'
      ? json.scope.split(/\s+/).filter(Boolean)
      : [];
  const access = typeof json.access_token === 'string' ? json.access_token : '';
  const refresh = typeof json.refresh_token === 'string' ? json.refresh_token : '';
  const expires = typeof json.expires_in === 'number' ? json.expires_in : 0;
  if (!access || !refresh || expires <= 0) {
    throw new Error('Twitch token response missing required fields');
  }
  return { access_token: access, refresh_token: refresh, expires_in: expires, scope, token_type: 'bearer' };
}
