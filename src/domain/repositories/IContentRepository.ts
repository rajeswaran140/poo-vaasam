/**
 * Content Repository Interface
 *
 * Domain Layer - Repository interface (DDD pattern)
 * Infrastructure layer will implement this interface
 */

import { Content } from '../entities/Content';
import { ContentType, ContentStatus, type ContentQueryOptions, type PaginatedContent } from '@/types/content';

/**
 * Content Repository Interface
 *
 * Defines the contract for content persistence operations
 */
export interface IContentRepository {
  /**
   * Save a content entity
   */
  save(content: Content): Promise<void>;

  /**
   * Find content by ID
   */
  findById(id: string): Promise<Content | null>;

  /**
   * Find content by slug
   */
  findBySlug(slug: string): Promise<Content | null>;

  /**
   * Find all content with optional filters
   */
  findAll(options?: ContentQueryOptions): Promise<PaginatedContent>;

  /**
   * Find content by type
   */
  findByType(type: ContentType, options?: ContentQueryOptions): Promise<PaginatedContent>;

  /**
   * Find content by status
   */
  findByStatus(status: ContentStatus, options?: ContentQueryOptions): Promise<PaginatedContent>;

  /**
   * Find content by category
   */
  findByCategoryId(categoryId: string, options?: ContentQueryOptions): Promise<PaginatedContent>;

  /**
   * Find content by tag
   */
  findByTagId(tagId: string, options?: ContentQueryOptions): Promise<PaginatedContent>;

  /**
   * Search content
   */
  search(query: string, options?: ContentQueryOptions): Promise<PaginatedContent>;

  /**
   * Update content
   */
  update(content: Content): Promise<void>;

  /**
   * Delete content by ID
   */
  delete(id: string): Promise<void>;

  /**
   * Check if content exists by ID
   */
  exists(id: string): Promise<boolean>;

  /**
   * Check if slug is unique
   */
  isSlugUnique(slug: string, excludeId?: string): Promise<boolean>;

  /**
   * Get content count by type
   */
  countByType(type: ContentType): Promise<number>;

  /**
   * Get content count by status
   */
  countByStatus(status: ContentStatus): Promise<number>;

  /**
   * Get most viewed content
   */
  getMostViewed(limit: number): Promise<Content[]>;

  /**
   * Get recently published content
   */
  getRecentlyPublished(limit: number): Promise<Content[]>;

  /**
   * Increment view count
   */
  incrementViewCount(id: string): Promise<void>;
}
