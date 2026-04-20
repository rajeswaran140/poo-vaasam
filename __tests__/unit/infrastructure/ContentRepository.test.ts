/**
 * Content Repository Tests
 *
 * Tests for repository methods used in SSR data fetching (B1 fix)
 */

import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { Content } from '@/domain/entities/Content';
import { ContentType, ContentStatus } from '@/types/content';
import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';

// Mock DynamoDB operations
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: {
    put: jest.fn(),
    get: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    scan: jest.fn(),
    query: jest.fn(),
    batchGet: jest.fn(),
  },
  handleDynamoDBError: jest.fn((error) => {
    throw error;
  }),
}));

describe('ContentRepository', () => {
  let repository: ContentRepository;

  beforeEach(() => {
    repository = new ContentRepository();
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return paginated published content', async () => {
      const mockItems = [
        {
          id: 'cnt_1',
          type: ContentType.SONGS,
          title: 'Test Song',
          titleSlug: 'test-song',
          body: 'Test body',
          description: 'Test description',
          author: 'Test Author',
          status: ContentStatus.PUBLISHED,
          categoryIds: [],
          tagIds: [],
          viewCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      (DynamoDBOperations.query as jest.Mock).mockResolvedValue({
        Items: mockItems,
        Count: 1,
      });

      const result = await repository.findAll({
        limit: 6,
        status: ContentStatus.PUBLISHED,
      });

      expect(DynamoDBOperations.query).toHaveBeenCalledWith({
        indexName: 'GSI4',
        keyConditionExpression: 'GSI4PK = :status',
        expressionAttributeValues: {
          ':status': ContentStatus.PUBLISHED,
        },
        limit: 6,
        scanIndexForward: false,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toBeInstanceOf(Content);
      expect(result.items[0].title).toBe('Test Song');
      expect(result.total).toBe(1);
      expect(result.limit).toBe(6);
    });

    it('should handle empty results', async () => {
      (DynamoDBOperations.query as jest.Mock).mockResolvedValue({
        Items: [],
        Count: 0,
      });

      const result = await repository.findAll({
        limit: 6,
        status: ContentStatus.PUBLISHED,
      });

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('findByType', () => {
    it('should return content filtered by type', async () => {
      const mockItems = [
        {
          id: 'cnt_1',
          type: ContentType.POEMS,
          title: 'Test Poem',
          titleSlug: 'test-poem',
          body: 'Test body',
          description: 'Test description',
          author: 'Test Poet',
          status: ContentStatus.PUBLISHED,
          categoryIds: [],
          tagIds: [],
          viewCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      (DynamoDBOperations.query as jest.Mock).mockResolvedValue({
        Items: mockItems,
        Count: 1,
      });

      const result = await repository.findByType(ContentType.POEMS, {
        limit: 50,
        status: ContentStatus.PUBLISHED,
      });

      expect(DynamoDBOperations.query).toHaveBeenCalledWith({
        indexName: 'GSI1',
        keyConditionExpression: 'GSI1PK = :type',
        expressionAttributeValues: {
          ':type': `CONTENT#${ContentType.POEMS}`,
        },
        limit: 50,
        scanIndexForward: false,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].type).toBe(ContentType.POEMS);
    });
  });

  describe('findById', () => {
    it('should return content by ID', async () => {
      const mockItem = {
        id: 'cnt_123',
        type: ContentType.SONGS,
        title: 'Test Song',
        titleSlug: 'test-song',
        body: 'Test body',
        description: 'Test description',
        author: 'Test Author',
        status: ContentStatus.PUBLISHED,
        audioUrl: 'https://example.com/audio.mp3',
        categoryIds: [],
        tagIds: [],
        viewCount: 10,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      (DynamoDBOperations.get as jest.Mock).mockResolvedValue(mockItem);

      const result = await repository.findById('cnt_123');

      expect(DynamoDBOperations.get).toHaveBeenCalledWith({
        PK: 'CONTENT#cnt_123',
        SK: 'METADATA',
      });

      expect(result).toBeInstanceOf(Content);
      expect(result?.id).toBe('cnt_123');
      expect(result?.title).toBe('Test Song');
      expect(result?.audioUrl).toBe('https://example.com/audio.mp3');
    });

    it('should return null if content not found', async () => {
      (DynamoDBOperations.get as jest.Mock).mockResolvedValue(null);

      const result = await repository.findById('cnt_nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('countByType', () => {
    it('should return count of content by type', async () => {
      (DynamoDBOperations.query as jest.Mock).mockResolvedValue({
        Count: 42,
      });

      const result = await repository.countByType(ContentType.SONGS);

      expect(DynamoDBOperations.query).toHaveBeenCalledWith({
        indexName: 'GSI1',
        keyConditionExpression: 'GSI1PK = :type',
        expressionAttributeValues: {
          ':type': `CONTENT#${ContentType.SONGS}`,
        },
      });

      expect(result).toBe(42);
    });
  });

  describe('countByStatus', () => {
    it('should return count of content by status', async () => {
      (DynamoDBOperations.query as jest.Mock).mockResolvedValue({
        Count: 15,
      });

      const result = await repository.countByStatus(ContentStatus.PUBLISHED);

      expect(DynamoDBOperations.query).toHaveBeenCalledWith({
        indexName: 'GSI4',
        keyConditionExpression: 'GSI4PK = :status',
        expressionAttributeValues: {
          ':status': ContentStatus.PUBLISHED,
        },
      });

      expect(result).toBe(15);
    });
  });

  describe('toObject serialization', () => {
    it('should serialize Content without underscore prefixes', () => {
      const content = Content.create({
        type: ContentType.LYRICS,
        title: 'பூ வாசம்',
        body: 'Test lyrics',
        description: 'Test description',
        author: 'Test Author',
      });

      const obj = content.toObject();

      // Should NOT have underscore prefixes (B2 fix verification)
      expect(obj).toHaveProperty('title', 'பூ வாசம்');
      expect(obj).toHaveProperty('author', 'Test Author');
      expect(obj).toHaveProperty('body', 'Test lyrics');
      expect(obj).toHaveProperty('description', 'Test description');
      expect(obj).toHaveProperty('status');
      expect(obj).toHaveProperty('viewCount', 0);

      // Should NOT have these properties
      expect(obj).not.toHaveProperty('_title');
      expect(obj).not.toHaveProperty('_author');
      expect(obj).not.toHaveProperty('_body');
    });
  });
});
