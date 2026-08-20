/**
 * Raw Twitch EventSub message persistence.
 *
 *   PK = TWITCHEVENT#<messageId>, SK = METADATA
 *   GSI1PK = TWITCHEVENT#<tenantId>, GSI1SK = <receivedAt>
 *
 * Two things this shape buys us:
 *
 * 1. IDEMPOTENCY FOR FREE. Twitch delivers every notification *at least* once
 *    and explicitly warns you may receive it twice. Because the message id is
 *    the partition key, a conditional put IS the duplicate check — first writer
 *    wins, no separate dedupe table, no read-then-write race between two
 *    concurrent SSR instances handling a retry.
 *
 * 2. AN ANALYTICS SPINE. GSI1 gives a recency-ordered feed per tenant, which is
 *    what "which songs generate the most engagement / follows / cheers" will be
 *    computed from once song-play spans exist. Keeping the raw payload means a
 *    question we have not thought of yet is still answerable from history.
 *
 * Rows carry a DynamoDB TTL (`expiresAt`) so raw payloads expire on their own —
 * we keep the derived, useful shapes (sessions) indefinitely, not the firehose.
 */

import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';
import type { TwitchEventRecord } from '@/types/twitch';

const eventPk = (messageId: string) => `TWITCHEVENT#${messageId}`;
const META_SK = 'METADATA';

/** How long raw event payloads are retained before DynamoDB expires them. */
export const RAW_EVENT_TTL_DAYS = 90;

export class TwitchEventRepository {
  /**
   * Record an inbound event.
   *
   * @returns true if this is the first time we've seen the message id, false if
   *          it is a duplicate delivery that must NOT be processed again.
   */
  async recordIfNew(event: TwitchEventRecord): Promise<boolean> {
    try {
      return await DynamoDBOperations.putIfNotExists({
        PK: eventPk(event.messageId),
        SK: META_SK,
        entityType: 'TWITCH_EVENT',
        GSI1PK: `TWITCHEVENT#${event.tenantId}`,
        GSI1SK: event.receivedAt,
        ...event,
      });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /** Most recent events for a tenant, newest first — powers "Last Event". */
  async listRecent(tenantId: string, limit = 10): Promise<TwitchEventRecord[]> {
    try {
      const res = await DynamoDBOperations.query({
        keyConditionExpression: 'GSI1PK = :pk',
        expressionAttributeValues: { ':pk': `TWITCHEVENT#${tenantId}` },
        indexName: 'GSI1',
        scanIndexForward: false,
        limit,
      });
      return ((res.Items as Record<string, unknown>[]) || []).map(
        (i) => i as unknown as TwitchEventRecord
      );
    } catch (error) {
      handleDynamoDBError(error);
    }
  }
}

/** Unix-seconds TTL value for a raw event received now. */
export function rawEventExpiry(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 1000) + RAW_EVENT_TTL_DAYS * 24 * 60 * 60;
}
