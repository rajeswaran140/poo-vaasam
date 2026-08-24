/**
 * Twitch OAuth token persistence — SSM SecureString.
 *
 * Both the access token AND the refresh token live in SSM, never in DDB and
 * never in env vars. Same rationale as the P2.4 migration for every other
 * TamilAgaval secret: SSM adds a KMS envelope + per-param IAM boundary +
 * CloudTrail audit trail that DDB (even with encryption-at-rest + PITR)
 * doesn't give us for free.
 *
 * Param names are tenant-scoped:
 *   /amplify/<AWS_APP_ID>/<AWS_BRANCH>/TWITCH_ACCESS_TOKEN_<tenantId>
 *   /amplify/<AWS_APP_ID>/<AWS_BRANCH>/TWITCH_REFRESH_TOKEN_<tenantId>
 * so that (a) the existing amplify.yml SSM-fetch loop can pull them at build
 * time if we ever want compile-inlined defaults, and (b) a multi-tenant
 * future adds new params without disturbing existing ones.
 *
 * `getFreshAccessToken()` is the ONE function API routes should call to get
 * a token — it handles refresh-if-expired transparently and always returns
 * a token that will be valid for the next 60 s of API calls.
 */

import { SSMClient, GetParameterCommand, PutParameterCommand, DeleteParameterCommand } from '@aws-sdk/client-ssm';
import { TwitchConnectionRepository } from '@/infrastructure/database/TwitchConnectionRepository';
import { refreshAccessToken, type TwitchTokenResponse } from './oauth';

/** How long before expiry to trigger a proactive refresh. Twitch tokens live ~4h. */
const REFRESH_HEADROOM_SECONDS = 300; // 5 min

const region = process.env.AWS_REGION || 'ca-central-1';
const ssm = new SSMClient({ region });

function ssmPrefix(): string {
  const app = process.env.AWS_APP_ID || 'd3rkmepk4popv0';
  const branch = process.env.AWS_BRANCH || 'master';
  return `/amplify/${app}/${branch}`;
}

export function accessTokenParamName(tenantId: string): string {
  return `${ssmPrefix()}/TWITCH_ACCESS_TOKEN_${tenantId}`;
}

export function refreshTokenParamName(tenantId: string): string {
  return `${ssmPrefix()}/TWITCH_REFRESH_TOKEN_${tenantId}`;
}

async function readSsmSecret(name: string): Promise<string | null> {
  try {
    const r = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
    const v = r.Parameter?.Value;
    return v && v.length > 0 ? v : null;
  } catch (err) {
    // ParameterNotFound is the expected shape when a tenant has never connected.
    if (err instanceof Error && err.name === 'ParameterNotFound') return null;
    throw err;
  }
}

async function writeSsmSecret(name: string, value: string, description: string): Promise<void> {
  await ssm.send(
    new PutParameterCommand({
      Name: name,
      Value: value,
      Type: 'SecureString',
      KeyId: 'alias/aws/ssm',
      Overwrite: true,
      Description: description,
    })
  );
}

async function deleteSsmSecret(name: string): Promise<void> {
  try {
    await ssm.send(new DeleteParameterCommand({ Name: name }));
  } catch (err) {
    if (err instanceof Error && err.name === 'ParameterNotFound') return;
    throw err;
  }
}

/**
 * Persist a token pair after a successful code exchange or refresh.
 * Overwrites whatever is at the SSM paths (Twitch's refresh token may
 * rotate, so we always write both).
 */
export async function storeTokens(tenantId: string, tokens: TwitchTokenResponse): Promise<void> {
  await writeSsmSecret(
    accessTokenParamName(tenantId),
    tokens.access_token,
    `Twitch OAuth access token for tenant ${tenantId} (rotated automatically on refresh)`
  );
  await writeSsmSecret(
    refreshTokenParamName(tenantId),
    tokens.refresh_token,
    `Twitch OAuth refresh token for tenant ${tenantId}`
  );
}

/** Delete both SSM params. Called by the disconnect route. */
export async function deleteTokens(tenantId: string): Promise<void> {
  await deleteSsmSecret(accessTokenParamName(tenantId));
  await deleteSsmSecret(refreshTokenParamName(tenantId));
}

/**
 * Return an access token that will be valid for at least the next 60s. If
 * the cached token is within REFRESH_HEADROOM_SECONDS of expiry we refresh
 * it, persist both new tokens to SSM, and update the DDB record's
 * accessTokenExpiresAt so the next caller can decide without a token read.
 *
 * Throws if the tenant has no stored refresh token — that's a "not connected"
 * state and the caller should treat it as such rather than retrying.
 */
export async function getFreshAccessToken(tenantId: string): Promise<string> {
  const repo = new TwitchConnectionRepository();
  const conn = await repo.get(tenantId);
  if (!conn || conn.connectionStatus !== 'connected') {
    throw new Error(`Twitch: tenant '${tenantId}' has no active connection`);
  }

  const expiresAt = Date.parse(conn.accessTokenExpiresAt);
  const nowMs = Date.now();
  const needsRefresh = Number.isNaN(expiresAt) || expiresAt - nowMs < REFRESH_HEADROOM_SECONDS * 1000;

  if (!needsRefresh) {
    const current = await readSsmSecret(accessTokenParamName(tenantId));
    if (current) return current;
    // Fell through — access token param is gone. Refresh below.
  }

  const refreshToken = await readSsmSecret(refreshTokenParamName(tenantId));
  if (!refreshToken) {
    throw new Error(`Twitch: refresh token missing for tenant '${tenantId}' — user must reconnect`);
  }
  const tokens = await refreshAccessToken(refreshToken);
  await storeTokens(tenantId, tokens);

  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  await repo.put({
    ...conn,
    accessTokenSsmParam: accessTokenParamName(tenantId),
    refreshTokenSsmParam: refreshTokenParamName(tenantId),
    accessTokenExpiresAt: newExpiresAt,
    updatedAt: new Date().toISOString(),
  });

  return tokens.access_token;
}
