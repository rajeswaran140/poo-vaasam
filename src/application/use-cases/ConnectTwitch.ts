/**
 * ConnectTwitch — orchestrates the OAuth callback and keeps the connection
 * healthy afterwards.
 *
 *   validate state → exchange code → identify the channel → store connection
 *   → store tokens separately → reconcile EventSub subscriptions
 *
 * Depends on the repository and the Twitch client, both injected, so the whole
 * flow is unit-testable with fakes and makes no live Twitch calls in tests.
 */

import { TwitchConnectionRepository } from '@/infrastructure/database/TwitchConnectionRepository';
import {
  PHASE1_EVENTSUB_TYPES,
  type TwitchConfig,
} from '@/lib/twitch/config';
import {
  TwitchApiError,
  createEventSubSubscription,
  deleteEventSubSubscription,
  exchangeCode,
  getAuthenticatedUser,
  refreshUserToken,
  revokeToken,
} from '@/services/twitch/twitch-client';
import type {
  TwitchConnection,
  TwitchConnectionSecrets,
  TwitchSubscriptionStatus,
} from '@/types/twitch';
import { createLogger } from '@/lib/logger';

const log = createLogger('twitch:connect');

/** Injected so tests never touch the network or DynamoDB. */
export interface ConnectTwitchDeps {
  repo: TwitchConnectionRepository;
  exchangeCode: typeof exchangeCode;
  getAuthenticatedUser: typeof getAuthenticatedUser;
  createEventSubSubscription: typeof createEventSubSubscription;
  deleteEventSubSubscription: typeof deleteEventSubSubscription;
  refreshUserToken: typeof refreshUserToken;
  revokeToken: typeof revokeToken;
  now: () => Date;
}

export function defaultConnectTwitchDeps(): ConnectTwitchDeps {
  return {
    repo: new TwitchConnectionRepository(),
    exchangeCode,
    getAuthenticatedUser,
    createEventSubSubscription,
    deleteEventSubSubscription,
    refreshUserToken,
    revokeToken,
    now: () => new Date(),
  };
}

/** Normalise Twitch's `scope` (array or space-delimited string) to an array. */
function toScopeArray(scope: string[] | string | undefined): string[] {
  if (!scope) return [];
  return Array.isArray(scope) ? scope : scope.split(' ').filter(Boolean);
}

/**
 * Complete the OAuth callback. The caller has ALREADY validated the state
 * token — this use case does not receive it, so there is no way to accidentally
 * skip that check here and have it look fine.
 */
export async function completeConnection(
  config: TwitchConfig,
  tenantId: string,
  code: string,
  deps: ConnectTwitchDeps = defaultConnectTwitchDeps()
): Promise<TwitchConnection> {
  const tokens = await deps.exchangeCode(config, code);
  const user = await deps.getAuthenticatedUser(config, tokens.access_token);
  const nowIso = deps.now().toISOString();

  const existing = await deps.repo.get(tenantId);

  const connection: TwitchConnection = {
    tenantId,
    twitchUserId: user.id,
    twitchLogin: user.login,
    displayName: user.display_name,
    broadcasterId: user.id,
    profileImageUrl: user.profile_image_url,
    status: 'connected',
    scopes: toScopeArray(tokens.scope),
    // Reconnecting the SAME channel keeps the original connectedAt; a different
    // channel is a genuinely new connection.
    connectedAt:
      existing && existing.twitchUserId === user.id ? existing.connectedAt : nowIso,
    updatedAt: nowIso,
  };

  await deps.repo.upsert(connection);

  const secrets: TwitchConnectionSecrets = {
    tenantId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? '',
    accessTokenExpiresAt: new Date(
      deps.now().getTime() + tokens.expires_in * 1000
    ).toISOString(),
    updatedAt: nowIso,
  };
  await deps.repo.putSecrets(secrets);

  log.info('twitch connection established', {
    tenantId,
    broadcasterUserId: user.id,
    scopeCount: connection.scopes.length,
  });

  await ensureSubscriptions(config, connection, deps);
  return connection;
}

/**
 * Make the registered EventSub subscriptions match what Phase 1 needs.
 *
 * Never throws: a Twitch failure here marks the connection degraded rather than
 * failing the whole connect, because the OAuth half genuinely did succeed and
 * losing it would make the admin re-authorise for no reason.
 */
export async function ensureSubscriptions(
  config: TwitchConfig,
  connection: TwitchConnection,
  deps: ConnectTwitchDeps = defaultConnectTwitchDeps()
): Promise<void> {
  const existing = await deps.repo.listSubscriptions(connection.tenantId);
  const live = new Set(
    existing.filter((s) => s.status === 'enabled' || s.status === 'webhook_callback_verification_pending')
      .map((s) => s.type)
  );

  for (const { type, version } of PHASE1_EVENTSUB_TYPES) {
    if (live.has(type)) continue;
    try {
      const sub = await deps.createEventSubSubscription(config, {
        type,
        version,
        broadcasterUserId: connection.broadcasterId,
      });
      const nowIso = deps.now().toISOString();
      await deps.repo.putSubscription({
        tenantId: connection.tenantId,
        subscriptionId: sub.id,
        type: sub.type,
        version: sub.version,
        status: sub.status as TwitchSubscriptionStatus,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      log.info('eventsub subscription created', {
        tenantId: connection.tenantId,
        broadcasterUserId: connection.broadcasterId,
        eventType: type,
        subscriptionId: sub.id,
        result: sub.status,
      });
    } catch (error) {
      const reason =
        error instanceof TwitchApiError ? error.message : 'Unknown EventSub failure';
      log.error('eventsub subscription failed', error, {
        tenantId: connection.tenantId,
        eventType: type,
        result: 'failed',
      });
      await deps.repo.setStatus(connection.tenantId, 'degraded', reason);
    }
  }
}

/**
 * A valid user access token, refreshing it if it has expired or is about to.
 * Returns null when the connection must be re-authorised — callers degrade
 * rather than throwing at the user.
 */
export async function getValidUserToken(
  config: TwitchConfig,
  tenantId: string,
  deps: ConnectTwitchDeps = defaultConnectTwitchDeps()
): Promise<string | null> {
  const secrets = await deps.repo.getSecrets(tenantId);
  if (!secrets) return null;

  const expiresAt = Date.parse(secrets.accessTokenExpiresAt);
  const stillValid = Number.isFinite(expiresAt) && expiresAt - 60_000 > deps.now().getTime();
  if (stillValid) return secrets.accessToken;

  if (!secrets.refreshToken) {
    await deps.repo.setStatus(tenantId, 'reauth_required', 'No refresh token stored');
    return null;
  }

  try {
    const refreshed = await deps.refreshUserToken(config, secrets.refreshToken);
    const nowIso = deps.now().toISOString();
    await deps.repo.putSecrets({
      tenantId,
      accessToken: refreshed.access_token,
      // Twitch may or may not rotate the refresh token; keep the old one if not.
      refreshToken: refreshed.refresh_token ?? secrets.refreshToken,
      accessTokenExpiresAt: new Date(
        deps.now().getTime() + refreshed.expires_in * 1000
      ).toISOString(),
      updatedAt: nowIso,
    });
    return refreshed.access_token;
  } catch (error) {
    const requiresReauth = error instanceof TwitchApiError && error.requiresReauth;
    await deps.repo.setStatus(
      tenantId,
      requiresReauth ? 'reauth_required' : 'degraded',
      requiresReauth ? 'Twitch authorization was revoked' : 'Token refresh failed'
    );
    log.error('token refresh failed', error, { tenantId, result: 'failed' });
    return null;
  }
}

/**
 * Disconnect: remove EventSub subscriptions, revoke at Twitch, delete tokens.
 *
 * Local teardown happens even if Twitch is unreachable — an admin who clicks
 * Disconnect must end up disconnected, not stuck because of someone else's
 * outage.
 */
export async function disconnect(
  config: TwitchConfig,
  tenantId: string,
  deps: ConnectTwitchDeps = defaultConnectTwitchDeps()
): Promise<void> {
  const subs = await deps.repo.listSubscriptions(tenantId);
  for (const sub of subs) {
    try {
      await deps.deleteEventSubSubscription(config, sub.subscriptionId);
    } catch (error) {
      log.warn('could not delete eventsub subscription during disconnect', {
        tenantId,
        subscriptionId: sub.subscriptionId,
        result: error instanceof Error ? error.name : 'unknown',
      });
    }
    await deps.repo.deleteSubscription(tenantId, sub.subscriptionId);
  }

  const secrets = await deps.repo.getSecrets(tenantId);
  if (secrets?.accessToken) {
    await deps.revokeToken(config, secrets.accessToken);
  }
  await deps.repo.deleteSecrets(tenantId);
  await deps.repo.setStatus(tenantId, 'disconnected');

  log.info('twitch disconnected', { tenantId, result: 'ok' });
}
