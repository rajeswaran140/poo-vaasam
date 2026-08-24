/**
 * Twitch APP access token (Client Credentials flow).
 *
 * Distinct from the user access token in oauth.ts — the app token has NO user
 * scope and identifies the CLIENT rather than any user. It's required by the
 * EventSub subscription-creation endpoint (POST /helix/eventsub/subscriptions)
 * because a webhook subscription is a client-scoped resource, not a user one.
 *
 * Token lifetime is ~60 days per Twitch's current spec (verify against docs
 * on any material change). We cache the token in SSM SecureString and refresh
 * proactively when the cached value is within 24h of expiry — cheap in-Lambda
 * check, and no window where a subscription-create call finds an expired token.
 *
 * Storage:
 *   /amplify/<app>/<branch>/TWITCH_APP_ACCESS_TOKEN — the token itself
 *   /amplify/<app>/<branch>/TWITCH_APP_ACCESS_TOKEN_EXPIRES_AT — ISO 8601 UTC
 *
 * The expiry sidecar is a String (not SecureString) — it's not a secret and
 * an unauthenticated read of an ISO timestamp discloses nothing sensitive.
 */

import { SSMClient, GetParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm';

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const REFRESH_HEADROOM_SECONDS = 24 * 60 * 60; // 24 h

const region = process.env.AWS_REGION || 'ca-central-1';
const ssm = new SSMClient({ region });

function ssmPrefix(): string {
  const app = process.env.AWS_APP_ID || 'd3rkmepk4popv0';
  const branch = process.env.AWS_BRANCH || 'master';
  return `/amplify/${app}/${branch}`;
}

const TOKEN_PARAM = () => `${ssmPrefix()}/TWITCH_APP_ACCESS_TOKEN`;
const EXPIRES_PARAM = () => `${ssmPrefix()}/TWITCH_APP_ACCESS_TOKEN_EXPIRES_AT`;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Twitch app-access-token: required env var ${name} is not set`);
  }
  return v;
}

interface AppTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: 'bearer';
}

async function mintFreshAppToken(): Promise<AppTokenResponse> {
  const body = new URLSearchParams({
    client_id: requireEnv('TWITCH_CLIENT_ID'),
    client_secret: requireEnv('TWITCH_CLIENT_SECRET'),
    grant_type: 'client_credentials',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`Twitch app token mint failed (HTTP ${res.status})`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  const access = typeof json.access_token === 'string' ? json.access_token : '';
  const expires = typeof json.expires_in === 'number' ? json.expires_in : 0;
  if (!access || expires <= 0) {
    throw new Error('Twitch app token response missing required fields');
  }
  return { access_token: access, expires_in: expires, token_type: 'bearer' };
}

async function readParam(name: string): Promise<string | null> {
  try {
    const r = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
    const v = r.Parameter?.Value;
    return v && v.length > 0 ? v : null;
  } catch (err) {
    if (err instanceof Error && err.name === 'ParameterNotFound') return null;
    throw err;
  }
}

async function writeSecret(name: string, value: string): Promise<void> {
  await ssm.send(
    new PutParameterCommand({
      Name: name,
      Value: value,
      Type: 'SecureString',
      KeyId: 'alias/aws/ssm',
      Overwrite: true,
      Description: 'Twitch app access token (auto-rotated).',
    })
  );
}

async function writeExpiresAt(name: string, iso: string): Promise<void> {
  await ssm.send(
    new PutParameterCommand({
      Name: name,
      Value: iso,
      Type: 'String', // not a secret
      Overwrite: true,
      Description: 'Twitch app access token expiry (ISO 8601 UTC).',
    })
  );
}

/**
 * Return an app access token valid for at least the next minute. Mints
 * (or refreshes) transparently when the cached one is within the headroom.
 */
export async function getAppAccessToken(): Promise<string> {
  const [cachedToken, cachedExpiresIso] = await Promise.all([
    readParam(TOKEN_PARAM()),
    readParam(EXPIRES_PARAM()),
  ]);

  if (cachedToken && cachedExpiresIso) {
    const expiresAt = Date.parse(cachedExpiresIso);
    const nowMs = Date.now();
    if (!Number.isNaN(expiresAt) && expiresAt - nowMs > REFRESH_HEADROOM_SECONDS * 1000) {
      return cachedToken;
    }
  }

  const fresh = await mintFreshAppToken();
  const expiresIso = new Date(Date.now() + fresh.expires_in * 1000).toISOString();
  await Promise.all([
    writeSecret(TOKEN_PARAM(), fresh.access_token),
    writeExpiresAt(EXPIRES_PARAM(), expiresIso),
  ]);
  return fresh.access_token;
}

/** Exported for tests + admin diagnostics. */
export const _paths = {
  token: TOKEN_PARAM,
  expiresAt: EXPIRES_PARAM,
};
