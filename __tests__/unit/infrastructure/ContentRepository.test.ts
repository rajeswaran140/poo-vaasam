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

      // status is now applied as a FilterExpression so DRAFT/ARCHIVED rows
      // can't leak onto public listings.
      expect(DynamoDBOperations.query).toHaveBeenCalledWith({
        indexName: 'GSI1',
        keyConditionExpression: 'GSI1PK = :type',
        filterExpression: '#status = :status',
        expressionAttributeNames: { '#status': 'status' },
        expressionAttributeValues: {
          ':type': `CONTENT#${ContentType.POEMS}`,
          ':status': ContentStatus.PUBLISHED,
        },
        limit: 50,
        scanIndexForward: false,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].type).toBe(ContentType.POEMS);
    });

    it('omits the status filter when no status is requested', async () => {
      (DynamoDBOperations.query as jest.Mock).mockResolvedValue({ Items: [], Count: 0 });
      await repository.findByType(ContentType.SONGS, { limit: 10 });
      expect(DynamoDBOperations.query).toHaveBeenCalledWith({
        indexName: 'GSI1',
        keyConditionExpression: 'GSI1PK = :type',
        expressionAttributeValues: { ':type': `CONTENT#${ContentType.SONGS}` },
        limit: 10,
        scanIndexForward: false,
      });
    });

    // Build a raw GSI1 item with the keys findByType needs for an item cursor.
    const rawItem = (n: number) => ({
      id: `cnt_${n}`,
      type: ContentType.SONGS,
      title: `Song ${n}`,
      titleSlug: `song-${n}`,
      body: 'b',
      description: '',
      author: 'A',
      status: ContentStatus.PUBLISHED,
      categoryIds: [],
      tagIds: [],
      viewCount: 0,
      createdAt: new Date('2026-01-01').toISOString(),
      updatedAt: new Date('2026-01-01').toISOString(),
      PK: `CONTENT#cnt_${n}`,
      SK: 'METADATA',
      GSI1PK: `CONTENT#${ContentType.SONGS}`,
      GSI1SK: `2026#cnt_${n}`,
    });

    it('pages through under-filled filtered responses until `limit` matches are collected', async () => {
      // DynamoDB applies Limit before the filter, so each page yields only 2
      // matching rows. We need a full page of 5.
      (DynamoDBOperations.query as jest.Mock)
        .mockResolvedValueOnce({ Items: [rawItem(1), rawItem(2)], LastEvaluatedKey: { p: 1 } })
        .mockResolvedValueOnce({ Items: [rawItem(3), rawItem(4)], LastEvaluatedKey: { p: 2 } })
        .mockResolvedValueOnce({ Items: [rawItem(5), rawItem(6)], LastEvaluatedKey: { p: 3 } });

      const result = await repository.findByType(ContentType.SONGS, {
        limit: 5,
        status: ContentStatus.PUBLISHED,
      });

      // Three internal queries to gather 5 (not stopping at the first short page).
      expect(DynamoDBOperations.query).toHaveBeenCalledTimes(3);
      expect(result.items).toHaveLength(5);
      // Filled the page and more remain → item-level cursor (the 5th item), not
      // the page cursor, so item #6 (read but not returned) isn't skipped.
      expect(result.hasMore).toBe(true);
      expect(result.lastEvaluatedKey).toEqual({
        PK: 'CONTENT#cnt_5',
        SK: 'METADATA',
        GSI1PK: `CONTENT#${ContentType.SONGS}`,
        GSI1SK: '2026#cnt_5',
      });
    });

    it('stops with no cursor when the index is exhausted before `limit`', async () => {
      (DynamoDBOperations.query as jest.Mock)
        .mockResolvedValueOnce({ Items: [rawItem(1)], LastEvaluatedKey: { p: 1 } })
        .mockResolvedValueOnce({ Items: [rawItem(2)], LastEvaluatedKey: undefined });

      const result = await repository.findByType(ContentType.SONGS, {
        limit: 5,
        status: ContentStatus.PUBLISHED,
      });

      expect(DynamoDBOperations.query).toHaveBeenCalledTimes(2);
      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(false);
      expect(result.lastEvaluatedKey).toBeUndefined();
    });

    it('resumes from a provided item-level cursor', async () => {
      (DynamoDBOperations.query as jest.Mock).mockResolvedValueOnce({
        Items: [rawItem(7)],
        LastEvaluatedKey: undefined,
      });
      const cursor = { PK: 'CONTENT#cnt_6', SK: 'METADATA', GSI1PK: `CONTENT#${ContentType.SONGS}`, GSI1SK: '2026#cnt_6' };

      await repository.findByType(ContentType.SONGS, {
        limit: 5,
        status: ContentStatus.PUBLISHED,
        lastEvaluatedKey: cursor,
      });

      expect(DynamoDBOperations.query).toHaveBeenCalledWith(
        expect.objectContaining({ exclusiveStartKey: cursor })
      );
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

  describe('incrementViewCount', () => {
    it('guards the update with attribute_exists(PK) so it cannot resurrect a deleted item', async () => {
      (DynamoDBOperations.update as jest.Mock).mockResolvedValue({});
      await repository.incrementViewCount('cnt_1');
      expect(DynamoDBOperations.update).toHaveBeenCalledWith(
        expect.objectContaining({ conditionExpression: 'attribute_exists(PK)' })
      );
    });

    it('swallows ConditionalCheckFailedException (content deleted mid-view)', async () => {
      const err = new Error('The conditional request failed');
      err.name = 'ConditionalCheckFailedException';
      (DynamoDBOperations.update as jest.Mock).mockRejectedValue(err);
      await expect(repository.incrementViewCount('cnt_gone')).resolves.toBeUndefined();
    });

    it('rethrows other DynamoDB errors', async () => {
      (DynamoDBOperations.update as jest.Mock).mockRejectedValue(new Error('ProvisionedThroughputExceeded'));
      await expect(repository.incrementViewCount('cnt_1')).rejects.toThrow('ProvisionedThroughputExceeded');
    });
  });
});
