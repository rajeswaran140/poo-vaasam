/**
 * Persistence for Video Text projects (single-table: PK=`VIDEOTEXT#<id>`,
 * SK=`METADATA`). Holds a project's text, timings, uploaded source info and
 * render state. Used by the admin API routes and the video-text worker.
 *
 * Every project carries GSI1PK='VIDEOTEXT' / GSI1SK=updatedAt, so the project
 * list is one newest-first query on GSI1 rather than a table scan.
 *
 * `render` is stored as a MAP attribute so the render conditions and patches
 * address nested paths (`#render.#status`) instead of rewriting the whole map.
 */

import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';
import { isValidProjectId } from '@/lib/video-text/keys';
import type {
  RenderState,
  SourceInfo,
  TextBlock,
  VideoTextProject,
} from '@/types/videoText';

/** A render whose last write is older than this is treated as dead and may be restarted. */
export const RENDER_STALE_MS = 20 * 60 * 1000;

const INDEX_PK = 'VIDEOTEXT';
const MAX_NAME_LENGTH = 120;

const keyOf = (id: string) => {
  if (!isValidProjectId(id)) throw new Error('invalid video text project id');
  return { PK: `VIDEOTEXT#${id}`, SK: 'METADATA' };
};

const idleRender = (): RenderState => ({
  renderId: null,
  status: 'idle',
  progress: null,
  outputKey: null,
  outputExpiresAt: null,
  error: null,
  startedAt: null,
  updatedAt: null,
});

const isConditionFailure = (error: unknown) =>
  (error as { name?: string })?.name === 'ConditionalCheckFailedException';

function hydrate(item: Record<string, unknown>): VideoTextProject {
  const { PK: _pk, SK: _sk, GSI1PK: _gpk, GSI1SK: _gsk, ...project } = item;
  return project as unknown as VideoTextProject;
}

export class VideoTextRepository {
  async create(name: string): Promise<VideoTextProject> {
    const trimmed = (name ?? '').trim();
    if (trimmed.length < 1 || trimmed.length > MAX_NAME_LENGTH) {
      throw new Error(`name must be 1-${MAX_NAME_LENGTH} characters`);
    }
    const now = new Date().toISOString();
    const project: VideoTextProject = {
      id: crypto.randomUUID(),
      name: trimmed,
      titleText: '',
      creditsText: '',
      lyricsText: '',
      blocks: [],
      style: { sizeScale: 1, lyricPosition: 'lower' },
      source: null,
      render: idleRender(),
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await DynamoDBOperations.put(
        { ...keyOf(project.id), GSI1PK: INDEX_PK, GSI1SK: now, ...project },
        { conditionExpression: 'attribute_not_exists(PK)' }
      );
      return project;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async get(id: string): Promise<VideoTextProject | null> {
    try {
      const item = await DynamoDBOperations.get(keyOf(id));
      return item ? hydrate(item as Record<string, unknown>) : null;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /** Newest first, straight off the index. */
  async list(limit = 50): Promise<VideoTextProject[]> {
    try {
      const res = await DynamoDBOperations.query({
        keyConditionExpression: 'GSI1PK = :pk',
        expressionAttributeValues: { ':pk': INDEX_PK },
        indexName: 'GSI1',
        scanIndexForward: false,
        limit,
      });
      return ((res.Items as Record<string, unknown>[]) || []).map(hydrate);
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Save the editable fields, only if the caller saw the current version.
   * A failed condition is either a version mismatch or a deleted project; one
   * follow-up read tells them apart so the route can answer 409 vs 404.
   */
  async saveEdits(
    id: string,
    edits: Pick<
      VideoTextProject,
      'name' | 'titleText' | 'creditsText' | 'lyricsText' | 'blocks' | 'style'
    >,
    expectedVersion: number
  ): Promise<{ ok: true; version: number } | { ok: false; reason: 'conflict' | 'missing' }> {
    const now = new Date().toISOString();
    const next = expectedVersion + 1;
    try {
      await DynamoDBOperations.update({
        key: keyOf(id),
        updateExpression:
          'SET #name = :name, #titleText = :titleText, #creditsText = :creditsText,' +
          ' #lyricsText = :lyricsText, #blocks = :blocks, #style = :style,' +
          ' #version = :next, #updatedAt = :now, GSI1SK = :now',
        conditionExpression: 'attribute_exists(PK) AND #version = :expected',
        expressionAttributeNames: {
          '#name': 'name',
          '#titleText': 'titleText',
          '#creditsText': 'creditsText',
          '#lyricsText': 'lyricsText',
          '#blocks': 'blocks',
          '#style': 'style',
          '#version': 'version',
          '#updatedAt': 'updatedAt',
        },
        expressionAttributeValues: {
          ':name': edits.name,
          ':titleText': edits.titleText,
          ':creditsText': edits.creditsText,
          ':lyricsText': edits.lyricsText,
          ':blocks': edits.blocks,
          ':style': edits.style,
          ':next': next,
          ':now': now,
          ':expected': expectedVersion,
        },
      });
      return { ok: true, version: next };
    } catch (error) {
      if (isConditionFailure(error)) {
        const existing = await this.get(id);
        return { ok: false, reason: existing ? 'conflict' : 'missing' };
      }
      handleDynamoDBError(error);
    }
  }

  /**
   * Attach an uploaded video and its (re)computed blocks, and reset the render:
   * an output made from the previous source no longer matches. durationSec is
   * floored to 0.01 s here (ledger R4) so no caller can store a value that
   * rounds PAST the real end of the file.
   */
  async setSource(id: string, source: SourceInfo, blocks: TextBlock[]): Promise<void> {
    const now = new Date().toISOString();
    const stored: SourceInfo = { ...source, durationSec: Math.floor(source.durationSec * 100) / 100 };
    try {
      await DynamoDBOperations.update({
        key: keyOf(id),
        updateExpression:
          'SET #source = :source, #blocks = :blocks, #render = :render, #updatedAt = :now, GSI1SK = :now',
        // Never create a project by attaching a source to one that does not exist.
        conditionExpression: 'attribute_exists(PK)',
        expressionAttributeNames: {
          '#source': 'source',
          '#blocks': 'blocks',
          '#render': 'render',
          '#updatedAt': 'updatedAt',
        },
        expressionAttributeValues: {
          ':source': stored,
          ':blocks': blocks,
          ':render': idleRender(),
          ':now': now,
        },
      });
    } catch (error) {
      if (isConditionFailure(error)) throw new Error('video text project not found');
      handleDynamoDBError(error);
    }
  }

  /**
   * Claim the render slot. Succeeds when no render is in flight (idle, done or
   * error) or the in-flight one has not written for RENDER_STALE_MS. A missing
   * or NULL render.updatedAt on an in-flight status makes `<` false, so such a
   * render counts as in flight, not stale.
   */
  async startRender(
    id: string,
    renderId: string,
    now: number = Date.now()
  ): Promise<{ ok: true } | { ok: false }> {
    const stamp = new Date(now).toISOString();
    try {
      await DynamoDBOperations.update({
        key: keyOf(id),
        updateExpression:
          'SET #render.#renderId = :renderId, #render.#status = :queued,' +
          ' #render.#error = :null, #render.#outputKey = :null, #render.#outputExpiresAt = :null,' +
          ' #render.#progress = :null, #render.#startedAt = :stamp, #render.#updatedAt = :stamp',
        conditionExpression:
          'attribute_exists(PK) AND (#render.#status IN (:idle, :done, :error) OR #render.#updatedAt < :staleBefore)',
        expressionAttributeNames: {
          '#render': 'render',
          '#renderId': 'renderId',
          '#status': 'status',
          '#error': 'error',
          '#outputKey': 'outputKey',
          '#outputExpiresAt': 'outputExpiresAt',
          '#progress': 'progress',
          '#startedAt': 'startedAt',
          '#updatedAt': 'updatedAt',
        },
        expressionAttributeValues: {
          ':renderId': renderId,
          ':queued': 'queued',
          ':null': null,
          ':stamp': stamp,
          ':idle': 'idle',
          ':done': 'done',
          ':error': 'error',
          ':staleBefore': new Date(now - RENDER_STALE_MS).toISOString(),
        },
      });
      return { ok: true };
    } catch (error) {
      if (isConditionFailure(error)) return { ok: false };
      handleDynamoDBError(error);
    }
  }

  /**
   * Worker progress/result write. Conditional on the renderId so a stale worker
   * cannot overwrite a newer render; a lost condition is not an error. The
   * renderId itself is never patched, and render.updatedAt is always refreshed
   * so startRender's stale check sees a live render as live.
   */
  async patchRender(id: string, renderId: string, fields: Partial<RenderState>): Promise<void> {
    const names: Record<string, string> = {
      '#render': 'render',
      '#renderId': 'renderId',
      '#updatedAt': 'updatedAt',
    };
    const values: Record<string, unknown> = {
      ':renderId': renderId,
      ':patchedAt': new Date().toISOString(),
    };
    const sets: string[] = [];
    let i = 0;
    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined || field === 'renderId' || field === 'updatedAt') continue;
      if (!/^[A-Za-z]+$/.test(field)) continue;
      names[`#${field}`] = field;
      values[`:v${i}`] = value;
      sets.push(`#render.#${field} = :v${i}`);
      i++;
    }
    sets.push('#render.#updatedAt = :patchedAt');
    try {
      await DynamoDBOperations.update({
        key: keyOf(id),
        updateExpression: `SET ${sets.join(', ')}`,
        conditionExpression: '#render.#renderId = :renderId',
        expressionAttributeNames: names,
        expressionAttributeValues: values,
      });
    } catch (error) {
      if (isConditionFailure(error)) return;
      handleDynamoDBError(error);
    }
  }
}
