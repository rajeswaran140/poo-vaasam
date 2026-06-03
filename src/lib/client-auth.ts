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
    /* ignore — we redirect regardless */
  }
  const here = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?redirect=${encodeURIComponent(here)}`);
}

/** fetch() that attaches the admin's Cognito ID token (Bearer) and cookies. */
export async function adminFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const token = await getIdToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(input, { ...init, headers, credentials: 'include' });
  if (res.status === 401) await handleExpiredSession();
  return res;
}
