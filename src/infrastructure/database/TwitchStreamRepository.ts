/**
 * Current-stream singleton per tenant — one row (SK=`CURRENT`) that reflects
 * the tenant's live/offline state as of the last stream.online / stream.offline
 * event we ingested. The admin UI reads this without hitting Twitch, and it's
 * cheap to keep fresh because each event mutates exactly one row.
 *
 * PK=`TENANT#<tenantId>#TWITCH#STREAM`, SK=`CURRENT`.
 *
 * A historical stream log is intentionally NOT a separate row here — every
 * event that produced a change is already in TwitchEventRepository's raw log.
 * Reconstructing a stream history is a query over the event log, not a
 * denormalised second store to keep in sync.
 */

import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';
import type { TwitchStreamRecord } from '@/types/twitch-eventsub';

const pk = (tenantId: string) => `TENANT#${tenantId}#TWITCH#STREAM`;
const SK = 'CURRENT';

export class TwitchStreamRepository {
  async get(tenantId: string): Promise<TwitchStreamRecord | null> {
    try {
      const item = await DynamoDBOperations.get({ PK: pk(tenantId), SK });
      if (!item) return null;
      return this.hydrate(item);
    } catch (err) {
      handleDynamoDBError(err);
    }
  }

  /**
   * Upsert. The webhook writes this synchronously from stream.online and
   * stream.offline events; the shape carries `updatedByMessageId` so a
   * later "which event set this?" trace never needs the log.
   */
  async put(record: TwitchStreamRecord): Promise<void> {
    try {
      await DynamoDBOperations.put({
        PK: pk(record.tenantId),
        SK,
        Type: 'TWITCH_STREAM',
        ...record,
      });
    } catch (err) {
      handleDynamoDBError(err);
    }
  }

  private hydrate(item: Record<string, unknown>): TwitchStreamRecord {
    return {
      tenantId: String(item.tenantId ?? ''),
      isLive: item.isLive === true,
      streamId: typeof item.streamId === 'string' ? item.streamId : null,
      broadcasterUserId:
        typeof item.broadcasterUserId === 'string' ? item.broadcasterUserId : null,
      broadcasterUserLogin:
        typeof item.broadcasterUserLogin === 'string' ? item.broadcasterUserLogin : null,
      categoryId: typeof item.categoryId === 'string' ? item.categoryId : null,
      categoryName: typeof item.categoryName === 'string' ? item.categoryName : null,
      title: typeof item.title === 'string' ? item.title : null,
      startedAt: typeof item.startedAt === 'string' ? item.startedAt : null,
      updatedAt: String(item.updatedAt ?? ''),
      updatedByMessageId:
        typeof item.updatedByMessageId === 'string' ? item.updatedByMessageId : null,
    };
  }
}
