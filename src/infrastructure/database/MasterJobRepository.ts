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

/**
 * The sparse GSI1 partition holding SAVED masters only. Written by `save()`; an
 * unsaved job never carries it, so the index contains exactly the rows the
 * library shows and needs no filter.
 */
const SAVED_INDEX_PK = 'MASTERJOB_SAVED';

/** `<savedAt>#<id>` — ISO timestamps sort lexicographically; the id breaks ties. */
const savedIndexSk = (savedAt: string, id: string) => `${savedAt}#${id}`;

/** DynamoDB's LastEvaluatedKey, base64url'd so it can ride in a query string. */
function encodeCursor(key: Record<string, unknown> | undefined): string | null {
  return key ? Buffer.from(JSON.stringify(key), 'utf8').toString('base64url') : null;
}

function decodeCursor(cursor?: string): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    // A malformed cursor restarts at page one rather than 500ing — a stale
    // bookmark should show the library, not an error.
    return undefined;
  }
}

/**
 * The Python matchering-worker writes matchingStats/matchingError as JSON
 * strings (DynamoDB attribute type S) because its patch helper types values
 * as strings. Hydrate them back to objects here; anything unparseable degrades
 * to null so a corrupt row still renders the rest of the job.
 */
function safeParseStats(s: string): MasterJob['matchingStats'] {
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === 'object' ? (parsed as MasterJob['matchingStats']) : null;
  } catch {
    return null;
  }
}
function safeParseError(s: string): MasterJob['matchingError'] {
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === 'object' && typeof parsed.code === 'string' && typeof parsed.message === 'string'
      ? { code: parsed.code, message: parsed.message }
      : null;
  } catch {
    return null;
  }
}

export class MasterJobRepository {
  /** Create a fresh job in the `processing` state. */
  async create(
    id: string,
    input: {
      s3Key: string;
      target: number;
      edit?: MasterEdit | null;
      join?: MasterJoin | null;
      /** Reference-matching (Phase 1B). Absent → loudnorm-only, matched fields stay null. */
      referenceId?: string | null;
      referenceKey?: string | null;
      matchingMethod?: MasterJob['matchingMethod'];
    }
  ): Promise<MasterJob> {
    try {
      const now = new Date().toISOString();
      const wantsMatching =
        !!input.referenceKey &&
        (input.matchingMethod === 'matched' || input.matchingMethod === 'both');
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
        referenceId: input.referenceId ?? null,
        matchingMethod: input.matchingMethod ?? null,
        matchedMasterKey: null,
        // 'queued' only when we know the Python worker will be invoked; otherwise
        // null so the UI shows nothing for the matching column.
        matchingStage: wantsMatching ? 'queued' : null,
        matchingStats: null,
        matchingError: null,
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
      // Reference-matching fields (Phase 1B). All degrade to null for pre-feature rows.
      referenceId: typeof item.referenceId === 'string' ? item.referenceId : null,
      matchingMethod:
        item.matchingMethod === 'loudnorm' ||
        item.matchingMethod === 'matched' ||
        item.matchingMethod === 'both'
          ? item.matchingMethod
          : null,
      matchedMasterKey:
        typeof item.matchedMasterKey === 'string' ? item.matchedMasterKey : null,
      matchingStage: (() => {
        const s = item.matchingStage;
        const allowed = new Set([
          'queued', 'downloading', 'analyzing', 'matching',
          'normalizing', 'writing', 'uploading', 'completed', 'failed',
        ]);
        return typeof s === 'string' && allowed.has(s) ? (s as MasterJob['matchingStage']) : null;
      })(),
      matchingStats: item.matchingStats && typeof item.matchingStats === 'object'
        ? (item.matchingStats as MasterJob['matchingStats'])
        : (typeof item.matchingStats === 'string' ? safeParseStats(item.matchingStats) : null),
      matchingError: item.matchingError && typeof item.matchingError === 'object'
        ? (item.matchingError as MasterJob['matchingError'])
        : (typeof item.matchingError === 'string' ? safeParseError(item.matchingError) : null),
    };
  }

  /**
   * Save a finished master to the library: record the name and, crucially,
   * REMOVE the ttl so DynamoDB stops counting down on it. Idempotent — saving
   * twice just rewrites the title.
   */
  async save(id: string, title: string | null): Promise<void> {
    try {
      const savedAt = new Date().toISOString();
      await DynamoDBOperations.update({
        key: { PK: `MASTERJOB#${id}`, SK: 'METADATA' },
        updateExpression:
          'SET #savedAt = :savedAt, #title = :title, GSI1PK = :gpk, GSI1SK = :gsk REMOVE #ttl',
        expressionAttributeNames: { '#savedAt': 'savedAt', '#title': 'title', '#ttl': 'ttl' },
        expressionAttributeValues: {
          ':savedAt': savedAt,
          ':title': title,
          ':gpk': SAVED_INDEX_PK,
          ':gsk': savedIndexSk(savedAt, id),
        },
      });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

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

  /**
   * A page of saved masters, newest first.
   *
   * ⚠️ THIS WAS A FULL TABLE SCAN, and its cost had nothing to do with how many
   * masters existed. `TamilWebContent` is a single table: on 2026-08-16 it held
   * 6,170 items of which 40 were saved masters, so opening the library read
   * 6,170 items, filtered 6,130 away, then sorted and sliced in memory. Every
   * lexicon word and composition made the MASTERING page slower — not a
   * relationship anyone would choose. (The old comment allowed for this,
   * saying "revisit if the table grows into the tens of thousands"; at 6,170
   * with a visibly slow page, that revisit had arrived.)
   *
   * Now a query on a SPARSE GSI1 partition. `GSI1PK` is written only when a
   * master is SAVED, so unsaved jobs — which expire by ttl — never enter the
   * index and no filter is needed to exclude them. `GSI1SK` is
   * `<savedAt>#<id>` read backwards, so newest-first comes from the index
   * rather than from sorting in memory.
   */
  async listSavedPage(
    limit = 25,
    cursor?: string
  ): Promise<{ masters: MasterJob[]; nextCursor: string | null }> {
    try {
      const res = await DynamoDBOperations.query({
        keyConditionExpression: 'GSI1PK = :pk',
        expressionAttributeValues: { ':pk': SAVED_INDEX_PK },
        indexName: 'GSI1',
        scanIndexForward: false,
        limit,
        exclusiveStartKey: decodeCursor(cursor),
      });
      const masters = ((res.Items as Record<string, unknown>[]) || []).map((i) => this.hydrate(i));
      return {
        masters,
        nextCursor: encodeCursor(res.LastEvaluatedKey as Record<string, unknown> | undefined),
      };
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * The whole library, newest first — for the callers that genuinely need every
   * row (grouping by song across all masters). Pages through the same index
   * instead of scanning.
   */
  async listSaved(limit = 100): Promise<MasterJob[]> {
    const out: MasterJob[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.listSavedPage(Math.min(100, limit - out.length), cursor);
      out.push(...page.masters);
      cursor = page.nextCursor ?? undefined;
    } while (cursor && out.length < limit);
    return out.slice(0, limit);
  }
}
