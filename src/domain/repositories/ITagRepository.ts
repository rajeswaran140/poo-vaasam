/**
 * Tag Repository Interface
 *
 * Domain Layer - Repository interface for Tags
 */

import type { Tag } from '@/types/content';

/**
 * Tag Repository Interface
 */
export interface ITagRepository {
  /**
   * Create a new tag
   */
  create(tag: Omit<Tag, 'id' | 'contentCount' | 'createdAt'>): Promise<Tag>;

  /**
   * Find tag by ID
   */
  findById(id: string): Promise<Tag | null>;

  /**
   * Find tag by slug
   */
  findBySlug(slug: string): Promise<Tag | null>;

  /**
   * Find all tags
   */
  findAll(): Promise<Tag[]>;

  /**
   * Find tags by IDs
   */
  findByIds(ids: string[]): Promise<Tag[]>;

  /**
   * Update tag
   */
  update(id: string, updates: Partial<Omit<Tag, 'id' | 'createdAt'>>): Promise<Tag>;

  /**
   * Delete tag
   */
  delete(id: string): Promise<void>;

  /**
   * Check if slug is unique
   */
  isSlugUnique(slug: string, excludeId?: string): Promise<boolean>;

  /**
   * Increment content count
   */
  incrementContentCount(id: string): Promise<void>;

  /**
   * Decrement content count
   */
  decrementContentCount(id: string): Promise<void>;

  /**
   * Get popular tags
   */
  getPopularTags(limit?: number): Promise<Tag[]>;

  /**
   * Search tags by name
   */
  searchByName(query: string): Promise<Tag[]>;
}
