/**
 * Category Repository Implementation
 *
 * Infrastructure Layer - DynamoDB implementation of ICategoryRepository
 */

import { ICategoryRepository } from '@/domain/repositories/ICategoryRepository';
import type { Category } from '@/types/content';
import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';
import { generateSlug } from '@/lib/utils/slug';

/**
 * DynamoDB Category Repository
 */
export class CategoryRepository implements ICategoryRepository {
  /**
   * Create a new category
   */
  async create(
    category: Omit<Category, 'id' | 'contentCount' | 'createdAt'>
  ): Promise<Category> {
    try {
      const id = this.generateId();
      const now = new Date();

      const newCategory: Category = {
        id,
        name: category.name,
        slug: category.slug || generateSlug(category.name),
        description: category.description,
        contentCount: 0,
        createdAt: now,
      };

      const item = this.toDBItem(newCategory);
      await DynamoDBOperations.put(item);

      return newCategory;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Find category by ID
   */
  async findById(id: string): Promise<Category | null> {
    try {
      const item = await DynamoDBOperations.get({
        PK: `CATEGORY#${id}`,
        SK: 'METADATA',
      });

      return item ? this.fromDBItem(item) : null;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Find category by slug
   */
  async findBySlug(slug: string): Promise<Category | null> {
    try {
      const response = await DynamoDBOperations.scan({
        filterExpression: '#slug = :slug AND #type = :type',
        expressionAttributeNames: {
          '#slug': 'slug',
          '#type': 'Type',
        },
        expressionAttributeValues: {
          ':slug': slug,
          ':type': 'CATEGORY',
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
   * Find all categories
   */
  async findAll(): Promise<Category[]> {
    try {
      const response = await DynamoDBOperations.scan({
        filterExpression: '#type = :type',
        expressionAttributeNames: {
          '#type': 'Type',
        },
        expressionAttributeValues: {
          ':type': 'CATEGORY',
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
   * Update category
   */
  async update(
    id: string,
    updates: Partial<Omit<Category, 'id' | 'createdAt'>>
  ): Promise<Category> {
    try {
      const existing = await this.findById(id);
      if (!existing) {
        throw new Error(`Category ${id} not found`);
      }

      const updated: Category = {
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
   * Delete category
   */
  async delete(id: string): Promise<void> {
    try {
      await DynamoDBOperations.delete({
        PK: `CATEGORY#${id}`,
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
          PK: `CATEGORY#${id}`,
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
          PK: `CATEGORY#${id}`,
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
   * Get popular categories
   */
  async getPopularCategories(limit: number = 10): Promise<Category[]> {
    try {
      const all = await this.findAll();

      return all
        .filter((cat) => cat.contentCount > 0)
        .sort((a, b) => b.contentCount - a.contentCount)
        .slice(0, limit);
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Generate category ID
   */
  private generateId(): string {
    return `cat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Convert Category to DynamoDB item
   */
  private toDBItem(category: Category): Record<string, any> {
    return {
      PK: `CATEGORY#${category.id}`,
      SK: 'METADATA',
      Type: 'CATEGORY',
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      contentCount: category.contentCount,
      createdAt: category.createdAt.toISOString(),
    };
  }

  /**
   * Convert DynamoDB item to Category
   */
  private fromDBItem(item: any): Category {
    return {
      id: item.id,
      name: item.name,
      slug: item.slug,
      description: item.description,
      contentCount: item.contentCount || 0,
      createdAt: new Date(item.createdAt),
    };
  }
}
