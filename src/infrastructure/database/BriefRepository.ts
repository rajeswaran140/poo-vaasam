/**
 * Persistence for saved production briefs (Music Director, Phase 2).
 *
 * Single-table design alongside content: PK=`BRIEF#<id>` / SK=`METADATA`,
 * listed newest-first via GSI1 (partition `BRIEF#ALL`). The brief is stored
 * as the durable source of truth; engine prompts live inside `analysis` as
 * derived renderings.
 */

import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';
import type { SavedBrief, CreateBriefDTO } from '@/types/brief';
import { DEFAULT_MODEL } from '@/services/ai/composer';

const GSI1_PARTITION = 'BRIEF#ALL';

export class BriefRepository {
  /** Persist a new brief and return the stored record. */
  async save(dto: CreateBriefDTO): Promise<SavedBrief> {
    try {
      const now = new Date().toISOString();
      const id = `brief_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      const brief: SavedBrief = {
        id,
        createdAt: now,
        updatedAt: now,
        lyrics: dto.lyrics,
        analysis: dto.analysis,
        // Provenance: the model the composer is currently configured to use.
        model: DEFAULT_MODEL,
        contentId: dto.contentId,
        decision: dto.decision ?? {},
        outcome: null,
        embedding: null,
      };
      await DynamoDBOperations.put(this.toDBItem(brief));
      return brief;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async findById(id: string): Promise<SavedBrief | null> {
    try {
      const item = await DynamoDBOperations.get({ PK: `BRIEF#${id}`, SK: 'METADATA' });
      return item ? this.fromDBItem(item) : null;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /** Newest-first list of saved briefs. */
  async list(options?: { limit?: number }): Promise<SavedBrief[]> {
    try {
      const response = await DynamoDBOperations.query({
        indexName: 'GSI1',
        keyConditionExpression: 'GSI1PK = :pk',
        expressionAttributeValues: { ':pk': GSI1_PARTITION },
        scanIndexForward: false, // newest first
        limit: options?.limit ?? 50,
      });
      return (response.Items ?? []).map((i) => this.fromDBItem(i));
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  private toDBItem(b: SavedBrief): Record<string, any> {
    return {
      PK: `BRIEF#${b.id}`,
      SK: 'METADATA',
      Type: 'BRIEF',
      // GSI1: list all briefs, newest first
      GSI1PK: GSI1_PARTITION,
      GSI1SK: `${b.createdAt}#${b.id}`,
      ...b,
    };
  }

  private fromDBItem(item: Record<string, any>): SavedBrief {
    return {
      id: item.id,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      lyrics: item.lyrics,
      analysis: item.analysis,
      model: item.model,
      contentId: item.contentId,
      decision: item.decision ?? {},
      outcome: item.outcome ?? null,
      embedding: item.embedding ?? null,
    };
  }
}
