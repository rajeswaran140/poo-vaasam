/** @jest-environment node */
/**
 * Tests for DynamoDBOperations.batchGet / batchWrite chunking + unprocessed
 * retry. DynamoDB caps BatchGetItem at 100 keys and BatchWriteItem at 25 items
 * per request, and returns throttled remainder in UnprocessedKeys/Items — these
 * must be chunked and retried, never silently dropped.
 */

const mockSend = jest.fn();

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      // Defer reading mockSend to call-time: the ESM import of the module under
      // test is hoisted above `const mockSend`, so `from()` runs first.
      from: () => ({ send: (...args: unknown[]) => mockSend(...args) }),
    },
  };
});

import { DynamoDBOperations, TABLE_NAME } from '@/infrastructure/database/dynamodb-client';

beforeEach(() => {
  mockSend.mockReset();
});

describe('DynamoDBOperations.batchGet', () => {
  it('chunks >100 keys into multiple requests and aggregates all items', async () => {
    const keys = Array.from({ length: 250 }, (_, i) => ({ PK: `K#${i}`, SK: 'META' }));

    // Each call echoes back one item per requested key.
    mockSend.mockImplementation((command: any) => {
      const requested = command.input.RequestItems[TABLE_NAME].Keys;
      return Promise.resolve({
        Responses: { [TABLE_NAME]: requested.map((k: any) => ({ ...k, found: true })) },
      });
    });

    const items = await DynamoDBOperations.batchGet(keys);

    // 250 keys → ceil(250/100) = 3 requests, every item returned.
    expect(mockSend).toHaveBeenCalledTimes(3);
    expect(items).toHaveLength(250);
  });

  it('retries UnprocessedKeys instead of dropping them', async () => {
    const keys = [{ PK: 'A', SK: 'M' }, { PK: 'B', SK: 'M' }];

    mockSend
      .mockResolvedValueOnce({
        Responses: { [TABLE_NAME]: [{ PK: 'A', SK: 'M' }] },
        UnprocessedKeys: { [TABLE_NAME]: { Keys: [{ PK: 'B', SK: 'M' }] } },
      })
      .mockResolvedValueOnce({
        Responses: { [TABLE_NAME]: [{ PK: 'B', SK: 'M' }] },
      });

    const items = await DynamoDBOperations.batchGet(keys);

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(items).toHaveLength(2);
  });
});

describe('DynamoDBOperations.batchWrite', () => {
  it('chunks >25 items into multiple requests', async () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ PK: `K#${i}`, SK: 'META' }));
    mockSend.mockResolvedValue({});

    await DynamoDBOperations.batchWrite(items);

    // 60 items → ceil(60/25) = 3 requests.
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it('retries UnprocessedItems instead of dropping them', async () => {
    const items = [{ PK: 'A', SK: 'M' }, { PK: 'B', SK: 'M' }];

    mockSend
      .mockResolvedValueOnce({
        UnprocessedItems: { [TABLE_NAME]: [{ PutRequest: { Item: { PK: 'B', SK: 'M' } } }] },
      })
      .mockResolvedValueOnce({});

    await DynamoDBOperations.batchWrite(items);

    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
