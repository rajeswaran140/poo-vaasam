/**
 * DynamoDB implementation of the lyric-lexicon repository. Single-table:
 *   PK = LEXICON#<id>, SK = METADATA, Type = 'LEXICON'
 * Mirrors CategoryRepository (a simple CRUD entity, listed via a Type scan).
 */

import { ILexiconRepository } from '@/domain/repositories/ILexiconRepository';
import type { LexiconWord, LexiconWordInput, LexiconWordUpdate } from '@/types/lexicon';
import { normalizeWord } from '@/types/lexicon';
import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';

export class LexiconRepository implements ILexiconRepository {
  async create(input: LexiconWordInput): Promise<LexiconWord> {
    try {
      const now = new Date();
      const word: LexiconWord = {
        id: this.generateId(),
        word: normalizeWord(input.word),
        romanization: input.romanization,
        gloss: input.gloss,
        register: input.register,
        usage: input.usage,
        themes: input.themes ?? [],
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
      const response = await DynamoDBOperations.scan({
        filterExpression: '#type = :type AND #word = :word',
        expressionAttributeNames: { '#type': 'Type', '#word': 'word' },
        expressionAttributeValues: { ':type': 'LEXICON', ':word': normalizeWord(word) },
        limit: 1,
      });
      const items = response.Items || [];
      return items.length > 0 ? this.fromDBItem(items[0]) : null;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async findAll(): Promise<LexiconWord[]> {
    try {
      const response = await DynamoDBOperations.scan({
        filterExpression: '#type = :type',
        expressionAttributeNames: { '#type': 'Type' },
        expressionAttributeValues: { ':type': 'LEXICON' },
      });
      const items = response.Items || [];
      return items.map((i) => this.fromDBItem(i)).sort((a, b) => a.word.localeCompare(b.word, 'ta'));
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async update(id: string, updates: LexiconWordUpdate): Promise<LexiconWord> {
    try {
      const existing = await this.findById(id);
      if (!existing) throw new Error(`Lexicon word ${id} not found`);

      const merged: LexiconWord = {
        ...existing,
        ...(updates.word !== undefined ? { word: normalizeWord(updates.word) } : {}),
        ...(updates.romanization !== undefined ? { romanization: updates.romanization ?? undefined } : {}),
        ...(updates.gloss !== undefined ? { gloss: updates.gloss } : {}),
        ...(updates.register !== undefined ? { register: updates.register } : {}),
        ...(updates.usage !== undefined ? { usage: updates.usage } : {}),
        ...(updates.themes !== undefined ? { themes: updates.themes } : {}),
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
      id: w.id,
      word: w.word,
      romanization: w.romanization,
      gloss: w.gloss,
      register: w.register,
      usage: w.usage,
      themes: w.themes,
      usageCount: w.usageCount,
      notes: w.notes,
      archived: w.archived,
      createdAt: w.createdAt.toISOString(),
      updatedAt: w.updatedAt.toISOString(),
    };
  }

  private fromDBItem(item: any): LexiconWord {
    return {
      id: item.id,
      word: item.word,
      romanization: item.romanization || undefined,
      gloss: item.gloss,
      register: item.register,
      usage: item.usage,
      themes: Array.isArray(item.themes) ? item.themes : [],
      usageCount: typeof item.usageCount === 'number' ? item.usageCount : 0,
      notes: item.notes || undefined,
      archived: !!item.archived,
      createdAt: new Date(item.createdAt),
      updatedAt: new Date(item.updatedAt),
    };
  }
}
