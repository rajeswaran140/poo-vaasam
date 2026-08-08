/**
 * DynamoDB persistence for lyric drafts. Single-table, item-per-version:
 *   PK = LYRICDRAFT#<id>, SK = METADATA            → the draft (title/status/…)
 *   PK = LYRICDRAFT#<id>, SK = VERSION#<nnnnnn>     → one immutable snapshot
 *
 * The metadata item also carries GSI1PK='LYRICDRAFT' + GSI1SK='<updatedAt>#<id>'
 * (reusing the shared GSI1, like LexiconRepository) so the drafts list is a
 * cheap recency-ordered query — newest-edited first — with no full-table scan.
 * Versions are read by querying the draft's partition (PK) directly.
 */

import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';
import {
  draftSnippet,
  type AddVersionInput,
  type CreateLyricDraftInput,
  type LyricDraft,
  type LyricDraftSummary,
  type LyricDraftVersion,
  type UpdateLyricDraftMetaInput,
} from '@/types/lyricDraft';

const pk = (id: string) => `LYRICDRAFT#${id}`;
const META_SK = 'METADATA';
// Zero-padded so lexicographic SK order == numeric version order.
const versionSk = (n: number) => `VERSION#${String(n).padStart(6, '0')}`;

export class LyricDraftRepository {
  async create(input: CreateLyricDraftInput): Promise<LyricDraft> {
    try {
      const now = new Date().toISOString();
      const id = this.generateId();
      const version: LyricDraftVersion = {
        version: 1,
        lyrics: input.lyrics,
        focus: input.focus ?? [],
        notes: input.notes,
        critique: input.critique ?? null,
        critiquedAt: input.critique ? now : undefined,
        createdAt: now,
      };
      const draft: LyricDraft = {
        id,
        title: input.title,
        theme: input.theme,
        status: 'draft',
        latestVersion: 1,
        createdAt: now,
        updatedAt: now,
        versions: [version],
      };
      await DynamoDBOperations.put(this.metaItem(draft, draftSnippet(input.lyrics)));
      await DynamoDBOperations.put(this.versionItem(id, version));
      return draft;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async list(): Promise<LyricDraftSummary[]> {
    try {
      const res = await DynamoDBOperations.query({
        keyConditionExpression: 'GSI1PK = :pk',
        expressionAttributeValues: { ':pk': 'LYRICDRAFT' },
        indexName: 'GSI1',
        scanIndexForward: false, // newest updatedAt first
      });
      return ((res.Items as Record<string, any>[]) || []).map((i) => ({
        id: i.id,
        title: i.title,
        theme: i.theme || undefined,
        status: i.status,
        latestVersion: i.latestVersion,
        snippet: i.snippet || '',
        updatedAt: i.updatedAt,
      }));
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async get(id: string): Promise<LyricDraft | null> {
    try {
      const res = await DynamoDBOperations.query({
        keyConditionExpression: 'PK = :pk',
        expressionAttributeValues: { ':pk': pk(id) },
      });
      const items = (res.Items as Record<string, any>[]) || [];
      const meta = items.find((i) => i.SK === META_SK);
      if (!meta) return null;
      const versions = items
        .filter((i) => typeof i.SK === 'string' && i.SK.startsWith('VERSION#'))
        .map((i) => this.fromVersionItem(i))
        .sort((a, b) => a.version - b.version);
      return {
        id: meta.id,
        title: meta.title,
        theme: meta.theme || undefined,
        status: meta.status,
        latestVersion: meta.latestVersion,
        workingLyrics: meta.workingLyrics || undefined,
        workingUpdatedAt: meta.workingUpdatedAt || undefined,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        versions,
      };
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async addVersion(id: string, input: AddVersionInput): Promise<LyricDraft> {
    try {
      const existing = await this.get(id);
      if (!existing) throw new Error(`Lyric draft ${id} not found`);
      const now = new Date().toISOString();
      const n = existing.latestVersion + 1;
      const version: LyricDraftVersion = {
        version: n,
        lyrics: input.lyrics,
        focus: input.focus ?? [],
        notes: input.notes,
        critique: input.critique ?? null,
        critiquedAt: input.critique ? now : undefined,
        createdAt: now,
      };
      await DynamoDBOperations.put(this.versionItem(id, version));
      const updated: LyricDraft = {
        ...existing,
        latestVersion: n,
        updatedAt: now,
        // The working copy IS this version now — clearing it stops the editor
        // offering to "restore unsaved work" that was just filed.
        workingLyrics: undefined,
        workingUpdatedAt: undefined,
        versions: [...existing.versions, version],
      };
      await DynamoDBOperations.put(this.metaItem(updated, draftSnippet(input.lyrics)));
      return updated;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async updateMeta(id: string, updates: UpdateLyricDraftMetaInput): Promise<LyricDraft> {
    try {
      const existing = await this.get(id);
      if (!existing) throw new Error(`Lyric draft ${id} not found`);
      const now = new Date().toISOString();
      const merged: LyricDraft = {
        ...existing,
        ...(updates.title !== undefined ? { title: updates.title } : {}),
        ...(updates.theme !== undefined ? { theme: updates.theme } : {}),
        ...(updates.status !== undefined ? { status: updates.status } : {}),
        // Autosave target — overwritten in place, never versioned.
        ...(updates.workingLyrics !== undefined
          ? { workingLyrics: updates.workingLyrics, workingUpdatedAt: now }
          : {}),
        updatedAt: now,
      };
      const latestLyrics =
        existing.versions.find((v) => v.version === existing.latestVersion)?.lyrics ?? '';
      await DynamoDBOperations.put(this.metaItem(merged, draftSnippet(latestLyrics)));
      return merged;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const res = await DynamoDBOperations.query({
        keyConditionExpression: 'PK = :pk',
        expressionAttributeValues: { ':pk': pk(id) },
      });
      for (const item of (res.Items as Record<string, any>[]) || []) {
        await DynamoDBOperations.delete({ PK: item.PK, SK: item.SK });
      }
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  private generateId(): string {
    return `draft_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  private metaItem(d: LyricDraft, snippet: string): Record<string, any> {
    return {
      PK: pk(d.id),
      SK: META_SK,
      Type: 'LYRICDRAFT',
      GSI1PK: 'LYRICDRAFT',
      GSI1SK: `${d.updatedAt}#${d.id}`,
      id: d.id,
      title: d.title,
      theme: d.theme,
      status: d.status,
      latestVersion: d.latestVersion,
      snippet,
      // Autosave target. metaItem enumerates fields rather than spreading, so a
      // new field is silently dropped unless added here — this one was.
      workingLyrics: d.workingLyrics,
      workingUpdatedAt: d.workingUpdatedAt,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  }

  private versionItem(id: string, v: LyricDraftVersion): Record<string, any> {
    return {
      PK: pk(id),
      SK: versionSk(v.version),
      Type: 'LYRICDRAFTVERSION',
      version: v.version,
      lyrics: v.lyrics,
      focus: v.focus,
      notes: v.notes,
      critique: v.critique ?? null,
      critiquedAt: v.critiquedAt,
      createdAt: v.createdAt,
    };
  }

  private fromVersionItem(i: Record<string, any>): LyricDraftVersion {
    return {
      version: i.version,
      lyrics: i.lyrics,
      focus: Array.isArray(i.focus) ? i.focus : [],
      notes: i.notes || undefined,
      critique: i.critique ?? null,
      critiquedAt: i.critiquedAt || undefined,
      createdAt: i.createdAt,
    };
  }
}
