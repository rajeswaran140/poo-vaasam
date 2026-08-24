/**
 * Twitch OAuth `state` parameter — CSRF defense for the authorization code flow.
 *
 * On `/api/admin/twitch/connect` we mint a random 32-byte token, HMAC-sign it
 * with a server-side secret, set it as an httpOnly Secure cookie, AND include
 * the same value as the `state` query parameter on the Twitch authorize URL.
 * When Twitch redirects back to `/api/admin/twitch/callback`, the callback
 * route reads the cookie, verifies the signature, and refuses to proceed if
 * the returned `state` doesn't match. A cross-site attacker can't set the
 * cookie AND can't forge the signature — the flow is bound to this browser
 * for this session.
 *
 * Signature shape mirrors lyrics-gate.ts (base64url(body).base64url(hmac))
 * so anyone reading one file understands the other; the difference is that
 * this token is single-use (deleted after callback) rather than a durable
 * session artefact.
 */

import crypto from 'crypto';

/** Name of the cookie carrying the signed state token. */
export const TWITCH_STATE_COOKIE = 'tg_twitch_oauth_state';

/** Cookie lifetime — the OAuth round-trip should complete within minutes. */
const STATE_COOKIE_MAX_AGE_SECONDS = 600; // 10 min

// Dev/build fallback so `next build` and local dev work without the secret set.
// NEVER relied on in production — set TWITCH_STATE_SECRET there (see next.config).
const DEV_DEFAULT_SECRET =
  'tamilagaval-dev-twitch-state-secret-change-me-in-production';

let warnedMissingSecret = false;

function getSecret(): string {
  const secret = process.env.TWITCH_STATE_SECRET;
  if (secret && secret.length > 0) return secret;
  if (!warnedMissingSecret) {
    console.warn(
      '[twitch-oauth-state] TWITCH_STATE_SECRET is not set — using an insecure development default. Set it in SSM for production.'
    );
    warnedMissingSecret = true;
  }
  return DEV_DEFAULT_SECRET;
}

export interface OAuthStatePayload {
  /** Schema version — lets us rotate the payload shape later. */
  v: 1;
  /** Random nonce; the caller's proof this browser started the flow. */
  nonce: string;
  /** ISO-8601 UTC timestamp of when the state was minted. */
  at: string;
  /** Optional post-callback redirect target within tamilagaval.com. */
  returnTo?: string;
}

/**
 * Mint a fresh state token. Returns both the signed token (goes in the cookie
 * AND the Twitch `state` query param) and the raw nonce (useful only in tests).
 */
export function mintOAuthState(returnTo?: string): { token: string; payload: OAuthStatePayload } {
  const payload: OAuthStatePayload = {
    v: 1,
    nonce: crypto.randomBytes(32).toString('base64url'),
    at: new Date().toISOString(),
    ...(returnTo ? { returnTo } : {}),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(body).digest('base64url');
  return { token: `${body}.${sig}`, payload };
}

/**
 * Verify a state token. Returns the payload on a valid signature + fresh
 * timestamp (within the cookie lifetime); returns null on any tamper / format /
 * parse / expiry error.
 */
export function verifyOAuthState(token: string | undefined | null): OAuthStatePayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  try {
    const expected = crypto.createHmac('sha256', getSecret()).update(body).digest();
    const provided = Buffer.from(sig, 'base64url');
    if (provided.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(provided, expected)) return null;

    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthStatePayload;
    if (!parsed || typeof parsed !== 'object' || parsed.v !== 1 || typeof parsed.nonce !== 'string' || typeof parsed.at !== 'string') {
      return null;
    }
    // Reject stale state — the cookie itself will also expire, but a caller
    // shouldn't proceed with a token older than we accept.
    const mintedAt = Date.parse(parsed.at);
    if (Number.isNaN(mintedAt) || Date.now() - mintedAt > STATE_COOKIE_MAX_AGE_SECONDS * 1000) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Cookie attributes for the state cookie. httpOnly (JS can't read it — critical
 * for CSRF defense), Secure, SameSite=Lax (so it rides the return redirect
 * from Twitch), site-wide, short-lived.
 */
export function oauthStateCookieOptions() {
  return {
    httpOnly: true as const,
    secure: true as const,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
  };
}

/** Same attributes with maxAge=0 — the callback route uses this to clear the cookie. */
export function oauthStateClearCookieOptions() {
  return {
    ...oauthStateCookieOptions(),
    maxAge: 0,
  };
}
