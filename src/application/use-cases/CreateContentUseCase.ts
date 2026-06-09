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
import { DomainError, SlugConflictError } from '@/application/errors';

// Bound the slug-conflict retry so a pathological collision can't spin forever.
const MAX_SLUG_ATTEMPTS = 5;

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

    // Pick a slug that doesn't collide with existing content (best-effort
    // pre-check against the eventually-consistent slug index).
    const baseSlug = await this.ensureUniqueSlug(dto.title);

    // Atomically persist the content + its slug guard + relationship rows. The
    // guard is the authoritative uniqueness check; if the pre-check raced a
    // concurrent create, retry with a bumped slug.
    let slug = baseSlug;
    let content: Content | undefined;
    for (let attempt = 0; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
      content = Content.create({
        ...dto,
        slug,
        categoryIds: dto.categoryIds || [],
        tagIds: dto.tagIds || [],
      });
      try {
        await this.contentRepository.create(content);
        break;
      } catch (err) {
        if (err instanceof SlugConflictError && attempt < MAX_SLUG_ATTEMPTS) {
          slug = `${baseSlug}-${attempt + 1}`;
          continue;
        }
        throw err;
      }
    }
    // `content` is always assigned (the loop body runs at least once and either
    // breaks on success or rethrows); assert for the type checker.
    const created = content!;

    // Taxonomy content-counts are bumped INSIDE the repository's create
    // transaction (atomic with the relationship rows), so there is no separate,
    // drift-prone post-write step here anymore.

    return created;
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
      throw new DomainError(`Categories not found: ${missing.join(', ')}`);
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
      throw new DomainError(`Tags not found: ${missing.join(', ')}`);
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
}
