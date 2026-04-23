/**
 * Content Repository Implementation
 *
 * Infrastructure Layer - DynamoDB implementation of IContentRepository
 */

import { IContentRepository } from '@/domain/repositories/IContentRepository';
import { Content } from '@/domain/entities/Content';
import {
  ContentType,
  ContentStatus,
  type ContentQueryOptions,
  type PaginatedContent,
} from '@/types/content';
import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';

/**
 * DynamoDB Content Repository
 *
 * Implements single-table design with GSIs
 */
export class ContentRepository implements IContentRepository {
  /**
   * Save content to DynamoDB
   */
  async save(content: Content): Promise<void> {
    try {
      const item = this.toDBItem(content);
      await DynamoDBOperations.put(item);
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Find content by ID
   */
  async findById(id: string): Promise<Content | null> {
    try {
      const item = await DynamoDBOperations.get({
        PK: `CONTENT#${id}`,
        SK: 'METADATA',
      });

      return item ? this.fromDBItem(item) : null;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Find content by slug using GSI5
   */
  async findBySlug(slug: string): Promise<Content | null> {
    try {
      // Query using GSI5 for efficient slug lookup
      const response = await DynamoDBOperations.query({
        indexName: 'GSI5',
        keyConditionExpression: 'GSI5PK = :slugPrefix AND GSI5SK = :slug',
        expressionAttributeValues: {
          ':slugPrefix': 'SLUG',
          ':slug': slug,
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
   * Find all content with cursor-based pagination
   */
  async findAll(options?: ContentQueryOptions): Promise<PaginatedContent> {
    try {
      const limit = options?.limit || 20;

      // Query using GSI4 for published content
      const response = await DynamoDBOperations.query({
        indexName: 'GSI4',
        keyConditionExpression: 'GSI4PK = :status',
        expressionAttributeValues: {
          ':status': options?.status || ContentStatus.PUBLISHED,
        },
        limit,
        scanIndexForward: options?.sortOrder === 'asc',
        exclusiveStartKey: options?.lastEvaluatedKey,
      });

      const items = response.Items || [];

      return {
        items: items.map((item) => this.fromDBItem(item)),
        total: response.Count || 0,
        limit,
        lastEvaluatedKey: response.LastEvaluatedKey,
        hasMore: !!response.LastEvaluatedKey,
      };
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Find content by type with cursor-based pagination
   */
  async findByType(
    type: ContentType,
    options?: ContentQueryOptions
  ): Promise<PaginatedContent> {
    try {
      const limit = options?.limit || 20;

      // Query using GSI1
      const response = await DynamoDBOperations.query({
        indexName: 'GSI1',
        keyConditionExpression: 'GSI1PK = :type',
        expressionAttributeValues: {
          ':type': `CONTENT#${type}`,
        },
        limit,
        scanIndexForward: options?.sortOrder === 'asc',
        exclusiveStartKey: options?.lastEvaluatedKey,
      });

      const items = response.Items || [];

      return {
        items: items.map((item) => this.fromDBItem(item)),
        total: response.Count || 0,
        limit,
        lastEvaluatedKey: response.LastEvaluatedKey,
        hasMore: !!response.LastEvaluatedKey,
      };
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Find content by status
   */
  async findByStatus(
    status: ContentStatus,
    options?: ContentQueryOptions
  ): Promise<PaginatedContent> {
    return this.findAll({ ...options, status });
  }

  /**
   * Find content by category with cursor-based pagination
   */
  async findByCategoryId(
    categoryId: string,
    options?: ContentQueryOptions
  ): Promise<PaginatedContent> {
    try {
      const limit = options?.limit || 20;

      // Query using GSI2
      const response = await DynamoDBOperations.query({
        indexName: 'GSI2',
        keyConditionExpression: 'GSI2PK = :categoryId',
        expressionAttributeValues: {
          ':categoryId': `CATEGORY#${categoryId}`,
        },
        limit,
        scanIndexForward: options?.sortOrder === 'asc',
        exclusiveStartKey: options?.lastEvaluatedKey,
      });

      const items = response.Items || [];

      // Get content IDs from relationships
      const contentIds = items.map((item) => {
        const pk = item.PK as string;
        return pk.replace('CONTENT#', '');
      });

      // Batch get actual content items for better performance
      const keys = contentIds.map(id => ({
        PK: `CONTENT#${id}`,
        SK: 'METADATA',
      }));

      const contentItems = keys.length > 0
        ? await DynamoDBOperations.batchGet(keys)
        : [];

      const validItems = contentItems
        .map((item) => this.fromDBItem(item))
        .filter((item): item is Content => item !== null);

      return {
        items: validItems,
        total: validItems.length,
        limit,
        lastEvaluatedKey: response.LastEvaluatedKey,
        hasMore: !!response.LastEvaluatedKey,
      };
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Find content by tag with cursor-based pagination
   */
  async findByTagId(
    tagId: string,
    options?: ContentQueryOptions
  ): Promise<PaginatedContent> {
    try {
      const limit = options?.limit || 20;

      // Query using GSI3
      const response = await DynamoDBOperations.query({
        indexName: 'GSI3',
        keyConditionExpression: 'GSI3PK = :tagId',
        expressionAttributeValues: {
          ':tagId': `TAG#${tagId}`,
        },
        limit,
        scanIndexForward: options?.sortOrder === 'asc',
        exclusiveStartKey: options?.lastEvaluatedKey,
      });

      const items = response.Items || [];

      // Get content IDs from relationships
      const contentIds = items.map((item) => {
        const pk = item.PK as string;
        return pk.replace('CONTENT#', '');
      });

      // Batch get actual content items for better performance
      const keys = contentIds.map(id => ({
        PK: `CONTENT#${id}`,
        SK: 'METADATA',
      }));

      const contentItems = keys.length > 0
        ? await DynamoDBOperations.batchGet(keys)
        : [];

      const validItems = contentItems
        .map((item) => this.fromDBItem(item))
        .filter((item): item is Content => item !== null);

      return {
        items: validItems,
        total: validItems.length,
        limit,
        lastEvaluatedKey: response.LastEvaluatedKey,
        hasMore: !!response.LastEvaluatedKey,
      };
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Search content (basic implementation using scan)
   *
   * WARNING: This uses DynamoDB scan which is inefficient for large datasets.
   * For production, integrate with Amazon OpenSearch Service or Algolia.
   * This is acceptable for development with small datasets (<1000 items).
   */
  async search(query: string, options?: ContentQueryOptions): Promise<PaginatedContent> {
    try {
      const limit = options?.limit || 20;

      // Basic scan with filter - only for development/small datasets
      const response = await DynamoDBOperations.scan({
        filterExpression: '(contains(#title, :query) OR contains(#body, :query)) AND #sk = :metadata',
        expressionAttributeNames: {
          '#title': 'title',
          '#body': 'body',
          '#sk': 'SK',
        },
        expressionAttributeValues: {
          ':query': query,
          ':metadata': 'METADATA',
        },
        limit,
        exclusiveStartKey: options?.lastEvaluatedKey,
      });

      const items = response.Items || [];

      return {
        items: items.map((item) => this.fromDBItem(item)),
        total: response.Count || 0,
        limit,
        lastEvaluatedKey: response.LastEvaluatedKey,
        hasMore: !!response.LastEvaluatedKey,
      };
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Update content
   */
  async update(content: Content): Promise<void> {
    await this.save(content); // DynamoDB put overwrites
  }

  /**
   * Delete content and all related relationships
   */
  async delete(id: string): Promise<void> {
    try {
      // First, get the content to know which relationships to delete
      const content = await this.findById(id);
      if (!content) {
        return; // Content doesn't exist, nothing to delete
      }

      // Delete main content item
      await DynamoDBOperations.delete({
        PK: `CONTENT#${id}`,
        SK: 'METADATA',
      });

      // Delete category relationships
      const categoryDeletePromises = content.categoryIds.map((categoryId) =>
        DynamoDBOperations.delete({
          PK: `CONTENT#${id}`,
          SK: `CATEGORY#${categoryId}`,
        }).catch((err) => {
          console.error(`Failed to delete category relationship ${categoryId}:`, err);
          // Don't throw, continue with other deletions
        })
      );

      // Delete tag relationships
      const tagDeletePromises = content.tagIds.map((tagId) =>
        DynamoDBOperations.delete({
          PK: `CONTENT#${id}`,
          SK: `TAG#${tagId}`,
        }).catch((err) => {
          console.error(`Failed to delete tag relationship ${tagId}:`, err);
          // Don't throw, continue with other deletions
        })
      );

      // Execute all relationship deletions in parallel
      await Promise.all([...categoryDeletePromises, ...tagDeletePromises]);
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Check if content exists
   */
  async exists(id: string): Promise<boolean> {
    const content = await this.findById(id);
    return content !== null;
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
   * Count content by type
   */
  async countByType(type: ContentType): Promise<number> {
    try {
      const response = await DynamoDBOperations.query({
        indexName: 'GSI1',
        keyConditionExpression: 'GSI1PK = :type',
        expressionAttributeValues: {
          ':type': `CONTENT#${type}`,
        },
      });

      return response.Count || 0;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Count content by status
   */
  async countByStatus(status: ContentStatus): Promise<number> {
    try {
      const response = await DynamoDBOperations.query({
        indexName: 'GSI4',
        keyConditionExpression: 'GSI4PK = :status',
        expressionAttributeValues: {
          ':status': status,
        },
      });

      return response.Count || 0;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Get most viewed content using GSI6
   */
  async getMostViewed(limit: number): Promise<Content[]> {
    try {
      // Query using GSI6 for popular content (sorted by viewCount descending)
      const response = await DynamoDBOperations.query({
        indexName: 'GSI6',
        keyConditionExpression: 'GSI6PK = :popular',
        expressionAttributeValues: {
          ':popular': 'POPULAR',
        },
        scanIndexForward: false, // Descending order (highest views first)
        limit,
      });

      const items = response.Items || [];
      return items.map((item) => this.fromDBItem(item));
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Get recently published content
   */
  async getRecentlyPublished(limit: number): Promise<Content[]> {
    try {
      const response = await DynamoDBOperations.query({
        indexName: 'GSI4',
        keyConditionExpression: 'GSI4PK = :status',
        expressionAttributeValues: {
          ':status': ContentStatus.PUBLISHED,
        },
        scanIndexForward: false, // Most recent first
        limit,
      });

      const items = response.Items || [];
      return items.map((item) => this.fromDBItem(item));
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Increment view count
   */
  async incrementViewCount(id: string): Promise<void> {
    try {
      await DynamoDBOperations.update({
        key: {
          PK: `CONTENT#${id}`,
          SK: 'METADATA',
        },
        updateExpression: 'SET #viewCount = if_not_exists(#viewCount, :zero) + :inc',
        expressionAttributeNames: {
          '#viewCount': 'viewCount',
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
   * Convert Content entity to DynamoDB item
   */
  private toDBItem(content: Content): Record<string, any> {
    const obj = content.toObject();

    return {
      PK: `CONTENT#${content.id}`,
      SK: 'METADATA',
      Type: 'CONTENT',
      // GSI1: Query by content type
      GSI1PK: `CONTENT#${content.type}`,
      GSI1SK: `${obj.publishedAt || obj.createdAt}#${content.id}`,
      // GSI4: Query by status
      GSI4PK: content.status,
      GSI4SK: `${obj.createdAt}#${content.id}`,
      // GSI5: Query by slug for SEO-friendly URLs
      GSI5PK: 'SLUG',
      GSI5SK: content.titleSlug,
      // GSI6: Query by popularity (viewCount)
      GSI6PK: 'POPULAR',
      GSI6SK: `${String(content.viewCount).padStart(10, '0')}#${content.id}`,
      ...obj,
    };
  }

  /**
   * Convert DynamoDB item to Content entity
   */
  private fromDBItem(item: any): Content {
    return Content.fromObject(item);
  }
}
