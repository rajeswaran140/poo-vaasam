/**
 * DynamoDB implementation of the lyric-lexicon repository. Single-table:
 *   PK = LEXICON#<id>, SK = METADATA, Type = 'LEXICON'
 * Mirrors CategoryRepository (a simple CRUD entity, listed via a Type scan).
 */

import { ILexiconRepository } from '@/domain/repositories/ILexiconRepository';
import type { LexiconWord, LexiconWordInput, LexiconWordUpdate } from '@/types/lexicon';
import { normalizeWord } from '@/types/lexicon';
import { matchKey } from '@/lib/tamil-normalize';
import { migrateUsage, resolveRegisters } from '@/lib/lexicon-migrate';
import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';

export class LexiconRepository implements ILexiconRepository {
  async create(input: LexiconWordInput): Promise<LexiconWord> {
    try {
      const now = new Date();
      const stored = normalizeWord(input.word);
      const word: LexiconWord = {
        id: this.generateId(),
        word: stored,
        normalizedWord: matchKey(stored),
        romanization: input.romanization,
        gloss: input.gloss,
        tamilMeaning: input.tamilMeaning,
        register: input.register,
        registers: input.registers,
        wordType: input.wordType,
        lexicalStatus: input.lexicalStatus,
        confidence: input.confidence,
        usage: input.usage,
        themes: input.themes ?? [],
        moods: input.moods ?? [],
        synonyms: input.synonyms ?? [],
        relatedWords: input.relatedWords ?? [],
        antonyms: input.antonyms ?? [],
        etukai: input.etukai ?? [],
        monai: input.monai ?? [],
        rhymesWith: input.rhymesWith ?? [],
        semanticFamily: input.semanticFamily ?? [],
        poeticUsage: input.poeticUsage,
        examples: input.examples ?? [],
        usageCount: 0,
        notes: input.notes,
        archived: false,
        createdAt: now,
        updatedAt: now,
      };
      await DynamoDBOperations.put(this.toDBItem(word));
      return word;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async findById(id: string): Promise<LexiconWord | null> {
    try {
      const item = await DynamoDBOperations.get({ PK: `LEXICON#${id}`, SK: 'METADATA' });
      return item ? this.fromDBItem(item) : null;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async findByWord(word: string): Promise<LexiconWord | null> {
    try {
      const w = normalizeWord(word);
      // Exact headword lookup via GSI1 (no scan). The `#` delimiter prevents
      // prefix collisions (e.g. "amma#" never matches "ammaa#…").
      const res = await DynamoDBOperations.query({
        keyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        expressionAttributeValues: { ':pk': 'LEXICON', ':sk': `${w}#` },
        indexName: 'GSI1',
        limit: 1,
      });
      const items = res.Items || [];
      return items.length > 0 ? this.fromDBItem(items[0]) : null;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  // Defensive bound on pagination — a personal lexicon is tiny in bytes (each
  // 1MB page holds thousands of words), so this is a runaway guard, not a cap
  // that would realistically truncate.
  private static readonly MAX_PAGES = 100;

  async findAll(): Promise<LexiconWord[]> {
    try {
      const items: Record<string, unknown>[] = [];
      let startKey: Record<string, unknown> | undefined;
      let pages = 0;
      do {
        const res = await DynamoDBOperations.query({
          keyConditionExpression: 'GSI1PK = :pk',
          expressionAttributeValues: { ':pk': 'LEXICON' },
          indexName: 'GSI1',
          exclusiveStartKey: startKey,
        });
        items.push(...((res.Items as Record<string, unknown>[]) || []));
        startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (startKey && ++pages < LexiconRepository.MAX_PAGES);
      return items.map((i) => this.fromDBItem(i)).sort((a, b) => a.word.localeCompare(b.word, 'ta'));
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async update(id: string, updates: LexiconWordUpdate): Promise<LexiconWord> {
    try {
      const existing = await this.findById(id);
      if (!existing) throw new Error(`Lexicon word ${id} not found`);

      // On a rename, guard headword uniqueness (create already 409s on dupes;
      // this closes the gap where an edit could collide with another word).
      if (updates.word !== undefined) {
        const newWord = normalizeWord(updates.word);
        if (newWord !== existing.word) {
          const clash = await this.findByWord(newWord);
          if (clash && clash.id !== id) {
            const err = new Error('Word already exists');
            (err as Error & { code?: string }).code = 'DUPLICATE_WORD';
            throw err;
          }
        }
      }

      // A renamed word needs its derived match key rebuilt alongside it.
      const renamed = updates.word !== undefined ? normalizeWord(updates.word) : undefined;

      const merged: LexiconWord = {
        ...existing,
        ...(renamed !== undefined ? { word: renamed, normalizedWord: matchKey(renamed) } : {}),
        ...(updates.romanization !== undefined ? { romanization: updates.romanization ?? undefined } : {}),
        ...(updates.gloss !== undefined ? { gloss: updates.gloss } : {}),
        ...(updates.tamilMeaning !== undefined ? { tamilMeaning: updates.tamilMeaning ?? undefined } : {}),
        ...(updates.registers !== undefined
          ? { registers: updates.registers, register: updates.registers[0] }
          : {}),
        ...(updates.wordType !== undefined ? { wordType: updates.wordType } : {}),
        ...(updates.lexicalStatus !== undefined ? { lexicalStatus: updates.lexicalStatus } : {}),
        ...(updates.confidence !== undefined ? { confidence: updates.confidence } : {}),
        ...(updates.usage !== undefined ? { usage: updates.usage } : {}),
        ...(updates.themes !== undefined ? { themes: updates.themes } : {}),
        ...(updates.moods !== undefined ? { moods: updates.moods } : {}),
        ...(updates.synonyms !== undefined ? { synonyms: updates.synonyms } : {}),
        ...(updates.relatedWords !== undefined ? { relatedWords: updates.relatedWords } : {}),
        ...(updates.antonyms !== undefined ? { antonyms: updates.antonyms } : {}),
        ...(updates.etukai !== undefined ? { etukai: updates.etukai } : {}),
        ...(updates.monai !== undefined ? { monai: updates.monai } : {}),
        ...(updates.rhymesWith !== undefined ? { rhymesWith: updates.rhymesWith } : {}),
        ...(updates.semanticFamily !== undefined ? { semanticFamily: updates.semanticFamily } : {}),
        ...(updates.poeticUsage !== undefined ? { poeticUsage: updates.poeticUsage ?? undefined } : {}),
        ...(updates.examples !== undefined ? { examples: updates.examples } : {}),
        ...(updates.notes !== undefined ? { notes: updates.notes ?? undefined } : {}),
        ...(updates.archived !== undefined ? { archived: updates.archived } : {}),
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: new Date(),
      };
      await DynamoDBOperations.put(this.toDBItem(merged));
      return merged;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await DynamoDBOperations.delete({ PK: `LEXICON#${id}`, SK: 'METADATA' });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  private generateId(): string {
    return `lex_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  private toDBItem(w: LexiconWord): Record<string, any> {
    return {
      PK: `LEXICON#${w.id}`,
      SK: 'METADATA',
      Type: 'LEXICON',
      // Reuse the existing GSI1 so the lexicon can be listed with a cheap,
      // paginated query (GSI1PK='LEXICON') instead of a full-table scan. The
      // `word#id` sort key keeps the list ordered and lets findByWord do an
      // exact lookup via begins_with(`<word>#`).
      GSI1PK: 'LEXICON',
      GSI1SK: `${w.word}#${w.id}`,
      id: w.id,
      word: w.word,
      normalizedWord: w.normalizedWord,
      romanization: w.romanization,
      gloss: w.gloss,
      tamilMeaning: w.tamilMeaning,
      // `register` (scalar) is written alongside `registers` so that a rollback
      // to the previous deploy still reads a valid row, and so the GSI-adjacent
      // shape never changes underneath 1,047 existing items.
      register: w.register,
      registers: w.registers,
      wordType: w.wordType,
      lexicalStatus: w.lexicalStatus,
      confidence: w.confidence,
      usage: w.usage,
      themes: w.themes,
      moods: w.moods,
      synonyms: w.synonyms,
      relatedWords: w.relatedWords,
      antonyms: w.antonyms,
      etukai: w.etukai,
      monai: w.monai,
      rhymesWith: w.rhymesWith,
      semanticFamily: w.semanticFamily,
      poeticUsage: w.poeticUsage,
      examples: w.examples,
      usageCount: w.usageCount,
      notes: w.notes,
      archived: w.archived,
      createdAt: w.createdAt.toISOString(),
      updatedAt: w.updatedAt.toISOString(),
    };
  }

  /** An array attribute that may be absent on a legacy row. */
  private list(v: unknown): string[] {
    return Array.isArray(v) ? (v as string[]) : [];
  }

  /**
   * Read one stored item. EVERY field added after the original shape is
   * tolerated as absent, because the table holds 1,047 rows written before they
   * existed and none of them are being back-filled:
   *   - `registers` falls back to the legacy scalar `register`
   *   - `usage` maps the retired `neutral`/`retire` values forward
   *   - `normalizedWord` is derived on the fly when missing, so search and
   *     duplicate detection work on legacy rows without a migration pass
   */
  private fromDBItem(item: any): LexiconWord {
    const registers = resolveRegisters(item.registers, item.register);
    return {
      id: item.id,
      word: item.word,
      normalizedWord: item.normalizedWord || matchKey(item.word ?? ''),
      romanization: item.romanization || undefined,
      gloss: item.gloss,
      tamilMeaning: item.tamilMeaning || undefined,
      register: registers[0],
      registers,
      wordType: item.wordType || undefined,
      lexicalStatus: item.lexicalStatus || undefined,
      confidence: item.confidence || undefined,
      usage: migrateUsage(item.usage),
      themes: this.list(item.themes),
      moods: this.list(item.moods) as LexiconWord['moods'],
      synonyms: this.list(item.synonyms),
      relatedWords: this.list(item.relatedWords),
      antonyms: this.list(item.antonyms),
      etukai: this.list(item.etukai),
      monai: this.list(item.monai),
      rhymesWith: this.list(item.rhymesWith),
      semanticFamily: this.list(item.semanticFamily),
      poeticUsage: item.poeticUsage || undefined,
      examples: this.list(item.examples),
      usageCount: typeof item.usageCount === 'number' ? item.usageCount : 0,
      notes: item.notes || undefined,
      archived: !!item.archived,
      createdAt: new Date(item.createdAt),
      updatedAt: new Date(item.updatedAt),
    };
  }
}
