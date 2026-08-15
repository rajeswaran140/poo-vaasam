/**
 * DynamoDB persistence for the Composition Notebook. Single-table,
 * item-per-version — the same shape `LyricDraftRepository` already uses, so the
 * two read the same way and neither invents its own convention:
 *
 *   PK = COMPOSITION#<id>, SK = METADATA           → title/status/working spec
 *   PK = COMPOSITION#<id>, SK = VERSION#<nnnnnn>   → one immutable snapshot
 *
 * The metadata item carries GSI1PK='COMPOSITION' + GSI1SK='<updatedAt>#<id>'
 * (the shared GSI1, as Lexicon and LyricDraft do) so the list is a cheap query
 * rather than a table scan, ordered by recency.
 *
 * ⚠️ VERSIONS ARE NEVER REWRITTEN. `update` touches only the METADATA item;
 * `addVersion` only ever puts a new VERSION item. §16 — earlier creative
 * decisions must survive later ones, which is the entire reason a composer
 * keeps a notebook instead of a single editable field.
 */

import { ICompositionRepository } from '@/domain/repositories/ICompositionRepository';
import type {
  Composition,
  CompositionSpec,
  CompositionSummary,
  CompositionVersion,
  CreateCompositionInput,
  UpdateCompositionInput,
  AddCompositionVersionInput,
} from '@/types/composition';
import { defaultVersionLabel } from '@/types/composition';
import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';

const META_SK = 'METADATA';
// Zero-padded so lexicographic SK order equals numeric version order.
const versionSk = (n: number) => `VERSION#${String(n).padStart(6, '0')}`;

export class CompositionRepository implements ICompositionRepository {
  async create(input: CreateCompositionInput): Promise<Composition> {
    try {
      const now = new Date();
      const id = this.generateId();
      const composition: Composition = {
        id,
        title: input.title,
        status: input.status ?? 'idea',
        spec: input.spec ?? {},
        versions: [],
        createdAt: now,
        updatedAt: now,
      };
      await DynamoDBOperations.put(this.metaItem(composition));
      return composition;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async findById(id: string): Promise<Composition | null> {
    try {
      const res = await DynamoDBOperations.query({
        keyConditionExpression: 'PK = :pk',
        expressionAttributeValues: { ':pk': `COMPOSITION#${id}` },
      });
      const items = (res.Items as Record<string, unknown>[]) || [];
      const meta = items.find((i) => i.SK === META_SK);
      if (!meta) return null;

      const versions = items
        .filter((i) => typeof i.SK === 'string' && (i.SK as string).startsWith('VERSION#'))
        .map((i) => this.fromVersionItem(i))
        .sort((a, b) => a.version - b.version);

      return { ...this.fromMetaItem(meta), versions };
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  private static readonly MAX_PAGES = 50;

  async list(): Promise<CompositionSummary[]> {
    try {
      const items: Record<string, unknown>[] = [];
      let startKey: Record<string, unknown> | undefined;
      let pages = 0;
      do {
        const res = await DynamoDBOperations.query({
          keyConditionExpression: 'GSI1PK = :pk',
          expressionAttributeValues: { ':pk': 'COMPOSITION' },
          indexName: 'GSI1',
          exclusiveStartKey: startKey,
        });
        items.push(...((res.Items as Record<string, unknown>[]) || []));
        startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (startKey && ++pages < CompositionRepository.MAX_PAGES);

      return items
        .map((i) => {
          const c = this.fromMetaItem(i);
          return {
            id: c.id,
            title: c.title,
            status: c.status,
            versionCount: typeof i.versionCount === 'number' ? i.versionCount : 0,
            bpm: c.spec.bpm,
            meter: c.spec.meter,
            tonic: c.spec.tonic,
            updatedAt: c.updatedAt,
          };
        })
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async update(id: string, updates: UpdateCompositionInput): Promise<Composition> {
    try {
      const existing = await this.findById(id);
      if (!existing) throw new Error(`Composition ${id} not found`);

      const merged: Composition = {
        ...existing,
        ...(updates.title !== undefined ? { title: updates.title } : {}),
        ...(updates.status !== undefined ? { status: updates.status } : {}),
        // The spec is merged field-by-field, so a partial save (the tempo box
        // alone) cannot wipe the fields the form did not send.
        ...(updates.spec !== undefined ? { spec: { ...existing.spec, ...updates.spec } } : {}),
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: new Date(),
      };
      await DynamoDBOperations.put(this.metaItem(merged, existing.versions.length));
      return merged;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async addVersion(id: string, input: AddCompositionVersionInput): Promise<Composition> {
    try {
      const existing = await this.findById(id);
      if (!existing) throw new Error(`Composition ${id} not found`);

      const next = existing.versions.length + 1;
      const version: CompositionVersion = {
        version: next,
        label: input.label?.trim() || defaultVersionLabel(next),
        // Snapshot the supplied spec, or the current working state.
        spec: (input.spec ?? existing.spec) as CompositionSpec,
        note: input.note,
        createdAt: new Date(),
      };

      await DynamoDBOperations.put(this.versionItem(id, version));
      // Touch the metadata so the list re-sorts and the count stays right.
      const updated: Composition = {
        ...existing,
        versions: [...existing.versions, version],
        updatedAt: new Date(),
      };
      await DynamoDBOperations.put(this.metaItem(updated, updated.versions.length));
      return updated;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const existing = await this.findById(id);
      if (!existing) return;
      // Versions first, then the metadata — if this is interrupted, what
      // remains is a findable record with fewer versions rather than orphaned
      // version items with no metadata to reach them by.
      for (const v of existing.versions) {
        await DynamoDBOperations.delete({ PK: `COMPOSITION#${id}`, SK: versionSk(v.version) });
      }
      await DynamoDBOperations.delete({ PK: `COMPOSITION#${id}`, SK: META_SK });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  private generateId(): string {
    return `cmp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  private metaItem(c: Composition, versionCount = c.versions.length): Record<string, unknown> {
    return {
      PK: `COMPOSITION#${c.id}`,
      SK: META_SK,
      Type: 'COMPOSITION',
      GSI1PK: 'COMPOSITION',
      GSI1SK: `${c.updatedAt.toISOString()}#${c.id}`,
      id: c.id,
      title: c.title,
      status: c.status,
      spec: c.spec,
      versionCount,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }

  private versionItem(id: string, v: CompositionVersion): Record<string, unknown> {
    return {
      PK: `COMPOSITION#${id}`,
      SK: versionSk(v.version),
      Type: 'COMPOSITION_VERSION',
      version: v.version,
      label: v.label,
      spec: v.spec,
      note: v.note,
      createdAt: v.createdAt.toISOString(),
    };
  }

  private fromMetaItem(item: Record<string, unknown>): Composition {
    return {
      id: item.id as string,
      title: item.title as string,
      status: (item.status as Composition['status']) ?? 'idea',
      spec: (item.spec as CompositionSpec) ?? {},
      versions: [],
      createdAt: new Date(item.createdAt as string),
      updatedAt: new Date(item.updatedAt as string),
    };
  }

  private fromVersionItem(item: Record<string, unknown>): CompositionVersion {
    return {
      version: item.version as number,
      label: (item.label as string) || defaultVersionLabel(item.version as number),
      spec: (item.spec as CompositionSpec) ?? {},
      note: (item.note as string) || undefined,
      createdAt: new Date(item.createdAt as string),
    };
  }
}
