/**
 * Category Repository Interface
 *
 * Domain Layer - Repository interface for Categories
 */

import type { Category } from '@/types/content';

/**
 * Category Repository Interface
 */
export interface ICategoryRepository {
  /**
   * Create a new category
   */
  create(category: Omit<Category, 'id' | 'contentCount' | 'createdAt'>): Promise<Category>;

  /**
   * Find category by ID
   */
  findById(id: string): Promise<Category | null>;

  /**
   * Find category by slug
   */
  findBySlug(slug: string): Promise<Category | null>;

  /**
   * Find all categories
   */
  findAll(): Promise<Category[]>;

  /**
   * Update category
   */
  update(id: string, updates: Partial<Omit<Category, 'id' | 'createdAt'>>): Promise<Category>;

  /**
   * Delete category
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
   * Get categories with content count > 0
   */
  getPopularCategories(limit?: number): Promise<Category[]>;
}
