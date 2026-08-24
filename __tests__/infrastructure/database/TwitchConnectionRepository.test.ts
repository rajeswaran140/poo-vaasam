/**
 * TwitchConnectionRepository tests focus on the two things a hydrate() function
 * must survive: (1) a legitimate row written by this code, and (2) an older /
 * partial row that lacks fields we've since added. Anything else on the repo
 * (put/get/markDisconnected/delete) is a thin passthrough to
 * DynamoDBOperations, which is its own tested layer.
 */

import type { TwitchConnection } from '@/types/twitch';

// Mock the shared DDB operations BEFORE importing the repo so the module
// closes over our stubs, not the real client.
jest.mock('@/infrastructure/database/dynamodb-client', () => {
  const opStub = {
    get: jest.fn(),
    put: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  return {
    DynamoDBOperations: opStub,
    handleDynamoDBError: (err: unknown) => {
      throw err instanceof Error ? err : new Error(String(err));
    },
    TABLE_NAME: 'TamilWebContent',
  };
});

import { TwitchConnectionRepository } from '@/infrastructure/database/TwitchConnectionRepository';
import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';

const ops = DynamoDBOperations as unknown as {
  get: jest.Mock;
  put: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
};

beforeEach(() => {
  ops.get.mockReset();
  ops.put.mockReset();
  ops.update.mockReset();
  ops.delete.mockReset();
});

describe('TwitchConnectionRepository', () => {
  const repo = new TwitchConnectionRepository();
  const tenantId = 'tamilagaval';

  describe('get / hydrate', () => {
    it('returns null when the row does not exist', async () => {
      ops.get.mockResolvedValueOnce(undefined);
      await expect(repo.get(tenantId)).resolves.toBeNull();
      expect(ops.get).toHaveBeenCalledWith({
        PK: 'TENANT#tamilagaval#TWITCH#CONNECTION',
        SK: 'METADATA',
      });
    });

    it('hydrates a well-formed row into the domain type', async () => {
      ops.get.mockResolvedValueOnce({
        tenantId: 'tamilagaval',
        twitchUserId: '12345',
        twitchLogin: 'tamilagaval',
        displayName: 'TamilAgaval',
        broadcasterId: '12345',
        profileImageUrl: 'https://cdn.twitch/img.png',
        connectionStatus: 'connected',
        scopes: ['user:read:email'],
        accessTokenSsmParam: '/amplify/d/master/TWITCH_ACCESS_TOKEN_tamilagaval',
        refreshTokenSsmParam: '/amplify/d/master/TWITCH_REFRESH_TOKEN_tamilagaval',
        accessTokenExpiresAt: '2026-08-24T10:00:00.000Z',
        connectedAt: '2026-08-20T00:00:00.000Z',
        updatedAt: '2026-08-24T00:00:00.000Z',
        disconnectedAt: null,
      });
      const conn = await repo.get(tenantId);
      expect(conn?.twitchLogin).toBe('tamilagaval');
      expect(conn?.connectionStatus).toBe('connected');
      expect(conn?.scopes).toEqual(['user:read:email']);
      expect(conn?.disconnectedAt).toBeNull();
    });

    it('degrades an older/partial row to sensible defaults (no crash)', async () => {
      ops.get.mockResolvedValueOnce({
        tenantId: 'tamilagaval',
        // twitchUserId + login + displayName all missing
        broadcasterId: '12345',
        // scopes missing (older schema)
        connectionStatus: 'connected',
        // no accessTokenSsmParam
      });
      const conn = await repo.get(tenantId);
      expect(conn).not.toBeNull();
      expect(conn?.twitchUserId).toBe('');
      expect(conn?.twitchLogin).toBe('');
      expect(conn?.scopes).toEqual([]);
      expect(conn?.profileImageUrl).toBeNull();
      expect(conn?.accessTokenSsmParam).toBe('');
    });

    it('coerces an unknown connectionStatus to disconnected (fail closed)', async () => {
      ops.get.mockResolvedValueOnce({
        tenantId: 'tamilagaval',
        connectionStatus: 'pending-authorization', // never a legal value
      });
      const conn = await repo.get(tenantId);
      expect(conn?.connectionStatus).toBe('disconnected');
    });

    it('filters non-string entries out of the scopes array', async () => {
      ops.get.mockResolvedValueOnce({
        tenantId: 'tamilagaval',
        connectionStatus: 'connected',
        scopes: ['ok', 42, null, undefined, 'also-ok'],
      });
      const conn = await repo.get(tenantId);
      expect(conn?.scopes).toEqual(['ok', 'also-ok']);
    });
  });

  describe('put', () => {
    it('writes with the correct PK/SK/Type', async () => {
      const conn: TwitchConnection = {
        tenantId,
        twitchUserId: '12345',
        twitchLogin: 'tamilagaval',
        displayName: 'TamilAgaval',
        broadcasterId: '12345',
        profileImageUrl: null,
        connectionStatus: 'connected',
        scopes: [],
        accessTokenSsmParam: '/x',
        refreshTokenSsmParam: '/y',
        accessTokenExpiresAt: '2026-08-24T10:00:00.000Z',
        connectedAt: '2026-08-20T00:00:00.000Z',
        updatedAt: '2026-08-24T00:00:00.000Z',
        disconnectedAt: null,
      };
      await repo.put(conn);
      expect(ops.put).toHaveBeenCalledTimes(1);
      const item = ops.put.mock.calls[0][0];
      expect(item.PK).toBe('TENANT#tamilagaval#TWITCH#CONNECTION');
      expect(item.SK).toBe('METADATA');
      expect(item.Type).toBe('TWITCH_CONNECTION');
      expect(item.twitchLogin).toBe('tamilagaval');
    });
  });

  describe('markDisconnected', () => {
    it('calls update with a condition that requires an existing row', async () => {
      ops.update.mockResolvedValueOnce({});
      await repo.markDisconnected(tenantId, 'disconnected', '2026-08-24T01:00:00.000Z');
      expect(ops.update).toHaveBeenCalledTimes(1);
      const args = ops.update.mock.calls[0][0];
      expect(args.key).toEqual({
        PK: 'TENANT#tamilagaval#TWITCH#CONNECTION',
        SK: 'METADATA',
      });
      expect(args.conditionExpression).toContain('attribute_exists');
      expect(args.expressionAttributeValues[':s']).toBe('disconnected');
      expect(args.expressionAttributeValues[':d']).toBe('2026-08-24T01:00:00.000Z');
    });

    it('supports revoked status too', async () => {
      ops.update.mockResolvedValueOnce({});
      await repo.markDisconnected(tenantId, 'revoked', '2026-08-24T01:00:00.000Z');
      expect(ops.update.mock.calls[0][0].expressionAttributeValues[':s']).toBe('revoked');
    });
  });

  describe('delete', () => {
    it('hard-deletes with the correct key', async () => {
      ops.delete.mockResolvedValueOnce({});
      await repo.delete(tenantId);
      expect(ops.delete).toHaveBeenCalledWith({
        PK: 'TENANT#tamilagaval#TWITCH#CONNECTION',
        SK: 'METADATA',
      });
    });
  });
});
