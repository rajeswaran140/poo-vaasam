/**
 * Table Schema Diagnostic
 * Shows DynamoDB table structure and indexes
 */

import { NextResponse } from 'next/server';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { dynamoDBConfig } from '@/lib/aws-config';

export async function GET() {
  try {
    // Create client with current config
    const clientConfig: any = {
      region: dynamoDBConfig.region,
    };

    if (dynamoDBConfig.credentials) {
      clientConfig.credentials = dynamoDBConfig.credentials;
    }

    const client = new DynamoDBClient(clientConfig);

    // Describe the table
    const command = new DescribeTableCommand({
      TableName: dynamoDBConfig.tableName,
    });

    const response = await client.send(command);
    const table = response.Table;

    return NextResponse.json({
      success: true,
      tableName: table?.TableName,
      tableStatus: table?.TableStatus,
      keySchema: table?.KeySchema,
      gsi: table?.GlobalSecondaryIndexes?.map((index) => ({
        name: index.IndexName,
        keySchema: index.KeySchema,
        status: index.IndexStatus,
      })),
      lsi: table?.LocalSecondaryIndexes?.map((index) => ({
        name: index.IndexName,
        keySchema: index.KeySchema,
      })),
      itemCount: table?.ItemCount,
      createdAt: table?.CreationDateTime,
    });
  } catch (error: any) {
    console.error('[TABLE-SCHEMA] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        errorName: error.name,
      },
      { status: 500 }
    );
  }
}
