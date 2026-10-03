/**
 * A saved master's stem set: PK=STEMSET#<masterJobId>, SK=METADATA.
 *
 * ⚠️ STEMS ARE A MAP KEYED BY stemId, NOT A LIST. The worker records each
 * stem's listening copy as it finishes, and several finish at once; a list
 * would need read-modify-write and the second writer would erase the first.
 * A nested-map SET is atomic per stem. `order` carries display order.
 *
 * Writing a set also writes `stemCount` on the master, so the library row can
 * show "Stems (N)" without loading sets — and never touches the master's
 * `updatedAt`, which the YouTube upload guard reads.
 */
import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';
import type { StemSet, StemEntry, StemMixEntry, StemRemix } from '@/types/stemSet';
import { stemIdFromKey, guessStemName } from '@/lib/stems';

const keyFor = (masterJobId: string) => ({ PK: `STEMSET#${masterJobId}`, SK: 'METADATA' });

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function stemSetFromItem(i: Record<string, unknown>): StemSet {
  const rawStems = (i.stems ?? {}) as Record<string, Record<string, unknown>>;
  const stems: Record<string, StemEntry> = {};
  for (const [id, s] of Object.entries(rawStems)) {
    if (!s || typeof s.key !== 'string') continue;
    stems[id] = {
      key: s.key,
      name: typeof s.name === 'string' ? s.name : 'Stem',
      previewKey: typeof s.previewKey === 'string' ? s.previewKey : null,
      previewError: typeof s.previewError === 'string' ? s.previewError : null,
      previewRequestedAt: typeof s.previewRequestedAt === 'string' ? s.previewRequestedAt : null,
      durationSec: num(s.durationSec),
      sampleRate: num(s.sampleRate),
      channels: num(s.channels),
    };
  }
  const order = (Array.isArray(i.order) ? i.order : []).filter((id): id is string => typeof id === 'string' && id in stems);
  const mix: Record<string, StemMixEntry> = {};
  for (const [id, m] of Object.entries((i.mix ?? {}) as Record<string, Record<string, unknown>>)) {
    if (id in stems && m && typeof m.gainDb === 'number') mix[id] = { gainDb: m.gainDb, muted: m.muted === true };
  }
  const r = i.remix as Record<string, unknown> | null | undefined;
  const remix: StemRemix | null = r
    ? {
        key: typeof r.key === 'string' ? r.key : null,
        renderedAt: typeof r.renderedAt === 'string' ? r.renderedAt : null,
        mixUsed: (r.mixUsed as StemRemix['mixUsed']) ?? null,
        notes: Array.isArray(r.notes) ? (r.notes as unknown[]).filter((n): n is string => typeof n === 'string') : [],
        error: typeof r.error === 'string' ? r.error : null,
        requestedAt: typeof r.requestedAt === 'string' ? r.requestedAt : null,
      }
    : null;
  return {
    masterJobId: String(i.masterJobId ?? ''),
    order, stems, mix, remix,
    createdAt: String(i.createdAt ?? ''),
    updatedAt: String(i.updatedAt ?? ''),
  };
}

export class StemSetRepository {
  async get(masterJobId: string): Promise<StemSet | null> {
    try {
      const item = await DynamoDBOperations.get(keyFor(masterJobId));
      return item ? stemSetFromItem(item as Record<string, unknown>) : null;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async addStem(masterJobId: string, key: string, filename: string): Promise<StemSet> {
    try {
      const id = stemIdFromKey(key);
      // A re-POST of the same key (e.g. the page's Retry button after a
      // worker invoke failed) must not re-append: `order` would gain a
      // second copy of the same id. Checked against a fresh read, not the
      // result of a write below, so a retry can never stomp a preview or a
      // rename something else already wrote to the stem's entry.
      const existing = await this.getRawItem(masterJobId);
      const existingOrder = Array.isArray(existing?.order) ? (existing!.order as unknown[]) : [];
      const alreadyOrdered = existingOrder.includes(id);
      const existingStems = (existing?.stems ?? {}) as Record<string, unknown>;
      const hasEntry = Object.prototype.hasOwnProperty.call(existingStems, id);

      if (alreadyOrdered && hasEntry) {
        return stemSetFromItem(existing as Record<string, unknown>);
      }

      const now = new Date().toISOString();
      const stem: StemEntry = {
        key, name: guessStemName(filename), previewKey: null, previewError: null, previewRequestedAt: null,
        durationSec: null, sampleRate: null, channels: null,
      };
      // `order` already has the id (a previous call's first write landed but
      // its second write didn't) — skip the append, go straight to writing
      // the entry below, so a retry can finish the job without duplicating it.
      const attrs = alreadyOrdered
        ? existing
        : await DynamoDBOperations.update({
            key: keyFor(masterJobId),
            updateExpression:
              'SET #order = list_append(if_not_exists(#order, :empty), :id), #stems = if_not_exists(#stems, :emptyMap), ' +
              '#mix = if_not_exists(#mix, :emptyMap), #masterJobId = :job, #type = :type, ' +
              '#createdAt = if_not_exists(#createdAt, :now), #updatedAt = :now',
            expressionAttributeNames: {
              '#order': 'order', '#stems': 'stems', '#mix': 'mix', '#masterJobId': 'masterJobId',
              '#type': 'Type', '#createdAt': 'createdAt', '#updatedAt': 'updatedAt',
            },
            expressionAttributeValues: {
              ':empty': [], ':id': [id], ':emptyMap': {}, ':job': masterJobId, ':type': 'STEMSET', ':now': now,
            },
          });
      // A second, separate update: a map entry cannot be SET in the same
      // expression that might be creating the map with if_not_exists.
      const after = hasEntry
        ? attrs
        : await DynamoDBOperations.update({
            key: keyFor(masterJobId),
            updateExpression: 'SET #stems.#sid = :stem',
            expressionAttributeNames: { '#stems': 'stems', '#sid': id },
            expressionAttributeValues: { ':stem': stem },
          });
      const source = (after && Array.isArray((after as Record<string, unknown>).order)) ? after : attrs;
      const set = stemSetFromItem((source ?? {}) as Record<string, unknown>);
      const stemCount = Array.isArray((source ?? {}).order) ? ((source ?? {}).order as unknown[]).length : set.order.length;
      await this.writeCount(masterJobId, stemCount);
      return set;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Record (or clear, with `null`) a stem's preview error — the same field
   * the worker itself writes from `makeStemPreview`, but reachable from the
   * route layer too: a worker invoke that never fires (Lambda throws before
   * the function runs) needs the SAME durable signal a failed render leaves,
   * or the row is stuck showing "Preparing listening copy…" forever with no
   * way to tell it apart from one that is genuinely still in progress.
   *
   * Conditional on the stem still existing, and — like the worker's own
   * write — a lost race against a concurrent removeStem is not an error
   * here: there is nothing left to annotate, so it is swallowed rather than
   * surfaced to the caller.
   */
  async setPreviewError(masterJobId: string, stemId: string, message: string | null): Promise<void> {
    try {
      await DynamoDBOperations.update({
        key: keyFor(masterJobId),
        updateExpression: 'SET #stems.#sid.#previewError = :err',
        conditionExpression: 'attribute_exists(#stems.#sid)',
        expressionAttributeNames: { '#stems': 'stems', '#sid': stemId, '#previewError': 'previewError' },
        expressionAttributeValues: { ':err': message },
      });
    } catch (error) {
      if ((error as Record<string, unknown>).name === 'ConditionalCheckFailedException') return;
      handleDynamoDBError(error);
    }
  }

  /**
   * Stamp `previewRequestedAt` on a stem whenever the route asks the worker
   * for its listening copy — first add or a Retry re-POST. Without this, a
   * worker that never writes previewKey/previewError back (old worker
   * without a stemPreview branch, a timeout, an OOM, a crash) leaves the row
   * stuck on "Preparing listening copy…" forever, indistinguishable from one
   * genuinely still rendering. Conditional + swallowed the same way as
   * setPreviewError: a lost race against a concurrent removeStem leaves
   * nothing to stamp.
   */
  async markPreviewRequested(masterJobId: string, stemId: string, nowIso: string): Promise<void> {
    try {
      await DynamoDBOperations.update({
        key: keyFor(masterJobId),
        updateExpression: 'SET #stems.#sid.#previewRequestedAt = :now',
        conditionExpression: 'attribute_exists(#stems.#sid)',
        expressionAttributeNames: { '#stems': 'stems', '#sid': stemId, '#previewRequestedAt': 'previewRequestedAt' },
        expressionAttributeValues: { ':now': nowIso },
      });
    } catch (error) {
      if ((error as Record<string, unknown>).name === 'ConditionalCheckFailedException') return;
      handleDynamoDBError(error);
    }
  }

  async renameStem(masterJobId: string, stemId: string, name: string): Promise<void> {
    try {
      await DynamoDBOperations.update({
        key: keyFor(masterJobId),
        updateExpression: 'SET #stems.#sid.#name = :name, #updatedAt = :now',
        conditionExpression: 'attribute_exists(#stems.#sid)',
        expressionAttributeNames: { '#stems': 'stems', '#sid': stemId, '#name': 'name', '#updatedAt': 'updatedAt' },
        expressionAttributeValues: { ':name': name.trim().slice(0, 80) || 'Stem', ':now': new Date().toISOString() },
      });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async removeStem(masterJobId: string, stemId: string): Promise<void> {
    try {
      let attempt = 0;
      const maxAttempts = 3;
      while (true) {
        const rawItem = await this.getRawItem(masterJobId);
        if (!rawItem) return;
        const prevOrder = Array.isArray(rawItem.order) ? rawItem.order : [];
        const newOrder = prevOrder.filter((id): id is string => typeof id === 'string' && id !== stemId);
        try {
          await DynamoDBOperations.update({
            key: keyFor(masterJobId),
            updateExpression: 'REMOVE #stems.#sid, #mix.#sid SET #order = :order, #updatedAt = :now',
            conditionExpression: '#order = :prev',
            expressionAttributeNames: { '#stems': 'stems', '#mix': 'mix', '#sid': stemId, '#order': 'order', '#updatedAt': 'updatedAt' },
            expressionAttributeValues: { ':order': newOrder, ':prev': prevOrder, ':now': new Date().toISOString() },
          });
          await this.writeCount(masterJobId, newOrder.length);
          return;
        } catch (error) {
          attempt++;
          if (attempt >= maxAttempts || (error as Record<string, unknown>).name !== 'ConditionalCheckFailedException') {
            throw error;
          }
        }
      }
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /** Read the raw DynamoDB item without hydration/filtering. */
  private async getRawItem(masterJobId: string): Promise<Record<string, unknown> | null> {
    const item = await DynamoDBOperations.get(keyFor(masterJobId));
    return item ? (item as Record<string, unknown>) : null;
  }

  /** `stemCount` on the master — and nothing else; never its updatedAt. */
  private async writeCount(masterJobId: string, n: number): Promise<void> {
    await DynamoDBOperations.update({
      key: { PK: `MASTERJOB#${masterJobId}`, SK: 'METADATA' },
      updateExpression: 'SET #stemCount = :n',
      expressionAttributeNames: { '#stemCount': 'stemCount' },
      expressionAttributeValues: { ':n': n },
    });
  }
}
