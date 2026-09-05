/**
 * DynamoDB implementation of the saved-SUNO-prompt store. Single-table:
 *   PK = SUNOPROMPT#<id>, SK = METADATA, Type = 'SUNO_PROMPT'
 * Mirrors LexiconRepository — a simple CRUD entity listed via a GSI1 query
 * rather than a table scan.
 *
 * GSI1SK is `<createdAt ISO>#<id>`, so a descending query returns newest first
 * without sorting in memory. The id suffix keeps the key unique when two
 * prompts are saved inside the same millisecond.
 *
 * ⚠️ audioInfluence is written ONLY when usesAudioUpload is true, and is
 * stripped when audio upload is switched off. Suno shows that control only for
 * an audio upload, so a stored value on a lyrics-only prompt would be a number
 * with nowhere to go. Storing 0 instead of nothing would be worse — it reads as
 * a deliberate "none" rather than "not applicable". See types/sunoPrompt.ts.
 */

import type { SunoPrompt, SunoPromptInput, SunoPromptUpdate } from '@/types/sunoPrompt';
import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';

export class SunoPromptRepository {
  /** Runaway guard on pagination, matching the other admin list reads. */
  private static readonly MAX_PAGES = 100;

  async create(input: SunoPromptInput): Promise<SunoPrompt> {
    try {
      const now = new Date();
      const prompt: SunoPrompt = {
        id: this.generateId(),
        title: input.title,
        lyrics: input.lyrics,
        style: input.style,
        styleBox: input.styleBox ?? '',
        exclude: input.exclude ?? [],
        lyricsBlock: input.lyricsBlock ?? '',
        weirdness: input.weirdness,
        styleInfluence: input.styleInfluence,
        usesAudioUpload: input.usesAudioUpload,
        ...(input.usesAudioUpload && input.audioInfluence !== undefined
          ? { audioInfluence: input.audioInfluence }
          : {}),
        createdAt: now,
        updatedAt: now,
      };
      await DynamoDBOperations.put(this.toDBItem(prompt));
      return prompt;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async findAll(): Promise<SunoPrompt[]> {
    try {
      const items: Record<string, unknown>[] = [];
      let startKey: Record<string, unknown> | undefined;
      let pages = 0;
      do {
        const res = await DynamoDBOperations.query({
          keyConditionExpression: 'GSI1PK = :pk',
          expressionAttributeValues: { ':pk': 'SUNO_PROMPT' },
          indexName: 'GSI1',
          scanIndexForward: false, // newest first
          exclusiveStartKey: startKey,
        });
        items.push(...((res.Items as Record<string, unknown>[]) || []));
        startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (startKey && ++pages < SunoPromptRepository.MAX_PAGES);
      return items.map((i) => this.fromDBItem(i));
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async findById(id: string): Promise<SunoPrompt | null> {
    try {
      // DynamoDBOperations.get returns response.Item itself, not { Item }.
      const item = await DynamoDBOperations.get({ PK: `SUNOPROMPT#${id}`, SK: 'METADATA' });
      return item ? this.fromDBItem(item as Record<string, unknown>) : null;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async update(id: string, patch: SunoPromptUpdate): Promise<SunoPrompt | null> {
    try {
      const current = await this.findById(id);
      if (!current) return null;

      const usesAudioUpload = patch.usesAudioUpload ?? current.usesAudioUpload;
      // Turning audio upload off removes the value; it is not merely hidden.
      const audioInfluence = !usesAudioUpload
        ? undefined
        : patch.audioInfluence === null
          ? undefined
          : (patch.audioInfluence ?? current.audioInfluence);

      const next: SunoPrompt = {
        ...current,
        ...(patch.title !== undefined && { title: patch.title }),
        ...(patch.lyrics !== undefined && { lyrics: patch.lyrics }),
        ...(patch.style !== undefined && { style: patch.style }),
        ...(patch.styleBox !== undefined && { styleBox: patch.styleBox }),
        ...(patch.exclude !== undefined && { exclude: patch.exclude }),
        ...(patch.lyricsBlock !== undefined && { lyricsBlock: patch.lyricsBlock }),
        ...(patch.weirdness !== undefined && { weirdness: patch.weirdness }),
        ...(patch.styleInfluence !== undefined && { styleInfluence: patch.styleInfluence }),
        usesAudioUpload,
        updatedAt: new Date(),
      };
      delete next.audioInfluence;
      if (audioInfluence !== undefined) next.audioInfluence = audioInfluence;

      await DynamoDBOperations.put(this.toDBItem(next));
      return next;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const current = await this.findById(id);
      if (!current) return false;
      await DynamoDBOperations.delete({ PK: `SUNOPROMPT#${id}`, SK: 'METADATA' });
      return true;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  private generateId(): string {
    return `snp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  private toDBItem(p: SunoPrompt): Record<string, unknown> {
    return {
      PK: `SUNOPROMPT#${p.id}`,
      SK: 'METADATA',
      Type: 'SUNO_PROMPT',
      GSI1PK: 'SUNO_PROMPT',
      GSI1SK: `${p.createdAt.toISOString()}#${p.id}`,
      id: p.id,
      title: p.title,
      lyrics: p.lyrics,
      style: p.style,
      styleBox: p.styleBox,
      exclude: p.exclude,
      lyricsBlock: p.lyricsBlock,
      weirdness: p.weirdness,
      styleInfluence: p.styleInfluence,
      usesAudioUpload: p.usesAudioUpload,
      // Left off entirely rather than written as null/0 — see the header note.
      ...(p.audioInfluence !== undefined ? { audioInfluence: p.audioInfluence } : {}),
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  private fromDBItem(i: Record<string, unknown>): SunoPrompt {
    const usesAudioUpload = Boolean(i.usesAudioUpload);
    return {
      id: String(i.id),
      title: String(i.title ?? ''),
      lyrics: String(i.lyrics ?? ''),
      style: String(i.style ?? ''),
      styleBox: String(i.styleBox ?? ''),
      exclude: Array.isArray(i.exclude) ? (i.exclude as string[]) : [],
      lyricsBlock: String(i.lyricsBlock ?? ''),
      weirdness: Number(i.weirdness ?? 0),
      styleInfluence: Number(i.styleInfluence ?? 0),
      usesAudioUpload,
      // A stray stored value on a lyrics-only row is ignored, not surfaced.
      ...(usesAudioUpload && i.audioInfluence !== undefined && i.audioInfluence !== null
        ? { audioInfluence: Number(i.audioInfluence) }
        : {}),
      createdAt: new Date(String(i.createdAt)),
      updatedAt: new Date(String(i.updatedAt)),
    };
  }
}
