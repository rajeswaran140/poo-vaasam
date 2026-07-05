/**
 * Persistence for Music Lab generations (Phase 1).
 *
 * Single-table design, stored as CHILDREN of their brief:
 *   PK = `BRIEF#<briefId>` / SK = `GEN#<genId>`
 * so all attempts for a brief are a single cheap query (PK + begins_with GEN#).
 * GSI1 (`GENERATION#ALL`) gives a newest-first cross-brief feed for the lab
 * index + future genome rollups, mirroring BriefRepository's GSI1 convention.
 */

import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';
import type { CreateGenerationInput, Generation } from '@/types/generation';

const GSI1_PARTITION = 'GENERATION#ALL';

export class GenerationRepository {
  /** Persist a new generation and return the stored record. */
  async create(input: CreateGenerationInput): Promise<Generation> {
    try {
      const now = new Date().toISOString();
      const id = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      const gen: Generation = {
        ...input,
        id,
        createdAt: now,
        updatedAt: now,
        embedding: null,
      };
      await DynamoDBOperations.put(this.toDBItem(gen));
      return gen;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /** All generations for one brief, newest-first. */
  async listByBrief(briefId: string): Promise<Generation[]> {
    try {
      const response = await DynamoDBOperations.query({
        keyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        expressionAttributeValues: { ':pk': `BRIEF#${briefId}`, ':sk': 'GEN#' },
        scanIndexForward: false,
      });
      return (response.Items ?? []).map(this.fromDBItem);
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /** Newest-first feed of generations across all briefs. */
  async list(options?: { limit?: number }): Promise<Generation[]> {
    try {
      const response = await DynamoDBOperations.query({
        indexName: 'GSI1',
        keyConditionExpression: 'GSI1PK = :pk',
        expressionAttributeValues: { ':pk': GSI1_PARTITION },
        scanIndexForward: false,
        limit: options?.limit ?? 100,
      });
      return (response.Items ?? []).map(this.fromDBItem);
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Every generation across all briefs, newest-first — pages through GSI1 so the
   * insights/genome layer sees the WHOLE log, not a single-page slice (the
   * dataset is the point). `max` is a runaway safety cap, not a feature limit.
   * Returns `truncated: true` when the cap was hit, so the UI can say so honestly
   * rather than letting the insights silently understate the dataset.
   */
  async listAll(options?: { max?: number }): Promise<{ items: Generation[]; truncated: boolean }> {
    const max = options?.max ?? 5000;
    const items: Generation[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    try {
      do {
        const response = await DynamoDBOperations.query({
          indexName: 'GSI1',
          keyConditionExpression: 'GSI1PK = :pk',
          expressionAttributeValues: { ':pk': GSI1_PARTITION },
          scanIndexForward: false,
          exclusiveStartKey,
        });
        for (const item of response.Items ?? []) {
          items.push(this.fromDBItem(item));
          if (items.length >= max) return { items, truncated: true };
        }
        exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (exclusiveStartKey);
      return { items, truncated: false };
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /** Remove a generation (needs the briefId to address its single-table key). */
  async delete(briefId: string, id: string): Promise<void> {
    try {
      await DynamoDBOperations.delete({ PK: `BRIEF#${briefId}`, SK: `GEN#${id}` });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  private toDBItem(g: Generation): Record<string, unknown> {
    return {
      PK: `BRIEF#${g.briefId}`,
      SK: `GEN#${g.id}`,
      Type: 'GENERATION',
      GSI1PK: GSI1_PARTITION,
      GSI1SK: `${g.createdAt}#${g.id}`,
      ...g,
    };
  }

  // Arrow fn so it can be passed straight to .map without losing `this`.
  private fromDBItem = (item: Record<string, unknown>): Generation =>
    ({
      id: item.id,
      briefId: item.briefId,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      engine: item.engine,
      chosenStyle: item.chosenStyle,
      audioUrl: item.audioUrl,
      settings: item.settings ?? {},
      scores: item.scores ?? {},
      stemRevisions: item.stemRevisions ?? [],
      verdict: item.verdict,
      failureReason: item.failureReason,
      notes: item.notes ?? '',
      audioMetrics: item.audioMetrics ?? null,
      loudness: item.loudness ?? null,
      embedding: item.embedding ?? null,
    }) as Generation;
}
