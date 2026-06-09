/**
 * DynamoDB Client
 *
 * Infrastructure layer - DynamoDB connection and operations
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
  BatchWriteCommand,
  BatchGetCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { dynamoDBConfig } from '@/lib/aws-config';

/**
 * Create DynamoDB Client
 */
const createDynamoDBClient = () => {
  // Build client configuration
  const clientConfig: any = {
    region: dynamoDBConfig.region,
  };

  // Add credentials if available (required for Amplify Hosting)
  if (dynamoDBConfig.credentials) {
    clientConfig.credentials = dynamoDBConfig.credentials;
  }

  const client = new DynamoDBClient(clientConfig);

  // Create DocumentClient for easier object handling
  const docClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      removeUndefinedValues: true, // Remove undefined values
      convertEmptyValues: false, // Don't convert empty strings to null
    },
    unmarshallOptions: {
      wrapNumbers: false, // Return numbers as JavaScript numbers
    },
  });

  return docClient;
};

/**
 * DynamoDB Client Instance (singleton)
 */
export const dynamoDBClient = createDynamoDBClient();

/**
 * Table name from configuration
 */
export const TABLE_NAME = dynamoDBConfig.tableName;

// Batch-operation tuning: DynamoDB returns unprocessed keys/items under
// throttling; we retry them a few times with linear backoff before giving up.
const MAX_BATCH_RETRIES = 5;
const BATCH_BACKOFF_MS = 50;

/** Split an array into chunks of at most `size`. */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * DynamoDB Operations Helper
 */
export class DynamoDBOperations {
  /**
   * Put an item
   */
  static async put(item: Record<string, any>) {
    const command = new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
    });

    return await dynamoDBClient.send(command);
  }

  /**
   * Get an item by primary key
   */
  static async get(key: Record<string, any>) {
    const command = new GetCommand({
      TableName: TABLE_NAME,
      Key: key,
    });

    const response = await dynamoDBClient.send(command);
    return response.Item;
  }

  /**
   * Query items
   */
  static async query(params: {
    keyConditionExpression: string;
    expressionAttributeValues: Record<string, any>;
    expressionAttributeNames?: Record<string, string>;
    filterExpression?: string;
    indexName?: string;
    limit?: number;
    scanIndexForward?: boolean;
    exclusiveStartKey?: Record<string, any>;
  }) {
    const command = new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: params.keyConditionExpression,
      ExpressionAttributeValues: params.expressionAttributeValues,
      ExpressionAttributeNames: params.expressionAttributeNames,
      FilterExpression: params.filterExpression,
      IndexName: params.indexName,
      Limit: params.limit,
      ScanIndexForward: params.scanIndexForward,
      ExclusiveStartKey: params.exclusiveStartKey,
    });

    return await dynamoDBClient.send(command);
  }

  /**
   * Update an item
   */
  static async update(params: {
    key: Record<string, any>;
    updateExpression: string;
    expressionAttributeValues: Record<string, any>;
    expressionAttributeNames?: Record<string, string>;
    conditionExpression?: string;
  }) {
    const command = new UpdateCommand({
      TableName: TABLE_NAME,
      Key: params.key,
      UpdateExpression: params.updateExpression,
      ExpressionAttributeValues: params.expressionAttributeValues,
      ExpressionAttributeNames: params.expressionAttributeNames,
      ConditionExpression: params.conditionExpression,
      ReturnValues: 'ALL_NEW',
    });

    const response = await dynamoDBClient.send(command);
    return response.Attributes;
  }

  /**
   * Delete an item
   */
  static async delete(key: Record<string, any>) {
    const command = new DeleteCommand({
      TableName: TABLE_NAME,
      Key: key,
    });

    return await dynamoDBClient.send(command);
  }

  /**
   * Scan table
   */
  static async scan(params?: {
    filterExpression?: string;
    expressionAttributeValues?: Record<string, any>;
    expressionAttributeNames?: Record<string, string>;
    limit?: number;
    exclusiveStartKey?: Record<string, any>;
  }) {
    const command = new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: params?.filterExpression,
      ExpressionAttributeValues: params?.expressionAttributeValues,
      ExpressionAttributeNames: params?.expressionAttributeNames,
      Limit: params?.limit,
      ExclusiveStartKey: params?.exclusiveStartKey,
    });

    return await dynamoDBClient.send(command);
  }

  /**
   * Batch write items.
   *
   * DynamoDB caps BatchWriteItem at 25 items per request and returns any items
   * it didn't process (throttling/capacity) in `UnprocessedItems`. We therefore
   * chunk to 25 and retry the unprocessed remainder with exponential backoff so
   * writes are never silently lost.
   */
  static async batchWrite(items: Record<string, any>[]) {
    for (const chunk of chunkArray(items, 25)) {
      let requests = chunk.map((item) => ({ PutRequest: { Item: item } }));
      let attempt = 0;

      while (requests.length > 0) {
        const response = await dynamoDBClient.send(
          new BatchWriteCommand({ RequestItems: { [TABLE_NAME]: requests } })
        );

        const unprocessed = response.UnprocessedItems?.[TABLE_NAME];
        if (!unprocessed || unprocessed.length === 0) break;

        if (++attempt > MAX_BATCH_RETRIES) {
          throw new Error(
            `batchWrite: ${unprocessed.length} item(s) still unprocessed after ${MAX_BATCH_RETRIES} retries`
          );
        }
        requests = unprocessed as typeof requests;
        await sleep(BATCH_BACKOFF_MS * attempt);
      }
    }
  }

  /**
   * Batch get items.
   *
   * DynamoDB caps BatchGetItem at 100 keys per request and returns any keys it
   * didn't return (throttling) in `UnprocessedKeys`. We chunk to 100 and retry
   * the unprocessed remainder with backoff so reads are never silently
   * truncated (which would drop content from category/tag listings).
   */
  static async batchGet(keys: Record<string, any>[]) {
    const results: Record<string, any>[] = [];

    for (const chunk of chunkArray(keys, 100)) {
      let pending = chunk;
      let attempt = 0;

      while (pending.length > 0) {
        const response = await dynamoDBClient.send(
          new BatchGetCommand({ RequestItems: { [TABLE_NAME]: { Keys: pending } } })
        );

        const items = response.Responses?.[TABLE_NAME] ?? [];
        results.push(...items);

        const unprocessed = response.UnprocessedKeys?.[TABLE_NAME]?.Keys;
        if (!unprocessed || unprocessed.length === 0) break;

        if (++attempt > MAX_BATCH_RETRIES) {
          throw new Error(
            `batchGet: ${unprocessed.length} key(s) still unprocessed after ${MAX_BATCH_RETRIES} retries`
          );
        }
        pending = unprocessed as typeof pending;
        await sleep(BATCH_BACKOFF_MS * attempt);
      }
    }

    return results;
  }

  /**
   * Atomically write several items in a single transaction. Each entry is a
   * `{ Put | Update | Delete | ConditionCheck: {...} }` whose `TableName` is
   * injected here, so callers pass only the operation body (Item / Key /
   * ConditionExpression / …). Either every item commits or none do — used to
   * keep a content row, its slug-uniqueness guard, and its taxonomy
   * relationship rows consistent. Throws `TransactionCanceledException` if any
   * condition (e.g. a duplicate slug guard) fails.
   */
  static async transactWrite(items: Array<Record<string, any>>) {
    const TransactItems = items.map((entry) => {
      const op = Object.keys(entry)[0];
      return { [op]: { TableName: TABLE_NAME, ...entry[op] } };
    });

    const command = new TransactWriteCommand({ TransactItems });
    return await dynamoDBClient.send(command);
  }
}

/**
 * Error handler for DynamoDB operations
 */
export class DynamoDBError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'DynamoDBError';
  }
}

/**
 * Handle DynamoDB errors
 */
export function handleDynamoDBError(error: any): never {
  console.error('DynamoDB Error:', error);

  if (error.name === 'ResourceNotFoundException') {
    throw new DynamoDBError(
      `Table ${TABLE_NAME} not found. Please create the table first.`,
      error.name,
      404
    );
  }

  if (error.name === 'ConditionalCheckFailedException') {
    throw new DynamoDBError(
      'Conditional check failed',
      error.name,
      400
    );
  }

  if (error.name === 'ProvisionedThroughputExceededException') {
    throw new DynamoDBError(
      'Request rate exceeded',
      error.name,
      429
    );
  }

  if (error.name === 'ValidationException') {
    throw new DynamoDBError(
      `Validation error: ${error.message}`,
      error.name,
      400
    );
  }

  throw new DynamoDBError(
    error.message || 'Unknown DynamoDB error',
    error.name,
    500
  );
}
