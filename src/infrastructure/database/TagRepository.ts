/**
 * Tag Repository Implementation
 *
 * Infrastructure Layer - DynamoDB implementation of ITagRepository
 */

import { ITagRepository } from '@/domain/repositories/ITagRepository';
import type { Tag } from '@/types/content';
import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';
import { generateSlug } from '@/lib/utils/slug';

/**
 * DynamoDB Tag Repository
 */
export class TagRepository implements ITagRepository {
  /**
   * Create a new tag
   */
  async create(tag: Omit<Tag, 'id' | 'contentCount' | 'createdAt'>): Promise<Tag> {
    try {
      const id = this.generateId();
      const now = new Date();

      const newTag: Tag = {
        id,
        name: tag.name,
        slug: tag.slug || generateSlug(tag.name),
        contentCount: 0,
        createdAt: now,
      };

      const item = this.toDBItem(newTag);
      await DynamoDBOperations.put(item);

      return newTag;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Find tag by ID
   */
  async findById(id: string): Promise<Tag | null> {
    try {
      const item = await DynamoDBOperations.get({
        PK: `TAG#${id}`,
        SK: 'METADATA',
      });

      return item ? this.fromDBItem(item) : null;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Find tag by slug
   */
  async findBySlug(slug: string): Promise<Tag | null> {
    try {
      const response = await DynamoDBOperations.scan({
        filterExpression: '#slug = :slug AND #type = :type',
        expressionAttributeNames: {
          '#slug': 'slug',
          '#type': 'Type',
        },
        expressionAttributeValues: {
          ':slug': slug,
          ':type': 'TAG',
        },
        limit: 1,
      });

      const items = response.Items || [];
      return items.length > 0 ? this.fromDBItem(items[0]) : null;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Find all tags
   */
  async findAll(): Promise<Tag[]> {
    try {
      const response = await DynamoDBOperations.scan({
        filterExpression: '#type = :type',
        expressionAttributeNames: {
          '#type': 'Type',
        },
        expressionAttributeValues: {
          ':type': 'TAG',
        },
      });

      const items = response.Items || [];
      return items
        .map((item) => this.fromDBItem(item))
        .sort((a, b) => a.name.localeCompare(b.name, 'ta'));
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Find tags by IDs
   */
  async findByIds(ids: string[]): Promise<Tag[]> {
    try {
      if (ids.length === 0) {
        return [];
      }

      const keys = ids.map((id) => ({
        PK: `TAG#${id}`,
        SK: 'METADATA',
      }));

      const items = await DynamoDBOperations.batchGet(keys);
      return items.map((item) => this.fromDBItem(item));
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Update tag
   */
  async update(
    id: string,
    updates: Partial<Omit<Tag, 'id' | 'createdAt'>>
  ): Promise<Tag> {
    try {
      const existing = await this.findById(id);
      if (!existing) {
        throw new Error(`Tag ${id} not found`);
      }

      const updated: Tag = {
        ...existing,
        ...updates,
        id: existing.id,
        createdAt: existing.createdAt,
      };

      const item = this.toDBItem(updated);
      await DynamoDBOperations.put(item);

      return updated;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Delete tag
   */
  async delete(id: string): Promise<void> {
    try {
      await DynamoDBOperations.delete({
        PK: `TAG#${id}`,
        SK: 'METADATA',
      });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Check if slug is unique
   */
  async isSlugUnique(slug: string, excludeId?: string): Promise<boolean> {
    const existing = await this.findBySlug(slug);

    if (!existing) {
      return true;
    }

    if (excludeId && existing.id === excludeId) {
      return true;
    }

    return false;
  }

  /**
   * Increment content count
   */
  async incrementContentCount(id: string): Promise<void> {
    try {
      await DynamoDBOperations.update({
        key: {
          PK: `TAG#${id}`,
          SK: 'METADATA',
        },
        updateExpression: 'SET #contentCount = if_not_exists(#contentCount, :zero) + :inc',
        expressionAttributeNames: {
          '#contentCount': 'contentCount',
        },
        expressionAttributeValues: {
          ':zero': 0,
          ':inc': 1,
        },
      });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Decrement content count
   * Prevents count from going below zero
   */
  async decrementContentCount(id: string): Promise<void> {
    try {
      await DynamoDBOperations.update({
        key: {
          PK: `TAG#${id}`,
          SK: 'METADATA',
        },
        updateExpression: 'SET #contentCount = if_not_exists(#contentCount, :one) - :dec',
        conditionExpression: '#contentCount > :zero',
        expressionAttributeNames: {
          '#contentCount': 'contentCount',
        },
        expressionAttributeValues: {
          ':zero': 0,
          ':one': 1,
          ':dec': 1,
        },
      });
    } catch (error) {
      // Ignore ConditionalCheckFailedException - count is already at 0
      if ((error as any).name !== 'ConditionalCheckFailedException') {
        handleDynamoDBError(error);
      }
    }
  }

  /**
   * Get popular tags
   */
  async getPopularTags(limit: number = 20): Promise<Tag[]> {
    try {
      const all = await this.findAll();

      return all
        .filter((tag) => tag.contentCount > 0)
        .sort((a, b) => b.contentCount - a.contentCount)
        .slice(0, limit);
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Search tags by name
   */
  async searchByName(query: string): Promise<Tag[]> {
    try {
      const response = await DynamoDBOperations.scan({
        filterExpression: 'contains(#name, :query) AND #type = :type',
        expressionAttributeNames: {
          '#name': 'name',
          '#type': 'Type',
        },
        expressionAttributeValues: {
          ':query': query,
          ':type': 'TAG',
        },
      });

      const items = response.Items || [];
      return items.map((item) => this.fromDBItem(item));
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Generate tag ID
   */
  private generateId(): string {
    return `tag_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Convert Tag to DynamoDB item
   */
  private toDBItem(tag: Tag): Record<string, any> {
    return {
      PK: `TAG#${tag.id}`,
      SK: 'METADATA',
      Type: 'TAG',
      id: tag.id,
      name: tag.name,
      slug: tag.slug,
      contentCount: tag.contentCount,
      createdAt: tag.createdAt.toISOString(),
    };
  }

  /**
   * Convert DynamoDB item to Tag
   */
  private fromDBItem(item: any): Tag {
    return {
      id: item.id,
      name: item.name,
      slug: item.slug,
      contentCount: item.contentCount || 0,
      createdAt: new Date(item.createdAt),
    };
  }
}
