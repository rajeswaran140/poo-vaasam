/**
 * Persistence for cached AI YouTube recommendations (one record per channel:
 * PK=`YTRECS#<channelId>` / SK=`METADATA`). The admin "Refresh" action
 * regenerates + saves; the dashboard and the analytics route read the cache so
 * the LLM never runs inside a page/API render.
 */

import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';
import type { CachedYtRecs } from '@/types/ytRecs';

export class YtRecsRepository {
  /** Overwrite the cached recommendations for a channel. */
  async save(channelId: string, recs: CachedYtRecs): Promise<void> {
    try {
      await DynamoDBOperations.put({
        PK: `YTRECS#${channelId}`,
        SK: 'METADATA',
        Type: 'YTRECS',
        ...recs,
      });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /** Read the cached recommendations, or null if none generated yet. */
  async get(channelId: string): Promise<CachedYtRecs | null> {
    try {
      const item = await DynamoDBOperations.get({ PK: `YTRECS#${channelId}`, SK: 'METADATA' });
      if (!item) return null;
      return {
        recommendations: Array.isArray(item.recommendations) ? item.recommendations : [],
        generatedAt: item.generatedAt,
        days: item.days ?? 28,
      };
    } catch (error) {
      handleDynamoDBError(error);
    }
  }
}
