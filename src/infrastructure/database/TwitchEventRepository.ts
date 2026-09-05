/**
 * Append-only log of Twitch EventSub notifications, deduplicated by the
 * `Twitch-Eventsub-Message-Id` header (single-table:
 * PK=`TENANT#<tenantId>#TWITCH#EVENT#<messageId>`, SK=`METADATA`).
 *
 * `putIfAbsent` is the idempotency primitive — Twitch retries a webhook
 * response that timed out, and our webhook processes each retry the same
 * way as the first delivery. Returning `false` on a repeat write is how the
 * webhook route detects "already seen this one" without a separate read.
 *
 * TTL: 90 days. Long enough to reconcile any Phase-3 analytics backfill; not
 * so long that raw event bodies accumulate indefinitely in a shared table.
 */

import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';
import type { TwitchEventRecord } from '@/types/twitch-eventsub';

const TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

const pk = (tenantId: string, messageId: string) =>
  `TENANT#${tenantId}#TWITCH#EVENT#${messageId}`;
const SK = 'METADATA';

export class TwitchEventRepository {
  /**
   * Try to persist a fresh event. Returns `true` on first write, `false`
   * when the message-id is already stored (a Twitch retry). The
   * conditional PUT is the ONLY way to make dedupe race-free — a
   * read-then-write would let two concurrent webhook invocations both
   * see "not there" and both write.
   */
  async putIfAbsent(record: TwitchEventRecord): Promise<boolean> {
    try {
      await DynamoDBOperations.transactWrite([
        {
          Put: {
            Item: {
              PK: pk(record.tenantId, record.messageId),
              SK,
              Type: 'TWITCH_EVENT',
              ttl: Math.floor(Date.now() / 1000) + TTL_SECONDS,
              ...record,
            },
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
      ]);
      return true;
    } catch (err) {
      // TransactionCanceledException with a ConditionalCheckFailed reason
      // is the "already exists" case — expected, not an error condition.
      if (
        err instanceof Error &&
        (err.name === 'TransactionCanceledException' ||
          err.name === 'ConditionalCheckFailedException')
      ) {
        return false;
      }
      handleDynamoDBError(err);
    }
  }

  /** Read a single event by message-id, or null if unknown/expired. */
  async get(tenantId: string, messageId: string): Promise<TwitchEventRecord | null> {
    try {
      const item = await DynamoDBOperations.get({ PK: pk(tenantId, messageId), SK });
      if (!item) return null;
      return this.hydrate(item);
    } catch (err) {
      handleDynamoDBError(err);
    }
  }

  /**
   * Mark an event as processed (or record its failure). Idempotent —
   * running it twice yields the same terminal state.
   */
  async markProcessed(
    tenantId: string,
    messageId: string,
    at: string,
    error: string | null = null
  ): Promise<void> {
    try {
      await DynamoDBOperations.update({
        key: { PK: pk(tenantId, messageId), SK },
        updateExpression: 'SET processedAt = :p, processingError = :e',
        expressionAttributeValues: {
          ':p': at,
          ':e': error,
        },
        conditionExpression: 'attribute_exists(PK)',
      });
    } catch (err) {
      handleDynamoDBError(err);
    }
  }

  private hydrate(item: Record<string, unknown>): TwitchEventRecord {
    return {
      tenantId: String(item.tenantId ?? ''),
      messageId: String(item.messageId ?? ''),
      messageTimestamp: String(item.messageTimestamp ?? ''),
      messageType: String(item.messageType ?? ''),
      subscriptionType: String(item.subscriptionType ?? ''),
      subscriptionId: String(item.subscriptionId ?? ''),
      payload:
        item.payload && typeof item.payload === 'object'
          ? (item.payload as Record<string, unknown>)
          : {},
      receivedAt: String(item.receivedAt ?? ''),
      processedAt: typeof item.processedAt === 'string' ? item.processedAt : null,
      processingError:
        typeof item.processingError === 'string' ? item.processingError : null,
    };
  }
}
