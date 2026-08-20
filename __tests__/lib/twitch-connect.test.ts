/** @jest-environment node */
/**
 * ConnectTwitch — OAuth completion, token refresh, and disconnect.
 *
 * All Twitch HTTP calls are injected fakes; nothing here touches the network.
 */

import {
  completeConnection,
  disconnect,
  ensureSubscriptions,
  getValidUserToken,
  type ConnectTwitchDeps,
} from '@/application/use-cases/ConnectTwitch';
import { TwitchApiError } from '@/services/twitch/twitch-client';
import type { TwitchConfig } from '@/lib/twitch/config';
import type { TwitchConnection } from '@/types/twitch';

const CONFIG: TwitchConfig = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  eventSubSecret: 'eventsub-secret',
  redirectUri: 'https://tamilagaval.com/api/twitch/callback',
  eventSubCallbackUrl: 'https://tamilagaval.com/api/twitch/eventsub',
};

const TENANT = 'tamilagaval';
const NOW = new Date('2026-08-20T12:00:00Z');

function makeDeps(over: Record<string, unknown> = {}) {
  const repo = {
    get: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue(undefined),
    setStatus: jest.fn().mockResolvedValue(undefined),
    getSecrets: jest.fn().mockResolvedValue(null),
    putSecrets: jest.fn().mockResolvedValue(undefined),
    deleteSecrets: jest.fn().mockResolvedValue(undefined),
    listSubscriptions: jest.fn().mockResolvedValue([]),
    putSubscription: jest.fn().mockResolvedValue(undefined),
    deleteSubscription: jest.fn().mockResolvedValue(undefined),
  };
  const raw = {
    repo,
    exchangeCode: jest.fn().mockResolvedValue({
      access_token: 'user-access-token',
      refresh_token: 'user-refresh-token',
      expires_in: 3600,
      token_type: 'bearer',
      scope: [],
    }),
    getAuthenticatedUser: jest.fn().mockResolvedValue({
      id: '99',
      login: 'tamilagaval',
      display_name: 'TamilAgaval',
      profile_image_url: 'https://cdn.twitch.tv/pic.png',
    }),
    // Signature mirrors the real client: (config, { type, version, broadcasterUserId }).
    createEventSubSubscription: jest
      .fn()
      .mockImplementation((_config: unknown, { type, version }: { type: string; version: string }) =>
        Promise.resolve({
          id: `sub-${type}`,
          status: 'webhook_callback_verification_pending',
          type,
          version,
        })
      ),
    deleteEventSubSubscription: jest.fn().mockResolvedValue(undefined),
    refreshUserToken: jest.fn(),
    revokeToken: jest.fn().mockResolvedValue(undefined),
    now: () => NOW,
    ...over,
  };
  // Intersection so the tests can assert on the jest.fn()s while the use case
  // still receives something it accepts.
  return { repo, deps: raw as unknown as ConnectTwitchDeps & typeof raw };
}

describe('completeConnection', () => {
  it('stores the connection and the tokens as SEPARATE items', async () => {
    const { repo, deps } = makeDeps();
    const connection = await completeConnection(CONFIG, TENANT, 'auth-code', deps);

    expect(connection).toMatchObject({
      tenantId: TENANT,
      twitchUserId: '99',
      twitchLogin: 'tamilagaval',
      broadcasterId: '99',
      status: 'connected',
    });

    // The connection row must never carry a token.
    const stored = repo.upsert.mock.calls[0][0];
    expect(JSON.stringify(stored)).not.toContain('user-access-token');
    expect(JSON.stringify(stored)).not.toContain('user-refresh-token');

    expect(repo.putSecrets).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'user-access-token',
        refreshToken: 'user-refresh-token',
        accessTokenExpiresAt: new Date(NOW.getTime() + 3600_000).toISOString(),
      })
    );
  });

  it('registers both Phase 1 EventSub subscriptions', async () => {
    const { repo, deps } = makeDeps();
    await completeConnection(CONFIG, TENANT, 'auth-code', deps);

    const types = repo.putSubscription.mock.calls.map((c) => c[0].type);
    expect(types).toEqual(expect.arrayContaining(['stream.online', 'stream.offline']));
  });

  it('records the granted scopes, normalising the space-delimited form', async () => {
    const { deps } = makeDeps({
      exchangeCode: jest.fn().mockResolvedValue({
        access_token: 't',
        refresh_token: 'r',
        expires_in: 3600,
        token_type: 'bearer',
        scope: 'channel:read:subscriptions bits:read',
      }),
    });
    const connection = await completeConnection(CONFIG, TENANT, 'code', deps);
    expect(connection.scopes).toEqual(['channel:read:subscriptions', 'bits:read']);
  });

  it('keeps the original connectedAt when reconnecting the same channel', async () => {
    const existing: TwitchConnection = {
      tenantId: TENANT,
      twitchUserId: '99',
      twitchLogin: 'tamilagaval',
      displayName: 'TamilAgaval',
      broadcasterId: '99',
      status: 'reauth_required',
      scopes: [],
      connectedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const { repo, deps } = makeDeps();
    repo.get.mockResolvedValue(existing);

    const connection = await completeConnection(CONFIG, TENANT, 'code', deps);
    expect(connection.connectedAt).toBe('2026-01-01T00:00:00Z');
    expect(connection.status).toBe('connected');
  });

  it('treats a DIFFERENT channel as a new connection', async () => {
    const { repo, deps } = makeDeps();
    repo.get.mockResolvedValue({
      twitchUserId: 'a-different-channel',
      connectedAt: '2026-01-01T00:00:00Z',
    });
    const connection = await completeConnection(CONFIG, TENANT, 'code', deps);
    expect(connection.connectedAt).toBe(NOW.toISOString());
  });

  it('marks the connection degraded — not failed — when EventSub cannot be created', async () => {
    const { repo, deps } = makeDeps({
      createEventSubSubscription: jest
        .fn()
        .mockRejectedValue(new TwitchApiError('Twitch is unavailable', 503)),
    });

    // The OAuth half genuinely succeeded, so this must not throw.
    await expect(completeConnection(CONFIG, TENANT, 'code', deps)).resolves.toBeTruthy();
    expect(repo.setStatus).toHaveBeenCalledWith(TENANT, 'degraded', expect.any(String));
  });
});

describe('ensureSubscriptions', () => {
  const connection: TwitchConnection = {
    tenantId: TENANT,
    twitchUserId: '99',
    twitchLogin: 'tamilagaval',
    displayName: 'TamilAgaval',
    broadcasterId: '99',
    status: 'connected',
    scopes: [],
    connectedAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };

  it('does not re-create a subscription that is already live', async () => {
    const { repo, deps } = makeDeps();
    repo.listSubscriptions.mockResolvedValue([
      { type: 'stream.online', status: 'enabled', subscriptionId: 's1' },
      { type: 'stream.offline', status: 'enabled', subscriptionId: 's2' },
    ]);

    await ensureSubscriptions(CONFIG, connection, deps);
    expect(deps.createEventSubSubscription).not.toHaveBeenCalled();
  });

  it('recreates a subscription that was revoked', async () => {
    const { repo, deps } = makeDeps();
    repo.listSubscriptions.mockResolvedValue([
      { type: 'stream.online', status: 'authorization_revoked', subscriptionId: 's1' },
      { type: 'stream.offline', status: 'enabled', subscriptionId: 's2' },
    ]);

    await ensureSubscriptions(CONFIG, connection, deps);
    expect(deps.createEventSubSubscription).toHaveBeenCalledTimes(1);
    expect(deps.createEventSubSubscription).toHaveBeenCalledWith(
      CONFIG,
      expect.objectContaining({ type: 'stream.online' })
    );
  });
});

describe('getValidUserToken', () => {
  it('returns the stored token while it is still valid', async () => {
    const { repo, deps } = makeDeps();
    repo.getSecrets.mockResolvedValue({
      tenantId: TENANT,
      accessToken: 'still-good',
      refreshToken: 'r',
      accessTokenExpiresAt: new Date(NOW.getTime() + 600_000).toISOString(),
      updatedAt: NOW.toISOString(),
    });

    expect(await getValidUserToken(CONFIG, TENANT, deps)).toBe('still-good');
    expect(deps.refreshUserToken).not.toHaveBeenCalled();
  });

  it('refreshes an expired token and stores the new one', async () => {
    const { repo, deps } = makeDeps({
      refreshUserToken: jest.fn().mockResolvedValue({
        access_token: 'fresh',
        refresh_token: 'new-refresh',
        expires_in: 3600,
        token_type: 'bearer',
      }),
    });
    repo.getSecrets.mockResolvedValue({
      tenantId: TENANT,
      accessToken: 'expired',
      refreshToken: 'old-refresh',
      accessTokenExpiresAt: new Date(NOW.getTime() - 1000).toISOString(),
      updatedAt: NOW.toISOString(),
    });

    expect(await getValidUserToken(CONFIG, TENANT, deps)).toBe('fresh');
    expect(repo.putSecrets).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'fresh', refreshToken: 'new-refresh' })
    );
  });

  it('keeps the old refresh token when Twitch does not rotate it', async () => {
    const { repo, deps } = makeDeps({
      refreshUserToken: jest.fn().mockResolvedValue({
        access_token: 'fresh',
        expires_in: 3600,
        token_type: 'bearer',
      }),
    });
    repo.getSecrets.mockResolvedValue({
      tenantId: TENANT,
      accessToken: 'expired',
      refreshToken: 'old-refresh',
      accessTokenExpiresAt: new Date(NOW.getTime() - 1000).toISOString(),
      updatedAt: NOW.toISOString(),
    });

    await getValidUserToken(CONFIG, TENANT, deps);
    expect(repo.putSecrets).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: 'old-refresh' })
    );
  });

  it('marks reauth_required when the user has revoked us', async () => {
    const { repo, deps } = makeDeps({
      refreshUserToken: jest
        .fn()
        .mockRejectedValue(new TwitchApiError('revoked', 400, true)),
    });
    repo.getSecrets.mockResolvedValue({
      tenantId: TENANT,
      accessToken: 'expired',
      refreshToken: 'dead-refresh',
      accessTokenExpiresAt: new Date(NOW.getTime() - 1000).toISOString(),
      updatedAt: NOW.toISOString(),
    });

    expect(await getValidUserToken(CONFIG, TENANT, deps)).toBeNull();
    expect(repo.setStatus).toHaveBeenCalledWith(TENANT, 'reauth_required', expect.any(String));
  });

  it('marks degraded — not reauth_required — when Twitch is merely down', async () => {
    const { repo, deps } = makeDeps({
      refreshUserToken: jest.fn().mockRejectedValue(new TwitchApiError('down', 503)),
    });
    repo.getSecrets.mockResolvedValue({
      tenantId: TENANT,
      accessToken: 'expired',
      refreshToken: 'r',
      accessTokenExpiresAt: new Date(NOW.getTime() - 1000).toISOString(),
      updatedAt: NOW.toISOString(),
    });

    expect(await getValidUserToken(CONFIG, TENANT, deps)).toBeNull();
    expect(repo.setStatus).toHaveBeenCalledWith(TENANT, 'degraded', expect.any(String));
  });

  it('returns null when nothing is stored', async () => {
    const { deps } = makeDeps();
    expect(await getValidUserToken(CONFIG, TENANT, deps)).toBeNull();
  });
});

describe('disconnect', () => {
  it('removes subscriptions, revokes the token and deletes the secrets', async () => {
    const { repo, deps } = makeDeps();
    repo.listSubscriptions.mockResolvedValue([
      { tenantId: TENANT, subscriptionId: 's1', type: 'stream.online' },
      { tenantId: TENANT, subscriptionId: 's2', type: 'stream.offline' },
    ]);
    repo.getSecrets.mockResolvedValue({
      tenantId: TENANT,
      accessToken: 'to-revoke',
      refreshToken: 'r',
      accessTokenExpiresAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });

    await disconnect(CONFIG, TENANT, deps);

    expect(deps.deleteEventSubSubscription).toHaveBeenCalledTimes(2);
    expect(repo.deleteSubscription).toHaveBeenCalledTimes(2);
    expect(deps.revokeToken).toHaveBeenCalledWith(CONFIG, 'to-revoke');
    expect(repo.deleteSecrets).toHaveBeenCalledWith(TENANT);
    expect(repo.setStatus).toHaveBeenCalledWith(TENANT, 'disconnected');
  });

  it('still disconnects locally when Twitch is unreachable', async () => {
    const { repo, deps } = makeDeps({
      deleteEventSubSubscription: jest.fn().mockRejectedValue(new Error('network down')),
    });
    repo.listSubscriptions.mockResolvedValue([
      { tenantId: TENANT, subscriptionId: 's1', type: 'stream.online' },
    ]);

    await expect(disconnect(CONFIG, TENANT, deps)).resolves.toBeUndefined();
    expect(repo.deleteSecrets).toHaveBeenCalledWith(TENANT);
    expect(repo.setStatus).toHaveBeenCalledWith(TENANT, 'disconnected');
  });
});
