/**
 * Category Repository Tests
 *
 * Tests for the fixed decrementContentCount bug
 */

import { CategoryRepository } from '@/infrastructure/database/CategoryRepository';
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

describe('CategoryRepository', () => {
  let repository: CategoryRepository;

  beforeEach(() => {
    repository = new CategoryRepository();
    jest.clearAllMocks();
  });

  describe('decrementContentCount', () => {
    it('should decrement content count when count is greater than zero', async () => {
      (DynamoDBOperations.update as jest.Mock).mockResolvedValue({});

      await repository.decrementContentCount('cat_123');

      expect(DynamoDBOperations.update).toHaveBeenCalledWith({
        key: {
          PK: 'CATEGORY#cat_123',
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
      await expect(repository.decrementContentCount('cat_123')).resolves.toBeUndefined();
    });

    it('should throw other errors that are not ConditionalCheckFailedException', async () => {
      const otherError = new Error('Some other error');
      (otherError as any).name = 'OtherError';
      (DynamoDBOperations.update as jest.Mock).mockRejectedValue(otherError);

      await expect(repository.decrementContentCount('cat_123')).rejects.toThrow('Some other error');
    });

    it('should initialize count to 1 if it does not exist (then decrement to 0)', async () => {
      (DynamoDBOperations.update as jest.Mock).mockResolvedValue({});

      await repository.decrementContentCount('cat_new');

      expect(DynamoDBOperations.update).toHaveBeenCalledWith(
        expect.objectContaining({
          updateExpression: 'SET #contentCount = if_not_exists(#contentCount, :one) - :dec',
          expressionAttributeValues: expect.objectContaining({
            ':one': 1,
            ':dec': 1,
          }),
        })
      );
    });
  });

  describe('incrementContentCount', () => {
    it('should increment content count correctly', async () => {
      (DynamoDBOperations.update as jest.Mock).mockResolvedValue({});

      await repository.incrementContentCount('cat_123');

      expect(DynamoDBOperations.update).toHaveBeenCalledWith({
        key: {
          PK: 'CATEGORY#cat_123',
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
