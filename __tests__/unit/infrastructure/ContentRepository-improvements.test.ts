/**
 * ContentRepository Improvements Tests
 *
 * Tests for new GSI usage, pagination, batch operations, and delete cleanup
 */

import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';
import { Content } from '@/domain/entities/Content';
import { ContentType, ContentStatus } from '@/types/content';

// Mock DynamoDB operations
jest.mock('@/infrastructure/database/dynamodb-client');

describe('ContentRepository Improvements', () => {
  let repository: ContentRepository;
  let mockDynamoDBOps: jest.Mocked<typeof DynamoDBOperations>;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new ContentRepository();
    mockDynamoDBOps = DynamoDBOperations as jest.Mocked<typeof DynamoDBOperations>;
  });

  describe('findBySlug - GSI5 Usage', () => {
    it('should use GSI5 query instead of scan', async () => {
      mockDynamoDBOps.query = jest.fn().mockResolvedValue({
        Items: [{
          id: 'cnt_123',
          type: ContentType.POEMS,
          title: 'Test',
          titleSlug: 'test',
          body: 'Body',
          description: 'Desc',
          author: 'Author',
          status: ContentStatus.PUBLISHED,
          categoryIds: [],
          tagIds: [],
          viewCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
      });

      await repository.findBySlug('test');

      // Verify GSI5 was used, not scan
      expect(mockDynamoDBOps.query).toHaveBeenCalledWith(
        expect.objectContaining({
          indexName: 'GSI5',
          keyConditionExpression: 'GSI5PK = :slugPrefix AND GSI5SK = :slug',
          expressionAttributeValues: {
            ':slugPrefix': 'SLUG',
            ':slug': 'test',
          },
        })
      );

      expect(mockDynamoDBOps.scan).not.toHaveBeenCalled();
    });

    it('should return null when slug not found', async () => {
      mockDynamoDBOps.query = jest.fn().mockResolvedValue({
        Items: [],
      });

      const result = await repository.findBySlug('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getMostViewed - GSI6 Usage', () => {
    it('should use GSI6 query instead of scan', async () => {
      mockDynamoDBOps.query = jest.fn().mockResolvedValue({
        Items: [
          {
            id: 'cnt_1',
            type: ContentType.POEMS,
            title: 'Popular',
            titleSlug: 'popular',
            body: 'Body',
            description: 'Desc',
            author: 'Author',
            status: ContentStatus.PUBLISHED,
            categoryIds: [],
            tagIds: [],
            viewCount: 1000,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      });

      await repository.getMostViewed(10);

      // Verify GSI6 was used with descending order
      expect(mockDynamoDBOps.query).toHaveBeenCalledWith(
        expect.objectContaining({
          indexName: 'GSI6',
          keyConditionExpression: 'GSI6PK = :popular',
          expressionAttributeValues: {
            ':popular': 'POPULAR',
          },
          scanIndexForward: false, // Descending order
          limit: 10,
        })
      );

      expect(mockDynamoDBOps.scan).not.toHaveBeenCalled();
    });
  });

  describe('Cursor-based Pagination', () => {
    it('should use exclusiveStartKey for pagination in findAll', async () => {
      const lastKey = { PK: 'CONTENT#cnt_20', SK: 'METADATA' };

      mockDynamoDBOps.query = jest.fn().mockResolvedValue({
        Items: [],
        Count: 0,
      });

      await repository.findAll({
        limit: 20,
        lastEvaluatedKey: lastKey,
      });

      expect(mockDynamoDBOps.query).toHaveBeenCalledWith(
        expect.objectContaining({
          exclusiveStartKey: lastKey,
          limit: 20,
        })
      );
    });

    it('should return lastEvaluatedKey in response', async () => {
      const lastKey = { PK: 'CONTENT#cnt_20', SK: 'METADATA' };

      mockDynamoDBOps.query = jest.fn().mockResolvedValue({
        Items: Array(20).fill({
          id: 'cnt_1',
          type: ContentType.POEMS,
          title: 'Test',
          titleSlug: 'test',
          body: 'Body',
          description: 'Desc',
          author: 'Author',
          status: ContentStatus.PUBLISHED,
          categoryIds: [],
          tagIds: [],
          viewCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        Count: 20,
        LastEvaluatedKey: lastKey,
      });

      const result = await repository.findAll({ limit: 20 });

      expect(result.lastEvaluatedKey).toEqual(lastKey);
      expect(result.hasMore).toBe(true);
    });

    it('should indicate no more results when LastEvaluatedKey is undefined', async () => {
      mockDynamoDBOps.query = jest.fn().mockResolvedValue({
        Items: Array(10).fill({
          id: 'cnt_1',
          type: ContentType.POEMS,
          title: 'Test',
          titleSlug: 'test',
          body: 'Body',
          description: 'Desc',
          author: 'Author',
          status: ContentStatus.PUBLISHED,
          categoryIds: [],
          tagIds: [],
          viewCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        Count: 10,
        LastEvaluatedKey: undefined,
      });

      const result = await repository.findAll({ limit: 20 });

      expect(result.lastEvaluatedKey).toBeUndefined();
      expect(result.hasMore).toBe(false);
    });
  });

  describe('Batch Operations for N+1 Fix', () => {
    it('should use batchGet in findByCategoryId instead of individual gets', async () => {
      mockDynamoDBOps.query = jest.fn().mockResolvedValue({
        Items: [
          { PK: 'CONTENT#cnt_1', SK: 'CATEGORY#cat_1' },
          { PK: 'CONTENT#cnt_2', SK: 'CATEGORY#cat_1' },
        ],
      });

      mockDynamoDBOps.batchGet = jest.fn().mockResolvedValue([
        {
          id: 'cnt_1',
          type: ContentType.POEMS,
          title: 'Test 1',
          titleSlug: 'test-1',
          body: 'Body',
          description: 'Desc',
          author: 'Author',
          status: ContentStatus.PUBLISHED,
          categoryIds: ['cat_1'],
          tagIds: [],
          viewCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'cnt_2',
          type: ContentType.POEMS,
          title: 'Test 2',
          titleSlug: 'test-2',
          body: 'Body',
          description: 'Desc',
          author: 'Author',
          status: ContentStatus.PUBLISHED,
          categoryIds: ['cat_1'],
          tagIds: [],
          viewCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      await repository.findByCategoryId('cat_1');

      // Should call batchGet once, not get multiple times
      expect(mockDynamoDBOps.batchGet).toHaveBeenCalledTimes(1);
      expect(mockDynamoDBOps.batchGet).toHaveBeenCalledWith([
        { PK: 'CONTENT#cnt_1', SK: 'METADATA' },
        { PK: 'CONTENT#cnt_2', SK: 'METADATA' },
      ]);
    });

    it('should use batchGet in findByTagId', async () => {
      mockDynamoDBOps.query = jest.fn().mockResolvedValue({
        Items: [
          { PK: 'CONTENT#cnt_1', SK: 'TAG#tag_1' },
          { PK: 'CONTENT#cnt_2', SK: 'TAG#tag_1' },
        ],
      });

      mockDynamoDBOps.batchGet = jest.fn().mockResolvedValue([
        {
          id: 'cnt_1',
          type: ContentType.POEMS,
          title: 'Test 1',
          titleSlug: 'test-1',
          body: 'Body',
          description: 'Desc',
          author: 'Author',
          status: ContentStatus.PUBLISHED,
          categoryIds: [],
          tagIds: ['tag_1'],
          viewCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      await repository.findByTagId('tag_1');

      expect(mockDynamoDBOps.batchGet).toHaveBeenCalledTimes(1);
    });

    it('should handle empty results in batch get', async () => {
      mockDynamoDBOps.query = jest.fn().mockResolvedValue({
        Items: [],
      });

      mockDynamoDBOps.batchGet = jest.fn().mockResolvedValue([]);

      const result = await repository.findByCategoryId('cat_empty');

      expect(result.items).toEqual([]);
      expect(mockDynamoDBOps.batchGet).not.toHaveBeenCalled(); // No batch if no items
    });
  });

  describe('Delete with Relationship Cleanup', () => {
    it('should delete content and all relationships', async () => {
      const mockContent = Content.create({
        type: ContentType.POEMS,
        title: 'Test',
        body: 'Body',
        description: 'Desc',
        author: 'Author',
      });

      // Add some categories and tags
      mockContent.addCategory('cat_1');
      mockContent.addCategory('cat_2');
      mockContent.addTag('tag_1');
      mockContent.addTag('tag_2');

      mockDynamoDBOps.get = jest.fn().mockResolvedValue({
        id: mockContent.id,
        type: mockContent.type,
        title: mockContent.title,
        titleSlug: mockContent.titleSlug,
        body: mockContent.body,
        description: mockContent.description,
        author: mockContent.author,
        status: mockContent.status,
        categoryIds: mockContent.categoryIds,
        tagIds: mockContent.tagIds,
        viewCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      mockDynamoDBOps.delete = jest.fn().mockResolvedValue({});

      await repository.delete(mockContent.id);

      // Should delete main content + 2 categories + 2 tags = 5 delete operations
      expect(mockDynamoDBOps.delete).toHaveBeenCalledTimes(5);

      // Verify main content deletion
      expect(mockDynamoDBOps.delete).toHaveBeenCalledWith({
        PK: `CONTENT#${mockContent.id}`,
        SK: 'METADATA',
      });

      // Verify category relationship deletions
      expect(mockDynamoDBOps.delete).toHaveBeenCalledWith({
        PK: `CONTENT#${mockContent.id}`,
        SK: 'CATEGORY#cat_1',
      });
      expect(mockDynamoDBOps.delete).toHaveBeenCalledWith({
        PK: `CONTENT#${mockContent.id}`,
        SK: 'CATEGORY#cat_2',
      });

      // Verify tag relationship deletions
      expect(mockDynamoDBOps.delete).toHaveBeenCalledWith({
        PK: `CONTENT#${mockContent.id}`,
        SK: 'TAG#tag_1',
      });
      expect(mockDynamoDBOps.delete).toHaveBeenCalledWith({
        PK: `CONTENT#${mockContent.id}`,
        SK: 'TAG#tag_2',
      });
    });

    it('should handle deletion of non-existent content gracefully', async () => {
      mockDynamoDBOps.get = jest.fn().mockResolvedValue(undefined);
      mockDynamoDBOps.delete = jest.fn().mockResolvedValue({});

      await repository.delete('nonexistent');

      // Should not attempt any deletions
      expect(mockDynamoDBOps.delete).not.toHaveBeenCalled();
    });

    it('should continue deletion even if relationship deletion fails', async () => {
      const mockContent = Content.create({
        type: ContentType.POEMS,
        title: 'Test',
        body: 'Body',
        description: 'Desc',
        author: 'Author',
      });

      mockContent.addCategory('cat_1');

      mockDynamoDBOps.get = jest.fn().mockResolvedValue({
        id: mockContent.id,
        type: mockContent.type,
        title: mockContent.title,
        titleSlug: mockContent.titleSlug,
        body: mockContent.body,
        description: mockContent.description,
        author: mockContent.author,
        status: mockContent.status,
        categoryIds: mockContent.categoryIds,
        tagIds: [],
        viewCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Main content deletion succeeds
      mockDynamoDBOps.delete = jest.fn()
        .mockResolvedValueOnce({}) // Main deletion
        .mockRejectedValueOnce(new Error('Relationship delete failed')); // Category deletion fails

      // Should not throw error
      await expect(repository.delete(mockContent.id)).resolves.not.toThrow();
    });
  });

  describe('GSI Population in toDBItem', () => {
    it('should populate all GSI fields when saving content', async () => {
      const content = Content.create({
        type: ContentType.POEMS,
        title: 'Test Poem',
        body: 'Beautiful poetry',
        description: 'A test poem',
        author: 'Poet',
      });

      // Manually increment view count
      content.incrementViewCount();
      content.incrementViewCount();

      mockDynamoDBOps.put = jest.fn().mockResolvedValue({});

      await repository.save(content);

      // Verify GSI fields were populated
      expect(mockDynamoDBOps.put).toHaveBeenCalledWith(
        expect.objectContaining({
          // GSI5 for slug lookup
          GSI5PK: 'SLUG',
          GSI5SK: content.titleSlug,
          // GSI6 for popular content
          GSI6PK: 'POPULAR',
          GSI6SK: expect.stringMatching(/^0000000002#/), // viewCount=2, zero-padded
        })
      );
    });
  });
});
