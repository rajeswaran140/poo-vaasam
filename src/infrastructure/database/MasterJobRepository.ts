/**
 * Persistence for async mastering jobs (single-table: PK=`MASTERJOB#<id>`,
 * SK=`METADATA`). The master route creates a `processing` job; the master-worker
 * Lambda updates it to `done`/`error`; the status route reads it. Mirrors
 * CriticJobRepository. Items carry a 24h ttl so finished jobs auto-expire.
 */

import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';
import type { MasterJob } from '@/types/masterJob';
import { parseMasterEdit, isNoOpEdit, type MasterEdit } from '@/lib/master-edit';
import { parseMasterJoin, type MasterJoin } from '@/lib/master-join';

const TTL_SECONDS = 24 * 60 * 60;

export class MasterJobRepository {
  /** Create a fresh job in the `processing` state. */
  async create(
    id: string,
    input: { s3Key: string; target: number; edit?: MasterEdit | null; join?: MasterJoin | null }
  ): Promise<MasterJob> {
    try {
      const now = new Date().toISOString();
      const job: MasterJob = {
        id,
        status: 'processing',
        createdAt: now,
        updatedAt: now,
        s3Key: input.s3Key,
        target: input.target,
        edit: input.edit ?? null,
        join: input.join ?? null,
        editedDurationSec: null,
        mp3Key: null,
        mp3Lufs: null,
        mp3Tp: null,
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
        archivedAt: null,
        archiveKey: null,
        archiveError: null,
        publishedAt: null,
        publishKey: null,
        publishError: null,
        videoKey: null,
        videoRenderedAt: null,
        videoError: null,
        coverKey: null,
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
    // The stored edit is re-validated rather than trusted: a row written by an
    // older worker, or hand-patched, must not hand a malformed MasterEdit to
    // the filter builder. Anything unparseable degrades to "no edit", which is
    // exactly how a pre-editing job behaves.
    const parsedEdit = parseMasterEdit(item.edit ?? undefined);
    const edit = parsedEdit.ok && !isNoOpEdit(parsedEdit.edit) ? parsedEdit.edit : null;

    // Re-validated for the same reason as the edit: a row written by an older
    // worker, or hand-patched, must not hand a malformed join to the filter
    // builder. Anything unparseable degrades to "no join" — a single-source
    // master, which is how every pre-join row behaves.
    const parsedJoin = parseMasterJoin(item.join ?? undefined);

    return {
      id: item.id,
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      s3Key: item.s3Key,
      target: typeof item.target === 'number' ? item.target : -14,
      edit,
      join: parsedJoin.ok ? parsedJoin.join : null,
      editedDurationSec:
        typeof item.editedDurationSec === 'number' ? item.editedDurationSec : null,
      mp3Key: typeof item.mp3Key === 'string' ? item.mp3Key : null,
      mp3Lufs: typeof item.mp3Lufs === 'number' ? item.mp3Lufs : null,
      mp3Tp: typeof item.mp3Tp === 'number' ? item.mp3Tp : null,
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
      archivedAt: typeof item.archivedAt === 'string' ? item.archivedAt : null,
      archiveKey: typeof item.archiveKey === 'string' ? item.archiveKey : null,
      archiveError: typeof item.archiveError === 'string' ? item.archiveError : null,
      publishedAt: typeof item.publishedAt === 'string' ? item.publishedAt : null,
      publishKey: typeof item.publishKey === 'string' ? item.publishKey : null,
      publishError: typeof item.publishError === 'string' ? item.publishError : null,
      videoKey: typeof item.videoKey === 'string' ? item.videoKey : null,
      videoRenderedAt: typeof item.videoRenderedAt === 'string' ? item.videoRenderedAt : null,
      videoError: typeof item.videoError === 'string' ? item.videoError : null,
      coverKey: typeof item.coverKey === 'string' ? item.coverKey : null,
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

  /**
   * Record the outcome of a source archive. Success and failure are BOTH
   * written: a silent failure would leave the operator believing the source is
   * safe in Glacier when it is not, which is worse than no archiving at all.
   *
   * No ttl clause — archiving only ever runs after save(), which has already
   * removed it.
   */
  async recordArchive(
    id: string,
    result: { archiveKey: string; archivedAt: string } | { archiveError: string }
  ): Promise<void> {
    try {
      const ok = 'archiveKey' in result;
      await DynamoDBOperations.update({
        key: { PK: `MASTERJOB#${id}`, SK: 'METADATA' },
        updateExpression:
          'SET #archivedAt = :archivedAt, #archiveKey = :archiveKey, #archiveError = :archiveError',
        expressionAttributeNames: {
          '#archivedAt': 'archivedAt',
          '#archiveKey': 'archiveKey',
          '#archiveError': 'archiveError',
        },
        expressionAttributeValues: {
          ':archivedAt': ok ? result.archivedAt : null,
          ':archiveKey': ok ? result.archiveKey : null,
          ':archiveError': ok ? null : result.archiveError,
        },
      });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Record the outcome of publishing the web MP3 to the site's audio prefix.
   *
   * Mirrors recordArchive, including writing failures: an operator who pressed
   * Publish and saw it fail should find that on the record, not only in a log.
   *
   * No ttl clause — publishing only ever runs on a saved job, where save() has
   * already removed it.
   */
  async recordPublish(
    id: string,
    result: { publishKey: string; publishedAt: string } | { publishError: string }
  ): Promise<void> {
    try {
      const ok = 'publishKey' in result;
      await DynamoDBOperations.update({
        key: { PK: `MASTERJOB#${id}`, SK: 'METADATA' },
        updateExpression:
          'SET #publishedAt = :publishedAt, #publishKey = :publishKey, #publishError = :publishError',
        expressionAttributeNames: {
          '#publishedAt': 'publishedAt',
          '#publishKey': 'publishKey',
          '#publishError': 'publishError',
        },
        expressionAttributeValues: {
          ':publishedAt': ok ? result.publishedAt : null,
          ':publishKey': ok ? result.publishKey : null,
          ':publishError': ok ? null : result.publishError,
        },
      });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Mark a job whose worker died without reporting. Conditional on the status
   * STILL being `processing`, so a worker that finishes in the same moment the
   * status route decides it is dead cannot be overwritten with a failure — the
   * real result wins.
   */
  async markStuck(id: string, error: { code: string; message: string }): Promise<void> {
    try {
      await DynamoDBOperations.update({
        key: { PK: `MASTERJOB#${id}`, SK: 'METADATA' },
        updateExpression: 'SET #status = :error, #err = :err, #updatedAt = :now',
        conditionExpression: '#status = :processing',
        expressionAttributeNames: { '#status': 'status', '#err': 'error', '#updatedAt': 'updatedAt' },
        expressionAttributeValues: {
          ':error': 'error',
          ':processing': 'processing',
          ':err': error,
          ':now': new Date().toISOString(),
        },
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
