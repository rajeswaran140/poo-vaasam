/**
 * Persistence for async mastering jobs (single-table: PK=`MASTERJOB#<id>`,
 * SK=`METADATA`). The master route creates a `processing` job; the master-worker
 * Lambda updates it to `done`/`error`; the status route reads it. Mirrors
 * CriticJobRepository. Items carry a 24h ttl so finished jobs auto-expire.
 */

import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';
import type { MasterJob } from '@/types/masterJob';

const TTL_SECONDS = 24 * 60 * 60;

export class MasterJobRepository {
  /** Create a fresh job in the `processing` state. */
  async create(id: string, input: { s3Key: string; target: number }): Promise<MasterJob> {
    try {
      const now = new Date().toISOString();
      const job: MasterJob = {
        id,
        status: 'processing',
        createdAt: now,
        updatedAt: now,
        s3Key: input.s3Key,
        target: input.target,
        masterKey: null,
        beforeLufs: null,
        beforeTp: null,
        afterLufs: null,
        afterTp: null,
        beforeLra: null,
        afterLra: null,
        normalizationType: null,
        source: null,
        error: null,
      };
      await DynamoDBOperations.put({
        PK: `MASTERJOB#${id}`,
        SK: 'METADATA',
        Type: 'MASTERJOB',
        ttl: Math.floor(Date.now() / 1000) + TTL_SECONDS,
        ...job,
      });
      return job;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /** Read a job by id, or null if unknown/expired. */
  async get(id: string): Promise<MasterJob | null> {
    try {
      const item = await DynamoDBOperations.get({ PK: `MASTERJOB#${id}`, SK: 'METADATA' });
      if (!item) return null;
      return {
        id: item.id,
        status: item.status,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        s3Key: item.s3Key,
        target: typeof item.target === 'number' ? item.target : -14,
        masterKey: item.masterKey ?? null,
        beforeLufs: typeof item.beforeLufs === 'number' ? item.beforeLufs : null,
        beforeTp: typeof item.beforeTp === 'number' ? item.beforeTp : null,
        // Absent on jobs written before LRA capture — coerced to null so every
        // consumer takes the "not recorded" branch rather than reading NaN.
        beforeLra: typeof item.beforeLra === 'number' ? item.beforeLra : null,
        afterLra: typeof item.afterLra === 'number' ? item.afterLra : null,
        normalizationType:
          item.normalizationType === 'linear' || item.normalizationType === 'dynamic'
            ? item.normalizationType
            : null,
        afterLufs: typeof item.afterLufs === 'number' ? item.afterLufs : null,
        afterTp: typeof item.afterTp === 'number' ? item.afterTp : null,
        // Absent on jobs written before the worker recorded it — null, not undefined,
        // so the shape stays stable for the status route's consumers.
        source: item.source ?? null,
        error: item.error ?? null,
      };
    } catch (error) {
      handleDynamoDBError(error);
    }
  }
}
