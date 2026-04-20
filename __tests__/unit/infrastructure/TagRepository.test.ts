/**
 * Tag Repository Tests
 *
 * Tests for the fixed decrementContentCount bug
 */

import { TagRepository } from '@/infrastructure/database/TagRepository';
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

describe('TagRepository', () => {
  let repository: TagRepository;

  beforeEach(() => {
    repository = new TagRepository();
    jest.clearAllMocks();
  });

  describe('decrementContentCount', () => {
    it('should decrement content count when count is greater than zero', async () => {
      (DynamoDBOperations.update as jest.Mock).mockResolvedValue({});

      await repository.decrementContentCount('tag_123');

      expect(DynamoDBOperations.update).toHaveBeenCalledWith({
        key: {
          PK: 'TAG#tag_123',
          SK: 'METADATA',
        },
        updateExpression: 'SET #contentCount = if_not_exists(#contentCount, :one) - :dec',
        conditionExpression: '#contentCount > :zero',
        expressionAttributeNames: {
          '#contentCount': 'contentCount',
        },
        expressionAttributeValues: {
          ':zero': 0,
          ':one': 1,
          ':dec': 1,
        },
      });
    });

    it('should silently ignore ConditionalCheckFailedException when count is already zero', async () => {
      const conditionalError = new Error('ConditionalCheckFailedException');
      (conditionalError as any).name = 'ConditionalCheckFailedException';
      (DynamoDBOperations.update as jest.Mock).mockRejectedValue(conditionalError);

      // Should not throw
      await expect(repository.decrementContentCount('tag_123')).resolves.toBeUndefined();
    });

    it('should throw other errors that are not ConditionalCheckFailedException', async () => {
      const otherError = new Error('Some other error');
      (otherError as any).name = 'OtherError';
      (DynamoDBOperations.update as jest.Mock).mockRejectedValue(otherError);

      await expect(repository.decrementContentCount('tag_123')).rejects.toThrow('Some other error');
    });

    it('should prevent count from going negative', async () => {
      // First decrement succeeds (count was 1, now 0)
      (DynamoDBOperations.update as jest.Mock).mockResolvedValueOnce({});

      await repository.decrementContentCount('tag_123');

      // Second decrement fails with conditional check (count is 0, cannot go negative)
      const conditionalError = new Error('ConditionalCheckFailedException');
      (conditionalError as any).name = 'ConditionalCheckFailedException';
      (DynamoDBOperations.update as jest.Mock).mockRejectedValueOnce(conditionalError);

      // Should not throw - silently ignores
      await expect(repository.decrementContentCount('tag_123')).resolves.toBeUndefined();
    });
  });

  describe('incrementContentCount', () => {
    it('should increment content count correctly', async () => {
      (DynamoDBOperations.update as jest.Mock).mockResolvedValue({});

      await repository.incrementContentCount('tag_123');

      expect(DynamoDBOperations.update).toHaveBeenCalledWith({
        key: {
          PK: 'TAG#tag_123',
          SK: 'METADATA',
        },
        updateExpression: 'SET #contentCount = if_not_exists(#contentCount, :zero) + :inc',
        expressionAttributeNames: {
          '#contentCount': 'contentCount',
        },
        expressionAttributeValues: {
          ':zero': 0,
          ':inc': 1,
        },
      });
    });
  });
});
