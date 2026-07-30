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
        savedAt: null,
        title: null,
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
      return this.hydrate(item);
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Raw DynamoDB item -> MasterJob. Shared by get() and listSaved() so the two
   * can never disagree about how an older/partial row is coerced; every field
   * added since the first jobs were written must degrade to null here.
   */
  private hydrate(item: Record<string, any>): MasterJob {
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
      beforeLra: typeof item.beforeLra === 'number' ? item.beforeLra : null,
      afterLra: typeof item.afterLra === 'number' ? item.afterLra : null,
      normalizationType:
        item.normalizationType === 'linear' || item.normalizationType === 'dynamic'
          ? item.normalizationType
          : null,
      afterLufs: typeof item.afterLufs === 'number' ? item.afterLufs : null,
      afterTp: typeof item.afterTp === 'number' ? item.afterTp : null,
      source: item.source ?? null,
      savedAt: typeof item.savedAt === 'string' ? item.savedAt : null,
      title: typeof item.title === 'string' ? item.title : null,
      error: item.error ?? null,
    };
  }

  /**
   * Save a finished master to the library: record the name and, crucially,
   * REMOVE the ttl so DynamoDB stops counting down on it. Idempotent — saving
   * twice just rewrites the title.
   */
  async save(id: string, title: string | null): Promise<void> {
    try {
      await DynamoDBOperations.update({
        key: { PK: `MASTERJOB#${id}`, SK: 'METADATA' },
        updateExpression: 'SET #savedAt = :savedAt, #title = :title REMOVE #ttl',
        expressionAttributeNames: { '#savedAt': 'savedAt', '#title': 'title', '#ttl': 'ttl' },
        expressionAttributeValues: { ':savedAt': new Date().toISOString(), ':title': title },
      });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Every saved master, newest first.
   *
   * Scan + filter rather than a GSI: the table holds a few hundred items and
   * masters accrue a handful a week, so a new index would cost more than it
   * saves. Revisit if the table grows into the tens of thousands — the same
   * trade-off the subscriber list makes.
   */
  /**
   * Rename a SAVED master. Deliberately not `save()` with a new title: save
   * re-stamps `savedAt`, so reusing it would quietly change the library's
   * "saved on" date every time a typo was fixed. This touches `title` alone.
   *
   * A condition on `savedAt` keeps the ttl invariant intact — renaming an
   * unsaved job would leave a 24h-expiring record wearing a permanent-looking
   * name, which is worse than refusing.
   */
  async rename(id: string, title: string | null): Promise<void> {
    try {
      await DynamoDBOperations.update({
        key: { PK: `MASTERJOB#${id}`, SK: 'METADATA' },
        updateExpression: 'SET #title = :title',
        conditionExpression: 'attribute_exists(savedAt) AND savedAt <> :null',
        expressionAttributeNames: { '#title': 'title' },
        expressionAttributeValues: { ':title': title, ':null': null },
      });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async listSaved(limit = 100): Promise<MasterJob[]> {
    try {
      const { Items } = await DynamoDBOperations.scanAll({
        filterExpression: 'begins_with(PK, :pk) AND attribute_exists(savedAt)',
        expressionAttributeValues: { ':pk': 'MASTERJOB#' },
      });
      return Items
        .map((item) => this.hydrate(item))
        .sort((a: MasterJob, b: MasterJob) => (b.savedAt ?? '').localeCompare(a.savedAt ?? ''))
        .slice(0, limit);
    } catch (error) {
      handleDynamoDBError(error);
    }
  }
}
