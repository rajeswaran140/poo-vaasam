/**
 * Persistence for visual stories (single-table: PK=`VSTORY#<vsId>`).
 *
 * One partition holds a whole story (spec §5). This repository owns the
 * METADATA item's lifecycle and the HARD-CAP BUDGET RESERVATION (spec §11,
 * layer 3): `reserve` is what stops concurrent paid AI calls from jointly
 * overspending a story's budget.
 *
 * DynamoDB condition expressions cannot do arithmetic, so METADATA carries a
 * denormalised `committedUsd = spentUsd + reservedUsd`; the reservation
 * condition compares that single attribute to a limit computed in code.
 */

import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';
import {
  DEFAULT_BUDGET_USD_CAP,
  deriveStartSecs,
  newId,
  type Candidate,
  type Character,
  type CreateStoryInput,
  type Scene,
  type Shot,
  type StoryboardDraft,
  type VisualStory,
  type VisualStoryStatus,
} from '@/types/visualStory';

/** Sparse GSI1 partition: one METADATA row per story. */
export const VSTORY_INDEX_PK = 'VSTORY';
/** Sparse GSI1 partition: GENJOB rows, present only while non-terminal. */
export const VSTORY_INFLIGHT_PK = 'VSTORY_INFLIGHT';

const pad3 = (n: number) => String(n).padStart(3, '0');

export const vsPk = (vsId: string) => `VSTORY#${vsId}`;
export const sceneSk = (n: number) => `SCENE#${pad3(n)}`;
export const shotSk = (scene: number, shot: number) => `SHOT#${pad3(scene)}#${pad3(shot)}`;
export const candSk = (scene: number, shot: number, candId: string) =>
  `CAND#${pad3(scene)}#${pad3(shot)}#${candId}`;
export const charSk = (charId: string) => `CHAR#${charId}`;
export const draftSk = (draftId: string) => `DRAFT#${draftId}`;

const METADATA = 'METADATA';
const metaKey = (vsId: string) => ({ PK: vsPk(vsId), SK: METADATA });

/** Round to 6 decimals so float drift never reaches a stored value or a condition. */
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Delete fan-out: bounded so a large story does not burst the table's write capacity. */
const DELETE_CONCURRENCY = 10;

/** DynamoDB TransactWriteItems accepts at most 100 operations. */
export const MAX_TRANSACT_ITEMS = 100;

/** Base for errors a route should map to 4xx; never flattened into a DynamoDB 500. */
export class VisualStoryDomainError extends Error {}

/** A story, draft or candidate the caller named does not exist (map to 404). */
export class NotFoundError extends VisualStoryDomainError {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** A cap edit would put the budget below what is already spent or reserved (map to 409). */
export class CapBelowCommittedError extends VisualStoryDomainError {
  constructor(public readonly committedUsd: number) {
    super(`The cap can't go below what's already spent or reserved ($${committedUsd.toFixed(2)}).`);
    this.name = 'CapBelowCommittedError';
  }
}

/** `newOrder` is not a permutation of the scene's shots (map to 400). */
export class InvalidReorderError extends VisualStoryDomainError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidReorderError';
  }
}

/** The storyboard change would need more than one transaction can carry (map to 400/409). */
export class DraftTooLargeError extends VisualStoryDomainError {
  constructor(public readonly itemCount: number) {
    super(`This change touches ${itemCount} items; a single transaction allows ${MAX_TRANSACT_ITEMS}. Use fewer scenes or shots.`);
    this.name = 'DraftTooLargeError';
  }
}

type Row = Record<string, any>;
type Key = { PK: string; SK: string };

const stripKeys = <T extends Row>(item: Row): T => {
  const { PK: _pk, SK: _sk, GSI1PK: _g1, GSI1SK: _g2, ...rest } = item;
  return rest as T;
};

/**
 * Build one transaction that makes `puts` the truth and removes `deleteKeys`.
 * A key that is both deleted and put is only put: DynamoDB rejects two
 * operations on one item in a transaction, and a Put overwrites anyway.
 */
function buildRewrite(puts: Row[], deleteKeys: Key[]): Array<Record<string, any>> {
  const putSks = new Set(puts.map((p) => p.SK));
  const dels = deleteKeys.filter((k) => !putSks.has(k.SK));
  const total = puts.length + dels.length;
  if (total > MAX_TRANSACT_ITEMS) throw new DraftTooLargeError(total);
  return [
    ...dels.map((Key) => ({ Delete: { Key } })),
    ...puts.map((Item) => ({ Put: { Item } })),
  ];
}

/** Domain errors pass through untouched; anything else is a storage failure. */
function fail(error: unknown): never {
  if (error instanceof VisualStoryDomainError) throw error;
  return handleDynamoDBError(error);
}

function isConditionFailure(e: unknown): boolean {
  return (e as { name?: string } | null)?.name === 'ConditionalCheckFailedException';
}

function toStory(item: Record<string, any>): VisualStory {
  return {
    vsId: item.vsId,
    masterJobId: item.masterJobId,
    audioKey: item.audioKey,
    contentId: item.contentId ?? null,
    title: item.title,
    status: item.status,
    aspectRatio: item.aspectRatio,
    providerId: item.providerId,
    windowStartSec: item.windowStartSec,
    windowEndSec: item.windowEndSec,
    budgetUsdCap: item.budgetUsdCap,
    spentUsd: item.spentUsd ?? 0,
    reservedUsd: item.reservedUsd ?? 0,
    committedUsd: item.committedUsd ?? 0,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export class VisualStoryRepository {
  async create(input: CreateStoryInput & { audioKey: string }): Promise<VisualStory> {
    try {
      const vsId = newId('vs');
      const now = new Date().toISOString();
      const story: VisualStory = {
        vsId,
        masterJobId: input.masterJobId,
        audioKey: input.audioKey,
        contentId: input.contentId ?? null,
        title: input.title,
        status: 'DRAFT',
        aspectRatio: input.aspectRatio,
        providerId: 'grok',
        windowStartSec: input.windowStartSec,
        windowEndSec: input.windowEndSec,
        budgetUsdCap: round6(input.budgetUsdCap ?? DEFAULT_BUDGET_USD_CAP),
        spentUsd: 0,
        reservedUsd: 0,
        committedUsd: 0,
        createdAt: now,
        updatedAt: now,
      };
      await DynamoDBOperations.put({
        PK: vsPk(vsId),
        SK: METADATA,
        ...story,
        GSI1PK: VSTORY_INDEX_PK,
        GSI1SK: `${story.masterJobId}#${now}#${vsId}`,
      });
      return story;
    } catch (error) {
      fail(error);
    }
  }

  async findById(vsId: string): Promise<VisualStory | null> {
    try {
      const item = await DynamoDBOperations.get(metaKey(vsId));
      return item ? toStory(item) : null;
    } catch (error) {
      fail(error);
    }
  }

  /** All stories, via the sparse GSI1 partition (newest master groups sort by masterJobId). */
  async list(): Promise<VisualStory[]> {
    return this.queryIndex('GSI1PK = :pk', { ':pk': VSTORY_INDEX_PK });
  }

  async listByMaster(masterJobId: string): Promise<VisualStory[]> {
    return this.queryIndex('GSI1PK = :pk AND begins_with(GSI1SK, :prefix)', {
      ':pk': VSTORY_INDEX_PK,
      ':prefix': `${masterJobId}#`,
    });
  }

  private async queryIndex(
    keyConditionExpression: string,
    expressionAttributeValues: Record<string, any>
  ): Promise<VisualStory[]> {
    try {
      const out: VisualStory[] = [];
      let exclusiveStartKey: Record<string, any> | undefined;
      do {
        const res = await DynamoDBOperations.query({
          keyConditionExpression,
          expressionAttributeValues,
          indexName: 'GSI1',
          exclusiveStartKey,
        });
        for (const item of (res.Items as Record<string, any>[]) ?? []) out.push(toStory(item));
        exclusiveStartKey = res.LastEvaluatedKey as Record<string, any> | undefined;
      } while (exclusiveStartKey);
      return out;
    } catch (error) {
      fail(error);
    }
  }

  /**
   * Edit title / status / cap. Never touches the money counters. Guarded so a
   * patch of a deleted story fails instead of upserting a half-empty row.
   * (A cap edit is what the reservation's `budgetUsdCap = :capRead` clause races against.)
   */
  async patch(
    vsId: string,
    fields: { title?: string; status?: VisualStoryStatus; budgetUsdCap?: number }
  ): Promise<void> {
    try {
      const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
      const values: Record<string, any> = { ':updatedAt': new Date().toISOString() };
      const sets = ['#updatedAt = :updatedAt'];
      if (fields.title !== undefined) {
        names['#title'] = 'title';
        values[':title'] = fields.title;
        sets.push('#title = :title');
      }
      if (fields.status !== undefined) {
        names['#status'] = 'status';
        values[':status'] = fields.status;
        sets.push('#status = :status');
      }
      if (fields.budgetUsdCap !== undefined) {
        names['#cap'] = 'budgetUsdCap';
        values[':cap'] = round6(fields.budgetUsdCap);
        sets.push('#cap = :cap');
      }
      // Atomic hard-ceiling guard: a concurrent reserve can raise committedUsd
      // after the route's pre-check, so the cap write re-checks it itself.
      const capping = fields.budgetUsdCap !== undefined;
      try {
        await DynamoDBOperations.update({
          key: metaKey(vsId),
          updateExpression: `SET ${sets.join(', ')}`,
          expressionAttributeNames: names,
          expressionAttributeValues: values,
          conditionExpression: capping ? 'attribute_exists(PK) AND committedUsd <= :cap' : 'attribute_exists(PK)',
        });
      } catch (error) {
        if (capping && isConditionFailure(error)) {
          const story = await this.findById(vsId);
          if (!story) throw new NotFoundError(`visual story ${vsId} not found`);
          throw new CapBelowCommittedError(story.committedUsd);
        }
        throw error;
      }
    } catch (error) {
      fail(error);
    }
  }

  /** Delete the whole partition: METADATA, scenes, shots, candidates, jobs, drafts. */
  async remove(vsId: string): Promise<void> {
    try {
      const keys: Array<{ PK: string; SK: string }> = [];
      let exclusiveStartKey: Record<string, any> | undefined;
      do {
        const res = await DynamoDBOperations.query({
          keyConditionExpression: 'PK = :pk',
          expressionAttributeValues: { ':pk': vsPk(vsId) },
          exclusiveStartKey,
        });
        for (const item of (res.Items as Record<string, any>[]) ?? []) {
          keys.push({ PK: item.PK, SK: item.SK });
        }
        exclusiveStartKey = res.LastEvaluatedKey as Record<string, any> | undefined;
      } while (exclusiveStartKey);

      for (let i = 0; i < keys.length; i += DELETE_CONCURRENCY) {
        await Promise.all(keys.slice(i, i + DELETE_CONCURRENCY).map((k) => DynamoDBOperations.delete(k)));
      }
    } catch (error) {
      fail(error);
    }
  }

  /**
   * Reserve `usd` against the story's cap. Returns true when reserved, false
   * when it would breach the cap (or the cap changed since we read it).
   *
   * Atomic: one conditional ADD. `committedUsd <= cap - usd` is the whole cap
   * test; `budgetUsdCap = :capRead` makes a cap edit between our read and our
   * write fail the reservation instead of letting it through on a stale cap.
   * Errors other than a failed condition are rethrown, never mapped to `false`.
   */
  async reserve(vsId: string, usd: number): Promise<boolean> {
    if (!Number.isFinite(usd) || usd < 0) {
      throw new Error(`reserve: amount must be a non-negative number, got ${usd}`);
    }
    const amount = round6(usd);
    const story = await this.findById(vsId);
    if (!story) throw new Error(`reserve: visual story ${vsId} not found`);

    const limit = round6(story.budgetUsdCap - amount);
    if (limit < 0) return false; // larger than the whole cap; nothing to write

    try {
      await DynamoDBOperations.update({
        key: metaKey(vsId),
        updateExpression: 'ADD reservedUsd :u, committedUsd :u',
        conditionExpression: 'committedUsd <= :limit AND budgetUsdCap = :capRead',
        expressionAttributeValues: { ':u': amount, ':limit': limit, ':capRead': story.budgetUsdCap },
      });
      return true;
    } catch (error) {
      if (isConditionFailure(error)) return false;
      throw error;
    }
  }

  /**
   * Settle a finished call: release `reservedUsd`, and add `billedUsd` to spend
   * (0 when the provider did not bill). `committedUsd` moves by billed - reserved.
   */
  async settle(vsId: string, args: { reservedUsd: number; billedUsd: number }): Promise<void> {
    const r = round6(args.reservedUsd);
    const b = round6(args.billedUsd);
    try {
      await DynamoDBOperations.update({
        key: metaKey(vsId),
        updateExpression: 'ADD reservedUsd :negR, spentUsd :b, committedUsd :delta',
        expressionAttributeValues: { ':negR': -r, ':b': b, ':delta': round6(b - r) },
      });
    } catch (error) {
      fail(error);
    }
  }

  // -------------------------------------------------------------------------
  // Story tree (spec §5): scenes, shots, characters, candidates, drafts
  // -------------------------------------------------------------------------

  /** Every item in the story's partition (paginated), in SK order. */
  private async queryPartition(vsId: string): Promise<Row[]> {
    const out: Row[] = [];
    let exclusiveStartKey: Record<string, any> | undefined;
    do {
      const res = await DynamoDBOperations.query({
        keyConditionExpression: 'PK = :pk',
        expressionAttributeValues: { ':pk': vsPk(vsId) },
        exclusiveStartKey,
      });
      out.push(...((res.Items as Row[]) ?? []));
      exclusiveStartKey = res.LastEvaluatedKey as Record<string, any> | undefined;
    } while (exclusiveStartKey);
    return out.sort((a, b) => (a.SK < b.SK ? -1 : a.SK > b.SK ? 1 : 0));
  }

  /** Number of SHOT# items in a story (COUNT query, follows pagination). */
  async countShots(vsId: string): Promise<number> {
    try {
      let total = 0;
      let exclusiveStartKey: Record<string, any> | undefined;
      do {
        const res = await DynamoDBOperations.query({
          keyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          expressionAttributeValues: { ':pk': vsPk(vsId), ':sk': 'SHOT#' },
          select: 'COUNT',
          exclusiveStartKey,
        });
        total += res.Count ?? 0;
        exclusiveStartKey = res.LastEvaluatedKey as Record<string, any> | undefined;
      } while (exclusiveStartKey);
      return total;
    } catch (error) {
      fail(error);
    }
  }

  /** The whole story in one Query. `null` when there is no METADATA item. */
  async loadTree(vsId: string): Promise<{
    story: VisualStory;
    scenes: Scene[];
    shots: Shot[];
    characters: Character[];
    candidates: Candidate[];
    drafts: StoryboardDraft[];
  } | null> {
    try {
      const items = await this.queryPartition(vsId);
      const metaItem = items.find((i) => i.SK === METADATA);
      if (!metaItem) return null;
      const by = (prefix: string) => items.filter((i) => String(i.SK).startsWith(prefix));

      // SKs are zero-padded, so SK order is scene-then-shot order (R3).
      const rawShots = by('SHOT#');
      const starts = deriveStartSecs(rawShots as Array<{ durationSec: number }>);
      return {
        story: toStory(metaItem),
        scenes: by('SCENE#').map((i) => stripKeys<Scene>(i)),
        shots: rawShots.map((i, n) => ({ ...stripKeys<Shot>(i), startSec: starts[n] })),
        characters: by('CHAR#').map((i) => stripKeys<Character>(i)),
        candidates: by('CAND#').map((i) => stripKeys<Candidate>(i)),
        drafts: by('DRAFT#').map((i) => stripKeys<StoryboardDraft>(i)),
      };
    } catch (error) {
      fail(error);
    }
  }

  async putScene(vsId: string, scene: Scene): Promise<void> {
    try {
      await DynamoDBOperations.put({ PK: vsPk(vsId), SK: sceneSk(scene.order), ...scene });
    } catch (error) {
      fail(error);
    }
  }

  /** `startSec` is derived on read, never stored (it would go stale on every edit). */
  async putShot(vsId: string, shot: Shot): Promise<void> {
    try {
      const { startSec: _derived, ...stored } = shot;
      await DynamoDBOperations.put({ PK: vsPk(vsId), SK: shotSk(shot.sceneOrder, shot.shotOrder), ...stored });
    } catch (error) {
      fail(error);
    }
  }

  /**
   * Remove a shot and its candidates. Later shots keep their orders (gaps are
   * fine; ordering is by SK) — `reorderShots` closes them.
   */
  async deleteShot(vsId: string, sceneOrder: number, shotOrder: number): Promise<void> {
    try {
      const prefix = `CAND#${String(sceneOrder).padStart(3, '0')}#${String(shotOrder).padStart(3, '0')}#`;
      const items = await this.queryPartition(vsId);
      const keys: Key[] = items
        .filter((i) => i.SK === shotSk(sceneOrder, shotOrder) || String(i.SK).startsWith(prefix))
        .map((i) => ({ PK: i.PK, SK: i.SK }));
      await DynamoDBOperations.transactWrite(buildRewrite([], keys));
    } catch (error) {
      fail(error);
    }
  }

  /** Remove a scene with all its shots and their candidates, in one transaction. */
  async deleteScene(vsId: string, sceneOrder: number): Promise<void> {
    try {
      const pad = String(sceneOrder).padStart(3, '0');
      const items = await this.queryPartition(vsId);
      const keys: Key[] = items
        .filter(
          (i) =>
            i.SK === sceneSk(sceneOrder) ||
            String(i.SK).startsWith(`SHOT#${pad}#`) ||
            String(i.SK).startsWith(`CAND#${pad}#`)
        )
        .map((i) => ({ PK: i.PK, SK: i.SK }));
      await DynamoDBOperations.transactWrite(buildRewrite([], keys));
    } catch (error) {
      fail(error);
    }
  }

  /**
   * Re-sequence one scene's shots. `newOrder` lists the scene's CURRENT
   * shotOrders in the desired sequence; position i becomes shotOrder i+1.
   * Candidates move with their shot. One transaction (≤ 100 items).
   */
  async reorderShots(vsId: string, sceneOrder: number, newOrder: number[]): Promise<void> {
    try {
      const items = await this.queryPartition(vsId);
      const shots = items.filter((i) => i.SK.startsWith('SHOT#') && i.sceneOrder === sceneOrder);
      const have = shots.map((s) => s.shotOrder as number).sort((a, b) => a - b);
      const want = [...newOrder].sort((a, b) => a - b);
      if (have.length !== want.length || have.some((v, n) => v !== want[n])) {
        throw new InvalidReorderError('reorderShots: newOrder must be a permutation of the scene\'s current shot orders');
      }
      const newPos = new Map<number, number>(newOrder.map((old, i) => [old, i + 1]));

      const puts: Row[] = [];
      const deleteKeys: Key[] = [];
      for (const item of items) {
        const isShot = item.SK.startsWith('SHOT#');
        const isCand = item.SK.startsWith('CAND#');
        if (!(isShot || isCand) || item.sceneOrder !== sceneOrder) continue;
        const pos = newPos.get(item.shotOrder);
        if (pos === undefined) continue;
        deleteKeys.push({ PK: item.PK, SK: item.SK });
        const moved: Row = { ...item, shotOrder: pos };
        moved.SK = isShot ? shotSk(sceneOrder, pos) : candSk(sceneOrder, pos, item.candId);
        puts.push(moved);
      }
      // A shot that did not move is left alone.
      const changed = puts.filter((p, n) => p.SK !== deleteKeys[n].SK);
      const unchangedKeys = new Set(puts.filter((p, n) => p.SK === deleteKeys[n].SK).map((p) => p.SK));
      await DynamoDBOperations.transactWrite(
        buildRewrite(changed, deleteKeys.filter((k) => !unchangedKeys.has(k.SK)))
      );
    } catch (error) {
      fail(error);
    }
  }

  async putCharacter(vsId: string, character: Character): Promise<void> {
    try {
      await DynamoDBOperations.put({ PK: vsPk(vsId), SK: charSk(character.charId), ...character });
    } catch (error) {
      fail(error);
    }
  }

  /** Append a reference-image key; fails if the character no longer exists. */
  async addCharacterRef(vsId: string, charId: string, key: string): Promise<void> {
    try {
      await DynamoDBOperations.update({
        key: { PK: vsPk(vsId), SK: charSk(charId) },
        updateExpression: 'SET refImageKeys = list_append(if_not_exists(refImageKeys, :empty), :k)',
        expressionAttributeValues: { ':k': [key], ':empty': [] },
        conditionExpression: 'attribute_exists(PK)',
      });
    } catch (error) {
      fail(error);
    }
  }

  /**
   * Remove one reference-image key from a character. DynamoDB removes list
   * elements by index, so the index is read first and the write is conditional
   * on that slot still holding the key: a concurrent add or remove makes the
   * condition fail and we re-read, rather than dropping a different ref.
   * NotFoundError when the character or the key is not there.
   */
  async removeCharacterRef(vsId: string, charId: string, key: string): Promise<void> {
    try {
      const keyOf = { PK: vsPk(vsId), SK: charSk(charId) };
      for (let attempt = 0; attempt < 3; attempt++) {
        const item = await DynamoDBOperations.get(keyOf);
        const refs: string[] = Array.isArray(item?.refImageKeys) ? item.refImageKeys : [];
        const i = refs.indexOf(key);
        if (i < 0) throw new NotFoundError(`removeCharacterRef: ${key} is not on character ${charId}`);
        try {
          await DynamoDBOperations.update({
            key: keyOf,
            updateExpression: `REMOVE refImageKeys[${i}]`,
            expressionAttributeValues: { ':k': key },
            conditionExpression: `refImageKeys[${i}] = :k`,
          });
          return;
        } catch (error) {
          if (!isConditionFailure(error)) throw error;
        }
      }
      throw new NotFoundError(`removeCharacterRef: ${key} kept changing under the update`);
    } catch (error) {
      fail(error);
    }
  }

  async putCandidate(vsId: string, cand: Candidate): Promise<void> {
    try {
      await DynamoDBOperations.put({
        PK: vsPk(vsId),
        SK: candSk(cand.sceneOrder, cand.shotOrder, cand.candId),
        ...cand,
      });
    } catch (error) {
      fail(error);
    }
  }

  /** Pick the candidate a shot uses. The candidate must exist on that shot. */
  async selectCandidate(vsId: string, sceneOrder: number, shotOrder: number, candId: string): Promise<void> {
    try {
      const cand = await DynamoDBOperations.get({ PK: vsPk(vsId), SK: candSk(sceneOrder, shotOrder, candId) });
      if (!cand) throw new NotFoundError(`selectCandidate: candidate ${candId} not found on shot ${sceneOrder}/${shotOrder}`);
      await DynamoDBOperations.update({
        key: { PK: vsPk(vsId), SK: shotSk(sceneOrder, shotOrder) },
        updateExpression: 'SET selectedCandidateId = :c',
        expressionAttributeValues: { ':c': candId },
        conditionExpression: 'attribute_exists(PK)',
      });
    } catch (error) {
      fail(error);
    }
  }

  async putDraft(vsId: string, draft: StoryboardDraft): Promise<void> {
    try {
      await DynamoDBOperations.put({ PK: vsPk(vsId), SK: draftSk(draft.draftId), ...draft });
    } catch (error) {
      fail(error);
    }
  }

  async getDraft(vsId: string, draftId: string): Promise<StoryboardDraft | null> {
    try {
      const item = await DynamoDBOperations.get({ PK: vsPk(vsId), SK: draftSk(draftId) });
      return item ? stripKeys<StoryboardDraft>(item) : null;
    } catch (error) {
      fail(error);
    }
  }

  /**
   * Replace the story's storyboard with a draft's, in ONE transaction: all
   * SCENE#/SHOT# items (and the candidates hanging off the replaced shots) are
   * swapped for the draft's, and characters the story does not already have
   * (matched by trimmed, case-insensitive name) are created. Existing
   * characters are kept untouched. Throws `DraftTooLargeError` above 100 ops.
   */
  async applyDraft(vsId: string, draftId: string): Promise<void> {
    try {
      const draft = await this.getDraft(vsId, draftId);
      if (!draft) throw new NotFoundError(`applyDraft: draft ${draftId} not found`);
      const items = await this.queryPartition(vsId);
      const now = new Date().toISOString();

      const norm = (n: string) => n.trim().toLowerCase();
      const charIdByName = new Map<string, string>();
      for (const i of items) if (i.SK.startsWith('CHAR#')) charIdByName.set(norm(i.name), i.charId);

      const puts: Row[] = [];
      for (const c of draft.characters) {
        if (charIdByName.has(norm(c.name))) continue;
        const charId = newId('ch');
        charIdByName.set(norm(c.name), charId);
        puts.push({
          PK: vsPk(vsId), SK: charSk(charId), charId, name: c.name, description: c.description,
          refImageKeys: [], createdAt: now,
        });
      }

      draft.scenes.forEach((scene, si) => {
        const sceneOrder = si + 1;
        puts.push({
          PK: vsPk(vsId), SK: sceneSk(sceneOrder), order: sceneOrder, heading: scene.heading, summary: scene.summary,
        });
        scene.shots.forEach((shot, hi) => {
          const shotOrder = hi + 1;
          const charIds = shot.characterNames
            .map((n) => charIdByName.get(norm(n)))
            .filter((id): id is string => !!id);
          puts.push({
            PK: vsPk(vsId), SK: shotSk(sceneOrder, shotOrder), sceneOrder, shotOrder, mode: shot.mode,
            durationSec: shot.durationSec, visualPrompt: shot.visualPrompt, negativePrompt: '',
            charIds, selectedCandidateId: null,
          });
        });
      });

      const deleteKeys: Key[] = items
        .filter((i) => /^(SCENE|SHOT|CAND)#/.test(i.SK))
        .map((i) => ({ PK: i.PK, SK: i.SK }));
      await DynamoDBOperations.transactWrite(buildRewrite(puts, deleteKeys));
    } catch (error) {
      fail(error);
    }
  }
}
