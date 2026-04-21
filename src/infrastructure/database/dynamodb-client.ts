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
} from '@aws-sdk/lib-dynamodb';
import { dynamoDBConfig } from '@/lib/aws-config';

/**
 * Create DynamoDB Client
 */
const createDynamoDBClient = () => {
  const client = new DynamoDBClient({
    region: dynamoDBConfig.region,
    credentials: dynamoDBConfig.credentials,
  });

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
   * Batch write items
   */
  static async batchWrite(items: Record<string, any>[]) {
    const command = new BatchWriteCommand({
      RequestItems: {
        [TABLE_NAME]: items.map((item) => ({
          PutRequest: {
            Item: item,
          },
        })),
      },
    });

    return await dynamoDBClient.send(command);
  }

  /**
   * Batch get items
   */
  static async batchGet(keys: Record<string, any>[]) {
    const command = new BatchGetCommand({
      RequestItems: {
        [TABLE_NAME]: {
          Keys: keys,
        },
      },
    });

    const response = await dynamoDBClient.send(command);
    return response.Responses?.[TABLE_NAME] || [];
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
