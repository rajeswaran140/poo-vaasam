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
   * Find content by slug
   */
  async findBySlug(slug: string): Promise<Content | null> {
    try {
      // Scan for slug (consider adding GSI for slug in production)
      const response = await DynamoDBOperations.scan({
        filterExpression: '#titleSlug = :slug AND #sk = :metadata',
        expressionAttributeNames: {
          '#titleSlug': 'titleSlug',
          '#sk': 'SK',
        },
        expressionAttributeValues: {
          ':slug': slug,
          ':metadata': 'METADATA',
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
   * Find all content with pagination
   */
  async findAll(options?: ContentQueryOptions): Promise<PaginatedContent> {
    try {
      const limit = options?.limit || 20;
      const offset = options?.offset || 0;

      // Query using GSI4 for published content
      const response = await DynamoDBOperations.query({
        indexName: 'GSI4',
        keyConditionExpression: 'GSI4PK = :status',
        expressionAttributeValues: {
          ':status': options?.status || ContentStatus.PUBLISHED,
        },
        limit: limit + offset,
        scanIndexForward: options?.sortOrder === 'asc',
      });

      const items = response.Items || [];
      const paginatedItems = items.slice(offset, offset + limit);

      return {
        items: paginatedItems.map((item) => this.fromDBItem(item)),
        total: response.Count || 0,
        limit,
        offset,
        hasMore: items.length > offset + limit,
      };
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Find content by type
   */
  async findByType(
    type: ContentType,
    options?: ContentQueryOptions
  ): Promise<PaginatedContent> {
    try {
      const limit = options?.limit || 20;
      const offset = options?.offset || 0;

      // Query using GSI1
      const response = await DynamoDBOperations.query({
        indexName: 'GSI1',
        keyConditionExpression: 'GSI1PK = :type',
        expressionAttributeValues: {
          ':type': `CONTENT#${type}`,
        },
        limit: limit + offset,
        scanIndexForward: options?.sortOrder === 'asc',
      });

      const items = response.Items || [];
      const paginatedItems = items.slice(offset, offset + limit);

      return {
        items: paginatedItems.map((item) => this.fromDBItem(item)),
        total: response.Count || 0,
        limit,
        offset,
        hasMore: items.length > offset + limit,
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
   * Find content by category
   */
  async findByCategoryId(
    categoryId: string,
    options?: ContentQueryOptions
  ): Promise<PaginatedContent> {
    try {
      const limit = options?.limit || 20;
      const offset = options?.offset || 0;

      // Query using GSI2
      const response = await DynamoDBOperations.query({
        indexName: 'GSI2',
        keyConditionExpression: 'GSI2PK = :categoryId',
        expressionAttributeValues: {
          ':categoryId': `CATEGORY#${categoryId}`,
        },
        limit: limit + offset,
        scanIndexForward: options?.sortOrder === 'asc',
      });

      const items = response.Items || [];

      // Get content IDs from relationships
      const contentIds = items.map((item) => {
        const pk = item.PK as string;
        return pk.replace('CONTENT#', '');
      });

      // Batch get actual content items
      const contentItems = await Promise.all(
        contentIds.map((id) => this.findById(id))
      );

      const validItems = contentItems.filter((item): item is Content => item !== null);
      const paginatedItems = validItems.slice(offset, offset + limit);

      return {
        items: paginatedItems,
        total: validItems.length,
        limit,
        offset,
        hasMore: validItems.length > offset + limit,
      };
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Find content by tag
   */
  async findByTagId(
    tagId: string,
    options?: ContentQueryOptions
  ): Promise<PaginatedContent> {
    try {
      const limit = options?.limit || 20;
      const offset = options?.offset || 0;

      // Query using GSI3
      const response = await DynamoDBOperations.query({
        indexName: 'GSI3',
        keyConditionExpression: 'GSI3PK = :tagId',
        expressionAttributeValues: {
          ':tagId': `TAG#${tagId}`,
        },
        limit: limit + offset,
        scanIndexForward: options?.sortOrder === 'asc',
      });

      const items = response.Items || [];

      // Get content IDs from relationships
      const contentIds = items.map((item) => {
        const pk = item.PK as string;
        return pk.replace('CONTENT#', '');
      });

      // Batch get actual content items
      const contentItems = await Promise.all(
        contentIds.map((id) => this.findById(id))
      );

      const validItems = contentItems.filter((item): item is Content => item !== null);
      const paginatedItems = validItems.slice(offset, offset + limit);

      return {
        items: paginatedItems,
        total: validItems.length,
        limit,
        offset,
        hasMore: validItems.length > offset + limit,
      };
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Search content (basic implementation)
   */
  async search(query: string, options?: ContentQueryOptions): Promise<PaginatedContent> {
    try {
      const limit = options?.limit || 20;
      const offset = options?.offset || 0;

      // Basic scan with filter (consider using OpenSearch for production)
      const response = await DynamoDBOperations.scan({
        filterExpression: 'contains(#title, :query) OR contains(#body, :query)',
        expressionAttributeNames: {
          '#title': 'title',
          '#body': 'body',
        },
        expressionAttributeValues: {
          ':query': query,
        },
        limit: limit + offset,
      });

      const items = response.Items || [];
      const paginatedItems = items.slice(offset, offset + limit);

      return {
        items: paginatedItems.map((item) => this.fromDBItem(item)),
        total: response.Count || 0,
        limit,
        offset,
        hasMore: items.length > offset + limit,
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
   * Delete content
   */
  async delete(id: string): Promise<void> {
    try {
      await DynamoDBOperations.delete({
        PK: `CONTENT#${id}`,
        SK: 'METADATA',
      });

      // Also delete category/tag relationships
      // This would be handled by a background job in production
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
   * Get most viewed content
   */
  async getMostViewed(limit: number): Promise<Content[]> {
    try {
      const response = await DynamoDBOperations.scan({
        filterExpression: '#sk = :metadata AND #status = :published',
        expressionAttributeNames: {
          '#sk': 'SK',
          '#status': 'status',
        },
        expressionAttributeValues: {
          ':metadata': 'METADATA',
          ':published': ContentStatus.PUBLISHED,
        },
      });

      const items = response.Items || [];

      // Sort by viewCount
      const sorted = items.sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));

      return sorted.slice(0, limit).map((item) => this.fromDBItem(item));
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
      GSI1PK: `CONTENT#${content.type}`,
      GSI1SK: `${obj.publishedAt || obj.createdAt}#${content.id}`,
      GSI4PK: content.status,
      GSI4SK: `${obj.createdAt}#${content.id}`,
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
