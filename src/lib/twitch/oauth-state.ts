/**
 * OAuth `state` token for the Twitch connect flow.
 *
 * Twitch's authorization-code flow requires a state value that is "randomly
 * generated and unique for each OAuth request" to prevent CSRF. Rather than
 * keeping server-side session state (this app has no session store, and the SSR
 * runtime is multi-instance), the state is a SIGNED, EXPIRING token — the same
 * HMAC construction already used by src/lib/lyrics-gate.ts.
 *
 * That gives us all three properties we need:
 *  - unforgeable  — an attacker cannot mint a state without the server secret,
 *  - single-purpose — the nonce and tenant are bound into the signature,
 *  - short-lived  — an intercepted authorize URL is useless after TTL.
 *
 * Format: `base64url(json).base64url(hmac)` — identical in shape to the lyrics
 * gate token, so the two are recognisably the same idea.
 */

import crypto from 'crypto';

/** How long an authorize round-trip may take before the state is rejected. */
export const STATE_TTL_MS = 10 * 60 * 1000;

export interface OAuthStatePayload {
  /** Schema version, so the payload shape can be rotated later. */
  v: 1;
  /** Which creator/tenant this connect flow belongs to. */
  t: string;
  /** Random nonce — makes every authorize URL unique. */
  n: string;
  /** Issued-at, epoch milliseconds. */
  iat: number;
}

function sign(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Mint a signed state token for a connect attempt. */
export function createOAuthState(
  tenantId: string,
  secret: string,
  now: number = Date.now()
): string {
  const payload: OAuthStatePayload = {
    v: 1,
    t: tenantId,
    n: crypto.randomBytes(16).toString('base64url'),
    iat: now,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

/**
 * Verify a state token returned by Twitch.
 *
 * Returns the payload only when the signature validates AND the token is within
 * its TTL; otherwise null. Never throws — a malformed state is just a rejected
 * callback, not a 500.
 */
export function verifyOAuthState(
  token: string | null | undefined,
  secret: string,
  now: number = Date.now(),
  ttlMs: number = STATE_TTL_MS
): OAuthStatePayload | null {
  if (!token || !secret) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  if (!body || !signature) return null;

  if (!safeEqual(sign(body, secret), signature)) return null;

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (payload?.v !== 1 || typeof payload.t !== 'string' || typeof payload.iat !== 'number') {
    return null;
  }
  // Reject expired AND future-dated tokens (clock-skew abuse).
  if (now - payload.iat > ttlMs || payload.iat - now > ttlMs) return null;

  return payload;
}
