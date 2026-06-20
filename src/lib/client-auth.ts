'use client';

/**
 * Client-side auth helpers for admin API calls.
 *
 * Amplify (v5) keeps Cognito tokens in browser storage, not cookies, so the
 * server can't reliably read a *fresh* token from the request cookies (a stale
 * cookie token fails JWT verification). These helpers attach the current ID
 * token as an `Authorization: Bearer` header, which the server verifies in
 * validateAuth(). Cookies are still sent as a fallback.
 */

import { Auth } from 'aws-amplify';

/**
 * Read the ID token straight from where Amplify persists it (browser storage).
 * Fallback for when Auth.currentSession() can't run (config quirks) but the
 * user is in fact signed in.
 */
function idTokenFromStorage(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const clientId = process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID;
    if (!clientId) return null;
    const prefix = `CognitoIdentityServiceProvider.${clientId}`;
    const lastUser = localStorage.getItem(`${prefix}.LastAuthUser`);
    if (!lastUser) return null;
    return localStorage.getItem(`${prefix}.${lastUser}.idToken`);
  } catch {
    return null;
  }
}

/** Current Cognito ID-token JWT, or null if not signed in / unavailable. */
export async function getIdToken(): Promise<string | null> {
  try {
    const session = await Auth.currentSession();
    const token = session.getIdToken().getJwtToken();
    if (token) return token;
  } catch {
    /* fall through to storage */
  }
  return idTokenFromStorage();
}

// Guard so concurrent 401s don't fire multiple sign-out/redirects.
let handlingExpiry = false;

/**
 * Force-delete every Cognito cookie via document.cookie.
 *
 * Amplify's `Auth.signOut()` is NOT enough when the session is already expired:
 * it tries to *revoke* the refresh token server-side first, that call fails on
 * an expired/revoked token, and it bails before clearing local storage — so the
 * stale cookies linger forever and the app stays wedged in a 401 loop (the app
 * looks logged in but every call fails, and signing out again can't fix it).
 *
 * To delete a cookie you must replay the exact attributes it was set with
 * (see amplify-config.ts: domain=apex, path=/, Secure, SameSite=Lax), so we
 * expire it across those plus a bare path=/ variant to be safe.
 */
export function clearCognitoCookies(): void {
  if (typeof document === 'undefined') return;
  const host = window.location.hostname;
  const base = host.endsWith('tamilagaval.com') ? 'tamilagaval.com' : host;
  const past = 'Thu, 01 Jan 1970 00:00:00 GMT';
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0].trim();
    if (!name.startsWith('CognitoIdentityServiceProvider')) continue;
    document.cookie = `${name}=; expires=${past}; path=/; domain=${base}; secure; samesite=lax`;
    document.cookie = `${name}=; expires=${past}; path=/; domain=.${base}; secure; samesite=lax`;
    document.cookie = `${name}=; expires=${past}; path=/`;
  }
}

/**
 * Recover from a dead admin session. A 401 means the Cognito session is
 * expired/invalid, yet the stale Cognito cookies linger (30-day cookie life vs
 * a much shorter token life) so the app still *looks* logged in and silently
 * 401s every call. Clear the stale session and bounce to /login so the admin
 * can re-authenticate, preserving where they were.
 */
async function handleExpiredSession(): Promise<void> {
  if (typeof window === 'undefined' || handlingExpiry) return;
  if (window.location.pathname.startsWith('/login')) return;
  handlingExpiry = true;
  try {
    await Auth.signOut();
  } catch {
    /* ignore — signOut throws when revoking an already-expired token */
  }
  // Belt-and-suspenders: signOut often can't purge an expired session, so force it.
  clearCognitoCookies();
  const here = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?redirect=${encodeURIComponent(here)}`);
}

/** fetch() that attaches the admin's Cognito ID token (Bearer) and cookies. */
export async function adminFetch(
  input: RequestInfo | URL,
  init: RequestInit & { suppressExpiryRedirect?: boolean } = {}
): Promise<Response> {
  const { suppressExpiryRedirect, ...rest } = init;
  const token = await getIdToken();
  const headers = new Headers(rest.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(input, { ...rest, headers, credentials: 'include' });
  // A 401 normally means the session died → sign out + redirect to /login. But
  // background, non-critical callers (e.g. the per-keystroke transliteration
  // aid) pass suppressExpiryRedirect so a transient/stale-token 401 degrades
  // quietly instead of booting the admin to /login mid-typing.
  if (res.status === 401 && !suppressExpiryRedirect) await handleExpiredSession();
  return res;
}
