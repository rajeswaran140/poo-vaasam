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

// Mock repositories
const mockContentRepository: jest.Mocked<IContentRepository> = {
  save: jest.fn(),
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
      expect(mockContentRepository.save).toHaveBeenCalled();
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
  });

  describe('execute', () => {
    it('should create content and increment category counts', async () => {
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

      await useCase.execute(dto);

      expect(mockCategoryRepository.incrementContentCount).toHaveBeenCalledWith('cat_1');
    });

    it('should create content and increment tag counts', async () => {
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

      await useCase.execute(dto);

      expect(mockTagRepository.incrementContentCount).toHaveBeenCalledWith('tag_1');
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
  });
});
