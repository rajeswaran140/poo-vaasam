/**
 * Persistence for async SUNO-setup jobs (single-table: PK=`SUNOJOB#<id>`,
 * SK=`METADATA`). The setup route creates a `processing` job; the shared worker
 * Lambda updates it to `done`/`error`; the status route reads it for the polling
 * panel. Mirrors CriticJobRepository.
 *
 * Items carry a `ttl` (24h) so finished jobs auto-expire — enable TTL on the
 * table's `ttl` attribute to activate (harmless if not enabled; items persist).
 */

import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';
import type { SunoSetupJob } from '@/types/sunoSetupJob';

const TTL_SECONDS = 24 * 60 * 60;

export class SunoSetupJobRepository {
  /** Create a fresh job in the `processing` state. */
  async create(id: string): Promise<SunoSetupJob> {
    try {
      const now = new Date().toISOString();
      const job: SunoSetupJob = {
        id,
        status: 'processing',
        createdAt: now,
        updatedAt: now,
        result: null,
        error: null,
      };
      await DynamoDBOperations.put({
        PK: `SUNOJOB#${id}`,
        SK: 'METADATA',
        Type: 'SUNOJOB',
        ttl: Math.floor(Date.now() / 1000) + TTL_SECONDS,
        ...job,
      });
      return job;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Remove a job row. Used to clean up an orphaned `processing` row when the
   * worker invoke fails right after create — otherwise the panel polls a job
   * nothing will ever finish, and the user waits out the full timeout for an
   * error that was already known.
   */
  async delete(id: string): Promise<void> {
    try {
      await DynamoDBOperations.delete({ PK: `SUNOJOB#${id}`, SK: 'METADATA' });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /** Read a job by id, or null if unknown/expired. */
  async get(id: string): Promise<SunoSetupJob | null> {
    try {
      const item = await DynamoDBOperations.get({ PK: `SUNOJOB#${id}`, SK: 'METADATA' });
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
