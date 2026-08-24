/**
 * Persistence for the TwitchConnection domain (single-table:
 * PK=`TENANT#<tenantId>#TWITCH#CONNECTION`, SK=`METADATA`). One connection per
 * tenant/creator today; the SK is kept `METADATA` rather than the connection's
 * id so a soft `disconnected` record cannot collide with a fresh reconnect —
 * reconnect overwrites the same row, disconnect flips the status field.
 *
 * Mirrors the shape of MasterJobRepository: hydrate() is the single place raw
 * DDB items become the domain type, so an older/partial row (e.g. written
 * before a field was added) degrades to a sensible default here instead of
 * blowing up further down the call chain.
 *
 * NB: this repo NEVER touches OAuth tokens. Both access and refresh tokens
 * live in SSM SecureString (see src/lib/twitch/oauth.ts). Storing tokens in
 * DDB would leak them into PITR backups + any future DDB export path; SSM
 * gives us a KMS envelope + a per-param IAM boundary for free.
 */

import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';
import type { TwitchConnection, TwitchConnectionStatus } from '@/types/twitch';

const pk = (tenantId: string) => `TENANT#${tenantId}#TWITCH#CONNECTION`;
const SK = 'METADATA';

export class TwitchConnectionRepository {
  /** Read the connection for a tenant. Null when the tenant has never connected. */
  async get(tenantId: string): Promise<TwitchConnection | null> {
    try {
      const item = await DynamoDBOperations.get({ PK: pk(tenantId), SK });
      if (!item) return null;
      return this.hydrate(item);
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Idempotent upsert. Callers set `connectedAt` on first connect and preserve
   * it on subsequent writes (so reconnect doesn't reset the original-connect
   * timestamp). `updatedAt` should always be `new Date().toISOString()`.
   */
  async put(conn: TwitchConnection): Promise<void> {
    try {
      await DynamoDBOperations.put({
        PK: pk(conn.tenantId),
        SK,
        Type: 'TWITCH_CONNECTION',
        ...conn,
      });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Soft-disconnect: flip status + set disconnectedAt, keep the record for
   * audit/debug. The SSM tokens are deleted separately by the disconnect
   * route — the record staying while the tokens are gone is the correct
   * "revoked/disconnected" shape.
   */
  async markDisconnected(
    tenantId: string,
    status: Extract<TwitchConnectionStatus, 'disconnected' | 'revoked'>,
    at: string
  ): Promise<void> {
    try {
      await DynamoDBOperations.update({
        key: { PK: pk(tenantId), SK },
        updateExpression:
          'SET connectionStatus = :s, disconnectedAt = :d, updatedAt = :u',
        expressionAttributeValues: {
          ':s': status,
          ':d': at,
          ':u': at,
        },
        // Refuse to update a nonexistent row — a stray call shouldn't create
        // a phantom "disconnected" record for a tenant that never connected.
        conditionExpression: 'attribute_exists(PK)',
      });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Hard-delete the record. Only for explicit wipe (e.g. tenant offboarding);
   * `markDisconnected` is the audit-preserving default.
   */
  async delete(tenantId: string): Promise<void> {
    try {
      await DynamoDBOperations.delete({ PK: pk(tenantId), SK });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Raw DDB item -> TwitchConnection. Every field degrades to a sensible
   * default so a row written by an older version of this schema never breaks
   * the caller — same convention as MasterJobRepository.hydrate().
   */
  private hydrate(item: Record<string, unknown>): TwitchConnection {
    const rawScopes = item.scopes;
    const scopes = Array.isArray(rawScopes)
      ? rawScopes.filter((s): s is string => typeof s === 'string')
      : [];
    const rawStatus = item.connectionStatus;
    const connectionStatus: TwitchConnectionStatus =
      rawStatus === 'connected' || rawStatus === 'disconnected' || rawStatus === 'revoked'
        ? rawStatus
        : 'disconnected';
    return {
      tenantId: String(item.tenantId ?? ''),
      twitchUserId: String(item.twitchUserId ?? ''),
      twitchLogin: String(item.twitchLogin ?? ''),
      displayName: String(item.displayName ?? ''),
      broadcasterId: String(item.broadcasterId ?? ''),
      profileImageUrl:
        typeof item.profileImageUrl === 'string' ? item.profileImageUrl : null,
      connectionStatus,
      scopes,
      accessTokenSsmParam: String(item.accessTokenSsmParam ?? ''),
      refreshTokenSsmParam: String(item.refreshTokenSsmParam ?? ''),
      accessTokenExpiresAt: String(item.accessTokenExpiresAt ?? ''),
      connectedAt: String(item.connectedAt ?? ''),
      updatedAt: String(item.updatedAt ?? ''),
      disconnectedAt:
        typeof item.disconnectedAt === 'string' ? item.disconnectedAt : null,
    };
  }
}
