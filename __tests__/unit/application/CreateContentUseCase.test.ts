/**
 * CreateContentUseCase Tests
 *
 * Tests for the fixed ensureUniqueSlug bug
 */

import { CreateContentUseCase } from '@/application/use-cases/CreateContentUseCase';
import { Content } from '@/domain/entities/Content';
import { IContentRepository } from '@/domain/repositories/IContentRepository';
import { ICategoryRepository } from '@/domain/repositories/ICategoryRepository';
import { ITagRepository } from '@/domain/repositories/ITagRepository';
import { ContentType, ContentStatus } from '@/types/content';
import { DomainError, SlugConflictError } from '@/application/errors';

// Mock repositories
const mockContentRepository: jest.Mocked<IContentRepository> = {
  save: jest.fn(),
  create: jest.fn(),
  findById: jest.fn(),
  findBySlug: jest.fn(),
  findAll: jest.fn(),
  findByType: jest.fn(),
  findByStatus: jest.fn(),
  findByCategoryId: jest.fn(),
  findByTagId: jest.fn(),
  search: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  exists: jest.fn(),
  isSlugUnique: jest.fn(),
  countByType: jest.fn(),
  countByStatus: jest.fn(),
  getMostViewed: jest.fn(),
  getRecentlyPublished: jest.fn(),
  incrementViewCount: jest.fn(),
};

const mockCategoryRepository: jest.Mocked<ICategoryRepository> = {
  create: jest.fn(),
  findById: jest.fn(),
  findBySlug: jest.fn(),
  findAll: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  isSlugUnique: jest.fn(),
  incrementContentCount: jest.fn(),
  decrementContentCount: jest.fn(),
  getPopularCategories: jest.fn(),
};

const mockTagRepository: jest.Mocked<ITagRepository> = {
  create: jest.fn(),
  findById: jest.fn(),
  findBySlug: jest.fn(),
  findAll: jest.fn(),
  findByIds: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  isSlugUnique: jest.fn(),
  incrementContentCount: jest.fn(),
  decrementContentCount: jest.fn(),
  getPopularTags: jest.fn(),
  searchByName: jest.fn(),
};

describe('CreateContentUseCase', () => {
  let useCase: CreateContentUseCase;

  beforeEach(() => {
    useCase = new CreateContentUseCase(
      mockContentRepository,
      mockCategoryRepository,
      mockTagRepository
    );
    jest.clearAllMocks();
  });

  describe('ensureUniqueSlug', () => {
    it('should generate slug from title and return it if unique', async () => {
      mockContentRepository.isSlugUnique.mockResolvedValue(true);

      const dto = {
        type: ContentType.SONGS,
        title: 'பூ வாசம்',
        body: 'Test body',
        description: 'Test description',
        author: 'Test Author',
      };

      const content = await useCase.execute(dto);

      // Verify isSlugUnique was called with the generated slug
      expect(mockContentRepository.isSlugUnique).toHaveBeenCalledWith('பூ-வாசம்');
      expect(mockContentRepository.create).toHaveBeenCalled();
    });

    it('should append counter if slug already exists', async () => {
      // First call: slug exists
      // Second call: slug-1 exists
      // Third call: slug-2 is unique
      mockContentRepository.isSlugUnique
        .mockResolvedValueOnce(false) // பூ-வாசம் exists
        .mockResolvedValueOnce(false) // பூ-வாசம்-1 exists
        .mockResolvedValueOnce(true);  // பூ-வாசம்-2 is unique

      const dto = {
        type: ContentType.POEMS,
        title: 'பூ வாசம்',
        body: 'Test poem',
        description: 'Test description',
        author: 'Test Poet',
      };

      await useCase.execute(dto);

      // Should check three times
      expect(mockContentRepository.isSlugUnique).toHaveBeenCalledTimes(3);
      expect(mockContentRepository.isSlugUnique).toHaveBeenNthCalledWith(1, 'பூ-வாசம்');
      expect(mockContentRepository.isSlugUnique).toHaveBeenNthCalledWith(2, 'பூ-வாசம்-1');
      expect(mockContentRepository.isSlugUnique).toHaveBeenNthCalledWith(3, 'பூ-வாசம்-2');
    });

    it('should handle English titles correctly', async () => {
      mockContentRepository.isSlugUnique.mockResolvedValue(true);

      const dto = {
        type: ContentType.ESSAYS,
        title: 'Hello World',
        body: 'Test essay',
        description: 'Test description',
        author: 'Test Author',
      };

      await useCase.execute(dto);

      expect(mockContentRepository.isSlugUnique).toHaveBeenCalledWith('hello-world');
    });

    it('should handle mixed Tamil and English', async () => {
      mockContentRepository.isSlugUnique.mockResolvedValue(true);

      const dto = {
        type: ContentType.STORIES,
        title: 'Tamil Story 123',
        body: 'Test story',
        description: 'Test description',
        author: 'Test Author',
      };

      await useCase.execute(dto);

      expect(mockContentRepository.isSlugUnique).toHaveBeenCalledWith('tamil-story-123');
    });

    // Regression: the uniqueness loop used to compute a slug then DISCARD it,
    // so duplicate-titled content collided on the title-derived slug. The
    // resolved unique slug must actually reach the created entity.
    it('applies the resolved unique slug to the created content', async () => {
      mockContentRepository.isSlugUnique
        .mockResolvedValueOnce(false) // hello-world taken
        .mockResolvedValueOnce(true); // hello-world-1 is free

      const dto = {
        type: ContentType.SONGS,
        title: 'Hello World',
        body: 'Test body',
        description: 'Test description',
        author: 'Test Author',
      };

      const content = await useCase.execute(dto);

      expect(content.titleSlug).toBe('hello-world-1');
      expect(mockContentRepository.create).toHaveBeenCalled();
    });
  });

  describe('execute', () => {
    // Counts are now bumped inside the repository's create transaction (atomic),
    // so the use case must NOT do a separate, drift-prone increment.
    it('creates content with a category and does NOT increment separately (atomic in create)', async () => {
      mockContentRepository.isSlugUnique.mockResolvedValue(true);
      mockCategoryRepository.findById.mockResolvedValue({
        id: 'cat_1',
        name: 'Category 1',
        slug: 'category-1',
        description: 'Test category',
        contentCount: 0,
        createdAt: new Date(),
      });

      const dto = {
        type: ContentType.SONGS,
        title: 'Test Song',
        body: 'Test lyrics',
        description: 'Test description',
        author: 'Test Singer',
        categoryIds: ['cat_1'],
      };

      const content = await useCase.execute(dto);

      expect(mockContentRepository.create).toHaveBeenCalledTimes(1);
      expect(content.categoryIds).toEqual(['cat_1']);
      expect(mockCategoryRepository.incrementContentCount).not.toHaveBeenCalled();
    });

    it('creates content with a tag and does NOT increment separately (atomic in create)', async () => {
      mockContentRepository.isSlugUnique.mockResolvedValue(true);
      mockTagRepository.findByIds.mockResolvedValue([
        {
          id: 'tag_1',
          name: 'Tag 1',
          slug: 'tag-1',
          contentCount: 0,
          createdAt: new Date(),
        },
      ]);

      const dto = {
        type: ContentType.POEMS,
        title: 'Test Poem',
        body: 'Test content',
        description: 'Test description',
        author: 'Test Poet',
        tagIds: ['tag_1'],
      };

      const content = await useCase.execute(dto);

      expect(mockContentRepository.create).toHaveBeenCalledTimes(1);
      expect(content.tagIds).toEqual(['tag_1']);
      expect(mockTagRepository.incrementContentCount).not.toHaveBeenCalled();
    });

    it('should throw error if category does not exist', async () => {
      mockCategoryRepository.findById.mockResolvedValue(null);

      const dto = {
        type: ContentType.LYRICS,
        title: 'Test Lyrics',
        body: 'Test body',
        description: 'Test description',
        author: 'Test Author',
        categoryIds: ['cat_nonexistent'],
      };

      await expect(useCase.execute(dto)).rejects.toThrow('Categories not found');
    });

    it('throws a typed DomainError (not a generic Error) for missing taxonomy', async () => {
      mockCategoryRepository.findById.mockResolvedValue(null);

      await expect(
        useCase.execute({
          type: ContentType.LYRICS,
          title: 'Test',
          body: 'Body',
          description: '',
          author: 'A',
          categoryIds: ['nope'],
        })
      ).rejects.toBeInstanceOf(DomainError);
    });

    // M1/M4: persistence goes through the atomic create (content + slug guard +
    // relationship rows), carrying the selected category/tag ids.
    it('persists via the atomic create with the selected categories and tags', async () => {
      mockContentRepository.isSlugUnique.mockResolvedValue(true);
      mockCategoryRepository.findById.mockResolvedValue({
        id: 'cat_1', name: 'C', slug: 'c', description: '', contentCount: 0, createdAt: new Date(),
      });
      mockTagRepository.findByIds.mockResolvedValue([
        { id: 'tag_1', name: 'T', slug: 't', contentCount: 0, createdAt: new Date() },
      ]);

      await useCase.execute({
        type: ContentType.SONGS,
        title: 'Linked Song',
        body: 'Body',
        description: '',
        author: 'A',
        categoryIds: ['cat_1'],
        tagIds: ['tag_1'],
      });

      expect(mockContentRepository.create).toHaveBeenCalledTimes(1);
      const created = mockContentRepository.create.mock.calls[0][0] as Content;
      expect(created.categoryIds).toEqual(['cat_1']);
      expect(created.tagIds).toEqual(['tag_1']);
      expect(mockContentRepository.save).not.toHaveBeenCalled();
    });

    // M3: the atomic create's slug guard is authoritative — on a race it throws
    // SlugConflictError and the use case retries with a bumped slug.
    it('retries with a bumped slug when create reports a slug conflict', async () => {
      mockContentRepository.isSlugUnique.mockResolvedValue(true);
      mockContentRepository.create
        .mockRejectedValueOnce(new SlugConflictError('hello-world'))
        .mockResolvedValueOnce(undefined);

      const content = await useCase.execute({
        type: ContentType.SONGS,
        title: 'Hello World',
        body: 'Body',
        description: '',
        author: 'A',
      });

      expect(mockContentRepository.create).toHaveBeenCalledTimes(2);
      expect(content.titleSlug).toBe('hello-world-1');
    });

    it('gives up after the retry budget is exhausted (rethrows the conflict)', async () => {
      mockContentRepository.isSlugUnique.mockResolvedValue(true);
      mockContentRepository.create.mockRejectedValue(new SlugConflictError('x'));

      await expect(
        useCase.execute({ type: ContentType.SONGS, title: 'X', body: 'B', description: '', author: 'A' })
      ).rejects.toBeInstanceOf(SlugConflictError);
    });
  });
});
