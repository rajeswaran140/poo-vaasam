/**
 * One row per EventSub subscription we've created at Twitch, keyed by
 * (tenant, subscription type) so re-creating a subscription of the same
 * type overwrites the same row rather than accumulating orphans:
 *   PK=`TENANT#<tenantId>#TWITCH#SUBSCRIPTION#<type>`, SK=`METADATA`.
 *
 * Two callers write this:
 *   1. The admin "Enable EventSub" route after POST /helix/eventsub/subscriptions
 *      returns the Twitch-side id + status.
 *   2. The webhook route when it observes a `revocation` message — flips the
 *      status to 'revoked' so the UI + a reconcile cron can see it.
 *
 * A single tenant's active subscription set is a QUERY on the tenant prefix
 * (all rows under `TENANT#<tenantId>#TWITCH#SUBSCRIPTION#`), so no GSI is
 * needed — DynamoDB serves this directly via begins_with on SK... actually
 * a Query on the exact PK, since the PK includes the type. To list ALL
 * subscription types for a tenant, use `listAll(tenantId)` which does a
 * Query on PK begins_with — DDB doesn't allow that on PK, so this is a
 * small Scan-with-filter. Acceptable at Phase-1 volume (< 10 subscriptions
 * per tenant, one tenant).
 */

import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';
import type {
  TwitchSubscriptionRecord,
  SubscriptionType,
  SubscriptionStatus,
} from '@/types/twitch-eventsub';

const pk = (tenantId: string, type: SubscriptionType) =>
  `TENANT#${tenantId}#TWITCH#SUBSCRIPTION#${type}`;
const SK = 'METADATA';

export class TwitchSubscriptionRepository {
  async get(tenantId: string, type: SubscriptionType): Promise<TwitchSubscriptionRecord | null> {
    try {
      const item = await DynamoDBOperations.get({ PK: pk(tenantId, type), SK });
      if (!item) return null;
      return this.hydrate(item);
    } catch (err) {
      handleDynamoDBError(err);
    }
  }

  async put(record: TwitchSubscriptionRecord): Promise<void> {
    try {
      await DynamoDBOperations.put({
        PK: pk(record.tenantId, record.type),
        SK,
        Type: 'TWITCH_SUBSCRIPTION',
        ...record,
      });
    } catch (err) {
      handleDynamoDBError(err);
    }
  }

  /** Update just the lifecycle status + reason. Used by the webhook's `revocation` branch. */
  async setStatus(
    tenantId: string,
    type: SubscriptionType,
    status: SubscriptionStatus,
    reason: string | null,
    at: string
  ): Promise<void> {
    try {
      await DynamoDBOperations.update({
        key: { PK: pk(tenantId, type), SK },
        updateExpression:
          'SET #s = :s, #r = :r, updatedAt = :u',
        expressionAttributeNames: {
          '#s': 'status',
          '#r': 'reason',
        },
        expressionAttributeValues: {
          ':s': status,
          ':r': reason,
          ':u': at,
        },
        conditionExpression: 'attribute_exists(PK)',
      });
    } catch (err) {
      handleDynamoDBError(err);
    }
  }

  async delete(tenantId: string, type: SubscriptionType): Promise<void> {
    try {
      await DynamoDBOperations.delete({ PK: pk(tenantId, type), SK });
    } catch (err) {
      handleDynamoDBError(err);
    }
  }

  /**
   * Enumerate all subscription rows for a tenant (small set at Phase 1).
   * A scan with a Type filter — DDB doesn't allow begins_with on PK, and a
   * GSI feels like overkill for < 10 rows.
   */
  async listAll(tenantId: string): Promise<TwitchSubscriptionRecord[]> {
    try {
      const res = await DynamoDBOperations.scanAll({
        filterExpression: '#t = :t AND begins_with(PK, :prefix)',
        expressionAttributeNames: { '#t': 'Type' },
        expressionAttributeValues: {
          ':t': 'TWITCH_SUBSCRIPTION',
          ':prefix': `TENANT#${tenantId}#TWITCH#SUBSCRIPTION#`,
        },
      });
      return (res.Items ?? []).map((i) => this.hydrate(i));
    } catch (err) {
      handleDynamoDBError(err);
    }
  }

  private hydrate(item: Record<string, unknown>): TwitchSubscriptionRecord {
    const status = item.status;
    const validStatus: SubscriptionStatus =
      status === 'enabled' || status === 'pending' || status === 'revoked' || status === 'deleted'
        ? status
        : 'pending';
    const type = item.type;
    const validType: SubscriptionType =
      type === 'stream.online' || type === 'stream.offline' ? type : 'stream.online';
    return {
      tenantId: String(item.tenantId ?? ''),
      type: validType,
      twitchSubscriptionId: String(item.twitchSubscriptionId ?? ''),
      broadcasterUserId: String(item.broadcasterUserId ?? ''),
      status: validStatus,
      createdAt: String(item.createdAt ?? ''),
      updatedAt: String(item.updatedAt ?? ''),
      reason: typeof item.reason === 'string' ? item.reason : null,
    };
  }
}
