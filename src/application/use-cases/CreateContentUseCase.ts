/**
 * Create Content Use Case
 *
 * Application Layer - Business logic for creating content
 */

import { Content } from '@/domain/entities/Content';
import { IContentRepository } from '@/domain/repositories/IContentRepository';
import { ICategoryRepository } from '@/domain/repositories/ICategoryRepository';
import { ITagRepository } from '@/domain/repositories/ITagRepository';
import type { CreateContentDTO } from '@/types/content';
import { generateSlug } from '@/lib/utils/slug';

/**
 * Create Content Use Case
 *
 * Orchestrates content creation with category and tag relationships
 */
export class CreateContentUseCase {
  constructor(
    private contentRepository: IContentRepository,
    private categoryRepository: ICategoryRepository,
    private tagRepository: ITagRepository
  ) {}

  /**
   * Execute the use case
   */
  async execute(dto: CreateContentDTO): Promise<Content> {
    // Validate categories exist
    if (dto.categoryIds && dto.categoryIds.length > 0) {
      await this.validateCategories(dto.categoryIds);
    }

    // Validate tags exist
    if (dto.tagIds && dto.tagIds.length > 0) {
      await this.validateTags(dto.tagIds);
    }

    // Ensure unique slug
    // TODO: Pass slug to Content.create() once entity supports custom slugs
    const _slug = await this.ensureUniqueSlug(dto.title);

    // Create content entity
    const content = Content.create({
      ...dto,
      categoryIds: dto.categoryIds || [],
      tagIds: dto.tagIds || [],
    });

    // Save content
    await this.contentRepository.save(content);

    // Update category counts
    if (dto.categoryIds) {
      await this.incrementCategoryCounts(dto.categoryIds);
    }

    // Update tag counts
    if (dto.tagIds) {
      await this.incrementTagCounts(dto.tagIds);
    }

    return content;
  }

  /**
   * Validate that all categories exist
   */
  private async validateCategories(categoryIds: string[]): Promise<void> {
    const categories = await Promise.all(
      categoryIds.map((id) => this.categoryRepository.findById(id))
    );

    const missing = categoryIds.filter((id, index) => !categories[index]);

    if (missing.length > 0) {
      throw new Error(`Categories not found: ${missing.join(', ')}`);
    }
  }

  /**
   * Validate that all tags exist
   */
  private async validateTags(tagIds: string[]): Promise<void> {
    const tags = await this.tagRepository.findByIds(tagIds);

    if (tags.length !== tagIds.length) {
      const foundIds = tags.map((t) => t.id);
      const missing = tagIds.filter((id) => !foundIds.includes(id));
      throw new Error(`Tags not found: ${missing.join(', ')}`);
    }
  }

  /**
   * Ensure slug is unique by checking database and appending counter if needed
   */
  private async ensureUniqueSlug(title: string): Promise<string> {
    const baseSlug = generateSlug(title);
    let slug = baseSlug;
    let counter = 1;

    // Keep checking until we find a unique slug
    while (!(await this.contentRepository.isSlugUnique(slug))) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    return slug;
  }

  /**
   * Increment category content counts
   */
  private async incrementCategoryCounts(categoryIds: string[]): Promise<void> {
    await Promise.all(
      categoryIds.map((id) => this.categoryRepository.incrementContentCount(id))
    );
  }

  /**
   * Increment tag content counts
   */
  private async incrementTagCounts(tagIds: string[]): Promise<void> {
    await Promise.all(
      tagIds.map((id) => this.tagRepository.incrementContentCount(id))
    );
  }
}
