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

/** Current Cognito ID-token JWT, or null if not signed in / unavailable. */
export async function getIdToken(): Promise<string | null> {
  try {
    const session = await Auth.currentSession();
    return session.getIdToken().getJwtToken();
  } catch {
    return null;
  }
}

/** fetch() that attaches the admin's Cognito ID token (Bearer) and cookies. */
export async function adminFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const token = await getIdToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers, credentials: 'include' });
}
