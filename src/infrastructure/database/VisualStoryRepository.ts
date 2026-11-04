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
  newId,
  type CreateStoryInput,
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
      handleDynamoDBError(error);
    }
  }

  async findById(vsId: string): Promise<VisualStory | null> {
    try {
      const item = await DynamoDBOperations.get(metaKey(vsId));
      return item ? toStory(item) : null;
    } catch (error) {
      handleDynamoDBError(error);
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
      handleDynamoDBError(error);
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
      await DynamoDBOperations.update({
        key: metaKey(vsId),
        updateExpression: `SET ${sets.join(', ')}`,
        expressionAttributeNames: names,
        expressionAttributeValues: values,
        conditionExpression: 'attribute_exists(PK)',
      });
    } catch (error) {
      handleDynamoDBError(error);
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
      handleDynamoDBError(error);
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
      handleDynamoDBError(error);
    }
  }
}
