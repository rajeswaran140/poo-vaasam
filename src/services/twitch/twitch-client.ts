/**
 * Twitch API client — the ONLY module that talks to Twitch over HTTP.
 *
 * Everything here returns typed results or throws TwitchApiError; nothing
 * leaks a raw fetch failure upward, so a Twitch outage surfaces as a degraded
 * connection in one admin panel rather than an unhandled rejection somewhere in
 * TamilAgaval.
 *
 * 🔴 SECRET DISCIPLINE. This file handles client secrets, authorization codes,
 * access tokens and refresh tokens. None of them are ever logged, put in an
 * error message, or returned to a caller that renders. Errors carry a status
 * and a short reason, never the payload.
 *
 * Verified against the current Twitch documentation (not from memory):
 *  - authorization-code exchange and refresh both POST to /oauth2/token,
 *    x-www-form-urlencoded;
 *  - the client-credentials (app access token) response has NO refresh token,
 *    so it is minted on demand and cached in-process until shortly before it
 *    expires;
 *  - creating an EventSub subscription over the WEBHOOK transport requires an
 *    APP access token — a user token is rejected. That is why two different
 *    token paths exist below and why the distinction is not an accident.
 */

import { z } from 'zod';
import {
  TWITCH_HELIX_URL,
  TWITCH_REVOKE_URL,
  TWITCH_TOKEN_URL,
  type TwitchConfig,
} from '@/lib/twitch/config';
import {
  twitchEventSubCreateResponseSchema,
  twitchEventSubListResponseSchema,
  twitchStreamsResponseSchema,
  twitchTokenResponseSchema,
  twitchUsersResponseSchema,
  type TwitchTokenResponse,
} from '@/types/twitch';

/** Typed failure so callers can distinguish "re-auth" from "Twitch is down". */
export class TwitchApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** True when the only fix is a fresh OAuth run (revoked/invalid token). */
    public readonly requiresReauth = false
  ) {
    super(message);
    this.name = 'TwitchApiError';
  }
}

/** Total attempts for a transient failure. Bounded — never an unbounded retry. */
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 150;
/** Fail fast rather than holding an EventSub response open. */
const REQUEST_TIMEOUT_MS = 5000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * fetch with a timeout and bounded retries on transport errors, 429 and 5xx.
 * 4xx (other than 429) is returned immediately — retrying a rejected token or a
 * malformed request only wastes the caller's response budget.
 */
async function requestWithRetry(
  url: string,
  init: RequestInit,
  attempt = 1
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_BASE_MS * attempt);
      return requestWithRetry(url, init, attempt + 1);
    }
    return res;
  } catch (err) {
    if (attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_BASE_MS * attempt);
      return requestWithRetry(url, init, attempt + 1);
    }
    throw new TwitchApiError(
      `Twitch request failed: ${err instanceof Error ? err.name : 'unknown'}`,
      503
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Parse a response body against a schema, failing loudly but without echoing it. */
async function parseJson<T>(res: Response, schema: z.ZodType<T>, what: string): Promise<T> {
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new TwitchApiError(`Malformed ${what} response from Twitch (not JSON)`, 502);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new TwitchApiError(`Malformed ${what} response from Twitch (unexpected shape)`, 502);
  }
  return parsed.data;
}

function form(params: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  };
}

// ---- OAuth ----------------------------------------------------------------

/** Exchange an authorization code for user tokens. */
export async function exchangeCode(
  config: TwitchConfig,
  code: string
): Promise<TwitchTokenResponse> {
  const res = await requestWithRetry(
    TWITCH_TOKEN_URL,
    form({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri,
    })
  );
  if (!res.ok) {
    // A bad/expired/replayed code is a client problem, not a Twitch outage.
    throw new TwitchApiError('Twitch rejected the authorization code', res.status, true);
  }
  return parseJson(res, twitchTokenResponseSchema, 'token');
}

/** Refresh an expired user access token. */
export async function refreshUserToken(
  config: TwitchConfig,
  refreshToken: string
): Promise<TwitchTokenResponse> {
  const res = await requestWithRetry(
    TWITCH_TOKEN_URL,
    form({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    })
  );
  if (!res.ok) {
    // 400/401 here means the user revoked us or changed their password.
    throw new TwitchApiError(
      'Twitch refused to refresh the token',
      res.status,
      res.status === 400 || res.status === 401
    );
  }
  return parseJson(res, twitchTokenResponseSchema, 'token refresh');
}

/** Best-effort token revocation on disconnect. Never throws. */
export async function revokeToken(config: TwitchConfig, accessToken: string): Promise<void> {
  try {
    await requestWithRetry(
      TWITCH_REVOKE_URL,
      form({ client_id: config.clientId, token: accessToken })
    );
  } catch {
    // Disconnect must succeed locally even if Twitch is unreachable — the
    // tokens are deleted on our side regardless, which is what matters.
  }
}

// ---- App access token (required for webhook EventSub) ---------------------

let appTokenCache: { token: string; expiresAt: number } | null = null;
/** Re-mint this long before expiry so an in-flight call never uses a dead token. */
const APP_TOKEN_SKEW_MS = 60_000;

/** Test hook: drop the cached app token. */
export function __resetAppTokenCacheForTests(): void {
  appTokenCache = null;
}

/**
 * Mint (or reuse) an app access token via the client-credentials grant.
 * There is no refresh token for this grant, so expiry means re-minting.
 */
export async function getAppAccessToken(config: TwitchConfig): Promise<string> {
  const now = Date.now();
  if (appTokenCache && appTokenCache.expiresAt - APP_TOKEN_SKEW_MS > now) {
    return appTokenCache.token;
  }
  const res = await requestWithRetry(
    TWITCH_TOKEN_URL,
    form({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'client_credentials',
    })
  );
  if (!res.ok) {
    throw new TwitchApiError('Could not obtain a Twitch app access token', res.status);
  }
  const token = await parseJson(res, twitchTokenResponseSchema, 'app token');
  appTokenCache = {
    token: token.access_token,
    expiresAt: now + token.expires_in * 1000,
  };
  return token.access_token;
}

// ---- Helix ----------------------------------------------------------------

function helixInit(config: TwitchConfig, token: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      'Client-Id': config.clientId,
      Authorization: `Bearer ${token}`,
    },
  };
}

/**
 * The authenticated user behind a user access token.
 * Requires NO scope — see lib/twitch/config.ts for why Phase 1 asks for none.
 */
export async function getAuthenticatedUser(config: TwitchConfig, userAccessToken: string) {
  const res = await requestWithRetry(
    `${TWITCH_HELIX_URL}/users`,
    helixInit(config, userAccessToken)
  );
  if (res.status === 401) {
    throw new TwitchApiError('Twitch user token is no longer valid', 401, true);
  }
  if (!res.ok) throw new TwitchApiError('Could not read the Twitch user', res.status);

  const body = await parseJson(res, twitchUsersResponseSchema, 'users');
  const user = body.data[0];
  if (!user) throw new TwitchApiError('Twitch returned no user for this token', 502);
  return user;
}

/**
 * Current stream for a broadcaster, or null when offline.
 * Public data — uses the app token, so it keeps working even if the user token
 * needs re-authorising.
 */
export async function getStream(config: TwitchConfig, broadcasterId: string) {
  const token = await getAppAccessToken(config);
  const res = await requestWithRetry(
    `${TWITCH_HELIX_URL}/streams?user_id=${encodeURIComponent(broadcasterId)}`,
    helixInit(config, token)
  );
  if (!res.ok) throw new TwitchApiError('Could not read Twitch stream status', res.status);
  const body = await parseJson(res, twitchStreamsResponseSchema, 'streams');
  return body.data[0] ?? null;
}

// ---- EventSub -------------------------------------------------------------

/**
 * Create a webhook EventSub subscription.
 * ⚠️ App access token — a user token is rejected for the webhook transport.
 */
export async function createEventSubSubscription(
  config: TwitchConfig,
  params: { type: string; version: string; broadcasterUserId: string }
) {
  const token = await getAppAccessToken(config);
  const res = await requestWithRetry(
    `${TWITCH_HELIX_URL}/eventsub/subscriptions`,
    helixInit(config, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: params.type,
        version: params.version,
        condition: { broadcaster_user_id: params.broadcasterUserId },
        transport: {
          method: 'webhook',
          callback: config.eventSubCallbackUrl,
          secret: config.eventSubSecret,
        },
      }),
    })
  );
  if (res.status === 409) {
    throw new TwitchApiError('That EventSub subscription already exists', 409);
  }
  if (!res.ok) {
    throw new TwitchApiError(`Could not create the ${params.type} subscription`, res.status);
  }
  const body = await parseJson(res, twitchEventSubCreateResponseSchema, 'eventsub create');
  const sub = body.data[0];
  if (!sub) throw new TwitchApiError('Twitch created no subscription', 502);
  return sub;
}

/** All EventSub subscriptions registered for this application. */
export async function listEventSubSubscriptions(config: TwitchConfig) {
  const token = await getAppAccessToken(config);
  const res = await requestWithRetry(
    `${TWITCH_HELIX_URL}/eventsub/subscriptions`,
    helixInit(config, token)
  );
  if (!res.ok) {
    throw new TwitchApiError('Could not list EventSub subscriptions', res.status);
  }
  const body = await parseJson(res, twitchEventSubListResponseSchema, 'eventsub list');
  return body.data;
}

/** Delete a subscription. Treats "already gone" (404) as success. */
export async function deleteEventSubSubscription(
  config: TwitchConfig,
  subscriptionId: string
): Promise<void> {
  const token = await getAppAccessToken(config);
  const res = await requestWithRetry(
    `${TWITCH_HELIX_URL}/eventsub/subscriptions?id=${encodeURIComponent(subscriptionId)}`,
    helixInit(config, token, { method: 'DELETE' })
  );
  if (!res.ok && res.status !== 404) {
    throw new TwitchApiError('Could not delete the EventSub subscription', res.status);
  }
}
