/**
 * Persistence for async compose jobs (single-table: PK=`COMPOSEJOB#<id>`,
 * SK=`METADATA`). The start route creates a `processing` job; the worker Lambda
 * updates it to `done`/`error`; the status route reads it for the polling form.
 *
 * Items carry a `ttl` (24h) so finished jobs auto-expire — enable TTL on the
 * table's `ttl` attribute to activate (harmless if not enabled; items persist).
 */

import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';
import type { ComposeJob } from '@/types/composeJob';

const TTL_SECONDS = 24 * 60 * 60;

export class ComposeJobRepository {
  /** Create a fresh job in the `processing` state. */
  async create(id: string): Promise<ComposeJob> {
    try {
      const now = new Date().toISOString();
      const job: ComposeJob = {
        id,
        status: 'processing',
        createdAt: now,
        updatedAt: now,
        result: null,
        error: null,
      };
      await DynamoDBOperations.put({
        PK: `COMPOSEJOB#${id}`,
        SK: 'METADATA',
        Type: 'COMPOSEJOB',
        ttl: Math.floor(Date.now() / 1000) + TTL_SECONDS,
        ...job,
      });
      return job;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /** Remove a job row (used to clean up an orphaned `processing` row when the
   * worker invoke fails right after create). Safe to call for a missing id. */
  async delete(id: string): Promise<void> {
    try {
      await DynamoDBOperations.delete({ PK: `COMPOSEJOB#${id}`, SK: 'METADATA' });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /** Read a job by id, or null if unknown/expired. */
  async get(id: string): Promise<ComposeJob | null> {
    try {
      const item = await DynamoDBOperations.get({ PK: `COMPOSEJOB#${id}`, SK: 'METADATA' });
      if (!item) return null;
      return {
        id: item.id,
        status: item.status,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        result: item.result ?? null,
        error: item.error ?? null,
      };
    } catch (error) {
      handleDynamoDBError(error);
    }
  }
}
