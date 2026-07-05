/**
 * Lyrics email-gate token.
 *
 * A visitor unlocks a song's lyrics by giving their name + email (captured as a
 * subscriber lead). We then set a signed, httpOnly cookie proving "this browser
 * gave us an email", and the gated read API (GET /api/lyrics/[id]) checks it.
 *
 * The token carries NO PII — it only asserts the gate was passed. It is an
 * HMAC-SHA256 signature over a tiny JSON payload, so it cannot be forged or
 * tampered with without the server secret. This is a soft lead-capture gate
 * (not DRM): the lyrics are free, we just want the email first.
 *
 * Format: `base64url(json).base64url(hmac)`. verifyGateToken recomputes the
 * HMAC and timing-safe-compares it, returning null on any tamper/format error.
 */

import crypto from 'crypto';

/** Name of the cookie that carries the signed gate token. */
export const LYRICS_GATE_COOKIE = 'tg_lyrics';

// Dev/build fallback so `next build` and local dev work without the secret set.
// NEVER relied on in production — set LYRICS_GATE_SECRET there (see next.config).
const DEV_DEFAULT_SECRET =
  'tamilagaval-dev-lyrics-gate-secret-change-me-in-production';

let warnedMissingSecret = false;

/** The signing secret, warning once if it falls back to the insecure default. */
function getSecret(): string {
  const secret = process.env.LYRICS_GATE_SECRET;
  if (secret && secret.length > 0) return secret;
  if (!warnedMissingSecret) {
    console.warn(
      '[lyrics-gate] LYRICS_GATE_SECRET is not set — using an insecure development default. Set LYRICS_GATE_SECRET for production.'
    );
    warnedMissingSecret = true;
  }
  return DEV_DEFAULT_SECRET;
}

export interface GateTokenPayload {
  /** Schema version — lets us rotate the payload shape later. */
  v: 1;
  /** ISO-8601 timestamp of when the gate was passed. */
  at: string;
}

/** Sign a gate payload into a `body.signature` token. */
export function signGateToken(payload: GateTokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSecret())
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

/**
 * Verify a gate token. Returns the payload only when the signature validates
 * (timing-safe) and the payload is well-formed; returns null on any
 * tamper/format/parse error or a missing token.
 */
export function verifyGateToken(
  token: string | undefined | null
): GateTokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  try {
    const expected = crypto
      .createHmac('sha256', getSecret())
      .update(body)
      .digest();
    const provided = Buffer.from(sig, 'base64url');
    // timingSafeEqual throws on length mismatch — bail first.
    if (provided.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(provided, expected)) return null;

    const parsed = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8')
    ) as GateTokenPayload;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      parsed.v !== 1 ||
      typeof parsed.at !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Cookie attributes for the gate cookie. httpOnly (JS can't read it → the
 * client must ask the server whether it's unlocked), Secure, SameSite=Lax,
 * site-wide, 180-day life.
 */
export function gateCookieOptions() {
  return {
    httpOnly: true as const,
    secure: true as const,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 60 * 24 * 180, // 180 days
  };
}
