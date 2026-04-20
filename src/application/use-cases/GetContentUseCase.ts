/**
 * Get Content Use Case
 *
 * Application Layer - Business logic for retrieving content
 */

import { Content } from '@/domain/entities/Content';
import { IContentRepository } from '@/domain/repositories/IContentRepository';
import { ICategoryRepository } from '@/domain/repositories/ICategoryRepository';
import { ITagRepository } from '@/domain/repositories/ITagRepository';
import type { ContentWithRelations, Category, Tag } from '@/types/content';

/**
 * Get Content Use Case
 *
 * Retrieves content with related categories and tags
 */
export class GetContentUseCase {
  constructor(
    private contentRepository: IContentRepository,
    private categoryRepository: ICategoryRepository,
    private tagRepository: ITagRepository
  ) {}

  /**
   * Get content by ID with relations
   */
  async execute(id: string, incrementViews: boolean = false): Promise<ContentWithRelations | null> {
    // Find content
    const content = await this.contentRepository.findById(id);

    if (!content) {
      return null;
    }

    // Increment view count if requested
    if (incrementViews && content.isPublished()) {
      await this.contentRepository.incrementViewCount(id);
    }

    // Load categories
    const categories = await this.loadCategories(content.categoryIds);

    // Load tags
    const tags = await this.loadTags(content.tagIds);

    // Build content with relations
    return this.buildContentWithRelations(content, categories, tags);
  }

  /**
   * Get content by slug with relations
   */
  async executeBySlug(
    slug: string,
    incrementViews: boolean = false
  ): Promise<ContentWithRelations | null> {
    // Find content by slug
    const content = await this.contentRepository.findBySlug(slug);

    if (!content) {
      return null;
    }

    // Reuse the execute method
    return this.execute(content.id, incrementViews);
  }

  /**
   * Load categories by IDs
   */
  private async loadCategories(categoryIds: string[]): Promise<Category[]> {
    if (categoryIds.length === 0) {
      return [];
    }

    const categories = await Promise.all(
      categoryIds.map((id) => this.categoryRepository.findById(id))
    );

    return categories.filter((cat): cat is Category => cat !== null);
  }

  /**
   * Load tags by IDs
   */
  private async loadTags(tagIds: string[]): Promise<Tag[]> {
    if (tagIds.length === 0) {
      return [];
    }

    return await this.tagRepository.findByIds(tagIds);
  }

  /**
   * Build content with relations object
   */
  private buildContentWithRelations(
    content: Content,
    categories: Category[],
    tags: Tag[]
  ): ContentWithRelations {
    return {
      ...content.toObject(),
      id: content.id,
      type: content.type,
      status: content.status,
      title: content.title,
      titleSlug: content.titleSlug,
      body: content.body,
      description: content.description,
      author: content.author,
      featuredImage: content.featuredImage,
      audioUrl: content.audioUrl,
      audioDuration: content.audioDuration,
      viewCount: content.viewCount,
      seoTitle: content.seoTitle,
      seoDescription: content.seoDescription,
      createdAt: content.createdAt,
      updatedAt: content.updatedAt,
      publishedAt: content.publishedAt,
      categoryIds: content.categoryIds,
      tagIds: content.tagIds,
      categories,
      tags,
    };
  }
}
