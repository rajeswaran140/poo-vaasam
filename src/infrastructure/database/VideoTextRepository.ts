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
import { floorCentis, isValidProjectId } from '@/lib/video-text/keys';
import type {
  Cut,
  RenderState,
  SavedLogo,
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

/**
 * The render slot is free: no render in flight (idle, done or error), or the
 * in-flight one has not written for RENDER_STALE_MS. A missing or NULL
 * render.updatedAt on an in-flight status makes `<` false, so such a render
 * counts as in flight, not stale. Shared by startRender and setSource.
 */
const RENDER_SLOT_FREE = '(#render.#status IN (:idle, :done, :error) OR #render.#updatedAt < :staleBefore)';
const renderSlotNames = { '#render': 'render', '#status': 'status', '#updatedAt': 'updatedAt' };
const renderSlotValues = (now: number) => ({
  ':idle': 'idle',
  ':done': 'done',
  ':error': 'error',
  ':staleBefore': new Date(now - RENDER_STALE_MS).toISOString(),
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

  /**
   * `consistent` asks for a strongly consistent read: for a read that must see
   * a write that just returned (the pre-render save before overlays/render).
   */
  async get(id: string, { consistent = false }: { consistent?: boolean } = {}): Promise<VideoTextProject | null> {
    try {
      const key = keyOf(id);
      const item = consistent
        ? await DynamoDBOperations.get(key, { consistentRead: true })
        : await DynamoDBOperations.get(key);
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
      'name' | 'titleText' | 'creditsText' | 'lyricsText' | 'blocks' | 'style' | 'cut'
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
          (edits.cut !== undefined ? ' #cut = :cut,' : '') +
          ' #version = :next, #updatedAt = :now, GSI1SK = :now',
        conditionExpression: 'attribute_exists(PK) AND #version = :expected',
        expressionAttributeNames: {
          '#name': 'name',
          '#titleText': 'titleText',
          '#creditsText': 'creditsText',
          '#lyricsText': 'lyricsText',
          '#blocks': 'blocks',
          '#style': 'style',
          ...(edits.cut !== undefined ? { '#cut': 'cut' } : {}),
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
          ...(edits.cut !== undefined ? { ':cut': edits.cut } : {}),
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
   * floored to 0.01 s here (ledger R4, floorCentis — idempotent, so a value the
   * caller already floored is stored unchanged) and the stored value is
   * returned, so the caller answers with exactly what the row holds.
   *
   * Refused while a render is in flight (same rule as startRender): resetting
   * the render under a running worker would orphan it. A failed condition is
   * told apart (missing vs rendering) by one follow-up read.
   */
  async setSource(
    id: string,
    source: SourceInfo,
    blocks: TextBlock[],
    cut: Cut | null = null,
    now: number = Date.now()
  ): Promise<
    { ok: true; version: number; durationSec: number } | { ok: false; reason: 'missing' | 'rendering' }
  > {
    const stamp = new Date(now).toISOString();
    const stored: SourceInfo = { ...source, durationSec: floorCentis(source.durationSec) };
    try {
      // Bumps version: this rewrites blocks, so a tab holding the old version
      // must get a conflict on its next save rather than overwrite them.
      const attrs = await DynamoDBOperations.update({
        key: keyOf(id),
        updateExpression:
          'SET #source = :source, #blocks = :blocks, #cut = :cut, #render = :render, #updatedAt = :now, GSI1SK = :now,' +
          ' #version = #version + :one',
        // Never create a project by attaching a source to one that does not exist.
        conditionExpression: `attribute_exists(PK) AND ${RENDER_SLOT_FREE}`,
        expressionAttributeNames: {
          ...renderSlotNames,
          '#source': 'source',
          '#blocks': 'blocks',
          '#cut': 'cut',
          '#version': 'version',
        },
        expressionAttributeValues: {
          ...renderSlotValues(now),
          ':one': 1,
          ':source': stored,
          ':blocks': blocks,
          ':cut': cut,
          ':render': idleRender(),
          ':now': stamp,
        },
      });
      return { ok: true, version: (attrs as { version: number }).version, durationSec: stored.durationSec };
    } catch (error) {
      if (isConditionFailure(error)) {
        const existing = await this.get(id, { consistent: true });
        return { ok: false, reason: existing ? 'rendering' : 'missing' };
      }
      handleDynamoDBError(error);
    }
  }

  /**
   * Claim the render slot for the version the caller drew its PNGs from.
   * Succeeds when the slot is free (RENDER_SLOT_FREE) and the project is still
   * at `expectedVersion` — the blocks the worker reads are the ones drawn. A
   * failed condition is told apart by one follow-up read: missing, changed
   * (another tab saved), or busy (a render is in flight).
   */
  async startRender(
    id: string,
    renderId: string,
    expectedVersion: number,
    now: number = Date.now()
  ): Promise<{ ok: true } | { ok: false; reason: 'missing' | 'changed' | 'busy' }> {
    const stamp = new Date(now).toISOString();
    try {
      await DynamoDBOperations.update({
        key: keyOf(id),
        updateExpression:
          'SET #render.#renderId = :renderId, #render.#status = :queued,' +
          ' #render.#error = :null, #render.#outputKey = :null, #render.#outputExpiresAt = :null,' +
          ' #render.#progress = :null, #render.#startedAt = :stamp, #render.#updatedAt = :stamp',
        conditionExpression: `attribute_exists(PK) AND #version = :version AND ${RENDER_SLOT_FREE}`,
        expressionAttributeNames: {
          ...renderSlotNames,
          '#renderId': 'renderId',
          '#error': 'error',
          '#outputKey': 'outputKey',
          '#outputExpiresAt': 'outputExpiresAt',
          '#progress': 'progress',
          '#startedAt': 'startedAt',
          '#version': 'version',
        },
        expressionAttributeValues: {
          ...renderSlotValues(now),
          ':renderId': renderId,
          ':queued': 'queued',
          ':null': null,
          ':stamp': stamp,
          ':version': expectedVersion,
        },
      });
      return { ok: true };
    } catch (error) {
      if (isConditionFailure(error)) {
        const existing = await this.get(id, { consistent: true });
        if (!existing) return { ok: false, reason: 'missing' };
        return { ok: false, reason: existing.version !== expectedVersion ? 'changed' : 'busy' };
      }
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

/**
 * The one saved logo every Video Text project can use: PK=`VIDEOTEXTLOGO`,
 * SK=`METADATA`. Not on the project index (no GSI1), and not a `VIDEOTEXT#`
 * key, so it can never be read as a project.
 */
const LOGO_KEY = { PK: 'VIDEOTEXTLOGO', SK: 'METADATA' };

export class VideoTextLogoRepository {
  async get(): Promise<SavedLogo | null> {
    try {
      const item = (await DynamoDBOperations.get(LOGO_KEY)) as Record<string, unknown> | null | undefined;
      if (!item) return null;
      const { key, contentType, width, height, uploadedAt } = item as unknown as SavedLogo;
      return { key, contentType, width, height, uploadedAt };
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async set(logo: SavedLogo): Promise<void> {
    try {
      await DynamoDBOperations.put({ ...LOGO_KEY, ...logo });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }
}
