/**
 * Repair marks: PK=MARKS#<masterJobId>, SK=MARK#<markId>, one item per mark.
 *
 * A SIBLING of the master's record, like STEMSET#: nothing here writes
 * MASTERJOB#, so a mark never moves the master's updatedAt (the YouTube upload
 * guard reads it). One item per mark means two tabs adding marks at once write
 * two items, and an edit carries the version it was based on, so a stale tab
 * is refused (StaleMarkError) instead of overwriting a newer edit.
 */
import { randomUUID } from 'node:crypto';
import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';
import {
  sortMarks, MARK_STATUSES, type RepairMark, type NewMarkInput, type MarkPatch, type MarkStatus,
} from '@/lib/repair-marks';
import type { MarkReason } from '@/lib/audition-marks';

export class StaleMarkError extends Error {
  constructor() {
    super('That mark was changed somewhere else.');
    this.name = 'StaleMarkError';
  }
}

const pk = (masterJobId: string) => `MARKS#${masterJobId}`;
const keyFor = (masterJobId: string, markId: string) => ({ PK: pk(masterJobId), SK: `MARK#${markId}` });

function hydrate(item: Record<string, unknown>): RepairMark | null {
  if (typeof item.markId !== 'string' || typeof item.start !== 'number' || !Number.isFinite(item.start)) return null;
  const status = (MARK_STATUSES as readonly string[]).includes(item.status as string)
    ? (item.status as MarkStatus)
    : 'open';
  return {
    markId: item.markId,
    masterJobId: String(item.masterJobId ?? ''),
    start: item.start,
    end: typeof item.end === 'number' ? item.end : null,
    reason: item.reason as MarkReason,
    note: typeof item.note === 'string' ? item.note : '',
    status,
    fixedIn: typeof item.fixedIn === 'string' ? item.fixedIn : null,
    version: typeof item.version === 'number' ? item.version : 1,
    createdAt: String(item.createdAt ?? ''),
    updatedAt: String(item.updatedAt ?? ''),
  };
}

const isConditionFailure = (e: unknown) =>
  (e as { name?: string } | null)?.name === 'ConditionalCheckFailedException';

export class MarkRepository {
  async list(masterJobId: string): Promise<RepairMark[]> {
    try {
      const out: RepairMark[] = [];
      let start: Record<string, unknown> | undefined;
      do {
        const res = await DynamoDBOperations.query({
          keyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          expressionAttributeValues: { ':pk': pk(masterJobId), ':sk': 'MARK#' },
          exclusiveStartKey: start,
        });
        for (const it of res.Items ?? []) {
          const m = hydrate(it as Record<string, unknown>);
          if (m) out.push(m);
        }
        start = res.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (start);
      return sortMarks(out);
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async get(masterJobId: string, markId: string): Promise<RepairMark | null> {
    try {
      const item = await DynamoDBOperations.get(keyFor(masterJobId, markId));
      return item ? hydrate(item as Record<string, unknown>) : null;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async create(masterJobId: string, input: NewMarkInput): Promise<RepairMark> {
    try {
      const markId = randomUUID();
      const now = new Date().toISOString();
      const attrs = await DynamoDBOperations.update({
        key: keyFor(masterJobId, markId),
        // An UpdateItem rather than a Put because DynamoDBOperations.put takes
        // no condition, and a create must never overwrite.
        updateExpression:
          'SET #type = :type, #markId = :markId, #masterJobId = :masterJobId, #start = :start, #end = :end, ' +
          '#reason = :reason, #note = :note, #status = :status, #fixedIn = :fixedIn, #version = :version, ' +
          '#createdAt = :now, #updatedAt = :now',
        conditionExpression: 'attribute_not_exists(PK)',
        expressionAttributeNames: {
          '#type': 'Type', '#markId': 'markId', '#masterJobId': 'masterJobId', '#start': 'start', '#end': 'end',
          '#reason': 'reason', '#note': 'note', '#status': 'status', '#fixedIn': 'fixedIn', '#version': 'version',
          '#createdAt': 'createdAt', '#updatedAt': 'updatedAt',
        },
        expressionAttributeValues: {
          ':type': 'MASTERMARK', ':markId': markId, ':masterJobId': masterJobId, ':start': input.start,
          ':end': input.end, ':reason': input.reason, ':note': input.note, ':status': 'open', ':fixedIn': null,
          ':version': 1, ':now': now,
        },
      });
      return hydrate((attrs ?? {}) as Record<string, unknown>) as RepairMark;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async update(masterJobId: string, markId: string, expectedVersion: number, patch: MarkPatch): Promise<RepairMark> {
    const names: Record<string, string> = { '#version': 'version', '#updatedAt': 'updatedAt' };
    const values: Record<string, unknown> = {
      ':expected': expectedVersion, ':one': 1, ':now': new Date().toISOString(),
    };
    const sets = ['#version = #version + :one', '#updatedAt = :now'];
    for (const [k, v] of Object.entries(patch)) {
      names[`#${k}`] = k;
      values[`:${k}`] = v;
      sets.push(`#${k} = :${k}`);
    }
    try {
      const attrs = await DynamoDBOperations.update({
        key: keyFor(masterJobId, markId),
        updateExpression: `SET ${sets.join(', ')}`,
        conditionExpression: 'attribute_exists(PK) AND #version = :expected',
        expressionAttributeNames: names,
        expressionAttributeValues: values,
      });
      return hydrate((attrs ?? {}) as Record<string, unknown>) as RepairMark;
    } catch (error) {
      if (isConditionFailure(error)) throw new StaleMarkError();
      handleDynamoDBError(error);
    }
  }

  async delete(masterJobId: string, markId: string): Promise<void> {
    try {
      await DynamoDBOperations.delete(keyFor(masterJobId, markId));
    } catch (error) {
      handleDynamoDBError(error);
    }
  }
}
