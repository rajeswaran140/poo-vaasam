/**
 * DynamoDB persistence for the Twitch integration. Single-table, following the
 * existing conventions (see LyricDraftRepository for the canonical example):
 *
 *   PK = TWITCHCONN#<tenantId>, SK = METADATA          → the public connection
 *   PK = TWITCHCONN#<tenantId>, SK = SECRET            → tokens ONLY
 *   PK = TWITCHCONN#<tenantId>, SK = SUB#<subId>       → an EventSub subscription
 *   PK = TWITCHSTREAM#<tenantId>, SK = SESSION#<startedAt>#<streamId>
 *
 * ⚠️ Tokens are a SEPARATE ITEM on purpose. Every read that exists to display
 * something (`get`, the admin status route) touches only SK=METADATA, so access
 * and refresh tokens are never loaded into memory, never serialised into a
 * response, and cannot be leaked by a careless `JSON.stringify(connection)`.
 *
 * The metadata item carries GSI1PK='TWITCHCONN' + GSI1SK=<updatedAt> so that a
 * future multi-tenant build can list all connections by recency without a
 * table scan — reusing the shared GSI1 exactly like the other repositories.
 */

import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';
import type {
  TwitchConnection,
  TwitchConnectionSecrets,
  TwitchConnectionStatus,
  TwitchEventSubSubscription,
  TwitchStreamSession,
  TwitchSubscriptionStatus,
} from '@/types/twitch';

const connPk = (tenantId: string) => `TWITCHCONN#${tenantId}`;
const streamPk = (tenantId: string) => `TWITCHSTREAM#${tenantId}`;
const META_SK = 'METADATA';
const SECRET_SK = 'SECRET';
const subSk = (subscriptionId: string) => `SUB#${subscriptionId}`;
/** startedAt first so lexicographic SK order is chronological. */
const sessionSk = (startedAt: string, streamId?: string) =>
  `SESSION#${startedAt}#${streamId ?? 'unknown'}`;

export class TwitchConnectionRepository {
  // ---- Connection (public half) -------------------------------------------

  async get(tenantId: string): Promise<TwitchConnection | null> {
    try {
      const item = await DynamoDBOperations.get({ PK: connPk(tenantId), SK: META_SK });
      return item ? this.toConnection(item) : null;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async upsert(connection: TwitchConnection): Promise<void> {
    try {
      await DynamoDBOperations.put({
        PK: connPk(connection.tenantId),
        SK: META_SK,
        entityType: 'TWITCH_CONNECTION',
        GSI1PK: 'TWITCHCONN',
        GSI1SK: connection.updatedAt,
        ...connection,
      });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /** Narrow status update — used by refresh/revocation paths. */
  async setStatus(
    tenantId: string,
    status: TwitchConnectionStatus,
    lastError?: string
  ): Promise<void> {
    try {
      const now = new Date().toISOString();
      await DynamoDBOperations.update({
        key: { PK: connPk(tenantId), SK: META_SK },
        updateExpression:
          'SET #status = :status, updatedAt = :now, GSI1SK = :now, lastError = :err',
        expressionAttributeNames: { '#status': 'status' },
        expressionAttributeValues: {
          ':status': status,
          ':now': now,
          ':err': lastError ?? null,
        },
      });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  // ---- Secrets (never returned to any caller that renders) -----------------

  async getSecrets(tenantId: string): Promise<TwitchConnectionSecrets | null> {
    try {
      const item = await DynamoDBOperations.get({ PK: connPk(tenantId), SK: SECRET_SK });
      if (!item) return null;
      return {
        tenantId: item.tenantId,
        accessToken: item.accessToken,
        refreshToken: item.refreshToken,
        accessTokenExpiresAt: item.accessTokenExpiresAt,
        updatedAt: item.updatedAt,
      };
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async putSecrets(secrets: TwitchConnectionSecrets): Promise<void> {
    try {
      await DynamoDBOperations.put({
        PK: connPk(secrets.tenantId),
        SK: SECRET_SK,
        entityType: 'TWITCH_CONNECTION_SECRET',
        ...secrets,
      });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async deleteSecrets(tenantId: string): Promise<void> {
    try {
      await DynamoDBOperations.delete({ PK: connPk(tenantId), SK: SECRET_SK });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  // ---- EventSub subscriptions ---------------------------------------------

  async listSubscriptions(tenantId: string): Promise<TwitchEventSubSubscription[]> {
    try {
      const res = await DynamoDBOperations.query({
        keyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        expressionAttributeValues: { ':pk': connPk(tenantId), ':sk': 'SUB#' },
      });
      return ((res.Items as Record<string, unknown>[]) || []).map((i) => ({
        tenantId: i.tenantId as string,
        subscriptionId: i.subscriptionId as string,
        type: i.type as string,
        version: i.version as string,
        status: i.status as TwitchSubscriptionStatus,
        createdAt: i.createdAt as string,
        updatedAt: i.updatedAt as string,
      }));
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async putSubscription(sub: TwitchEventSubSubscription): Promise<void> {
    try {
      await DynamoDBOperations.put({
        PK: connPk(sub.tenantId),
        SK: subSk(sub.subscriptionId),
        entityType: 'TWITCH_EVENTSUB_SUBSCRIPTION',
        ...sub,
      });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async deleteSubscription(tenantId: string, subscriptionId: string): Promise<void> {
    try {
      await DynamoDBOperations.delete({
        PK: connPk(tenantId),
        SK: subSk(subscriptionId),
      });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Mark a subscription revoked rather than deleting it, so the admin panel can
   * explain WHY events stopped instead of simply showing nothing.
   */
  async markSubscriptionStatus(
    tenantId: string,
    subscriptionId: string,
    status: TwitchSubscriptionStatus
  ): Promise<void> {
    try {
      await DynamoDBOperations.update({
        key: { PK: connPk(tenantId), SK: subSk(subscriptionId) },
        updateExpression: 'SET #status = :status, updatedAt = :now',
        expressionAttributeNames: { '#status': 'status' },
        expressionAttributeValues: {
          ':status': status,
          ':now': new Date().toISOString(),
        },
      });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  // ---- Stream sessions ----------------------------------------------------

  /**
   * The most recent session, open or closed. Queried newest-first off the
   * session partition — this is what tells the UI "LIVE" vs "Offline".
   */
  async latestSession(tenantId: string): Promise<TwitchStreamSession | null> {
    try {
      const res = await DynamoDBOperations.query({
        keyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        expressionAttributeValues: { ':pk': streamPk(tenantId), ':sk': 'SESSION#' },
        scanIndexForward: false,
        limit: 1,
      });
      const item = (res.Items as Record<string, unknown>[] | undefined)?.[0];
      return item ? (item as unknown as TwitchStreamSession) : null;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async putSession(session: TwitchStreamSession): Promise<void> {
    try {
      await DynamoDBOperations.put({
        PK: streamPk(session.tenantId),
        SK: sessionSk(session.startedAt, session.streamId),
        entityType: 'TWITCH_STREAM_SESSION',
        ...session,
      });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  // ---- Mapping ------------------------------------------------------------

  private toConnection(item: Record<string, unknown>): TwitchConnection {
    return {
      tenantId: item.tenantId as string,
      twitchUserId: item.twitchUserId as string,
      twitchLogin: item.twitchLogin as string,
      displayName: item.displayName as string,
      broadcasterId: item.broadcasterId as string,
      profileImageUrl: (item.profileImageUrl as string | undefined) ?? undefined,
      status: item.status as TwitchConnectionStatus,
      scopes: (item.scopes as string[] | undefined) ?? [],
      connectedAt: item.connectedAt as string,
      updatedAt: item.updatedAt as string,
      lastError: (item.lastError as string | null | undefined) ?? undefined,
    };
  }
}
