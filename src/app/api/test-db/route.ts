/**
 * Test Database Connection
 * Attempts to connect to DynamoDB and returns detailed error info
 */

import { NextResponse } from 'next/server';
import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { dynamoDBConfig } from '@/lib/aws-config';

export async function GET() {
  try {
    console.log('[TEST-DB] DynamoDB Config:', {
      region: dynamoDBConfig.region,
      hasCredentials: !!dynamoDBConfig.credentials,
      tableName: dynamoDBConfig.tableName,
    });

    // Create client with current config
    const clientConfig: any = {
      region: dynamoDBConfig.region,
    };

    if (dynamoDBConfig.credentials) {
      clientConfig.credentials = dynamoDBConfig.credentials;
      console.log('[TEST-DB] Using explicit credentials');
    } else {
      console.log('[TEST-DB] Using IAM role credentials (undefined)');
    }

    const client = new DynamoDBClient(clientConfig);

    // Try to list tables
    const command = new ListTablesCommand({});
    const response = await client.send(command);

    return NextResponse.json({
      success: true,
      message: 'DynamoDB connection successful',
      tables: response.TableNames,
      config: {
        region: dynamoDBConfig.region,
        tableName: dynamoDBConfig.tableName,
        hasExplicitCredentials: !!dynamoDBConfig.credentials,
      },
    });
  } catch (error: any) {
    console.error('[TEST-DB] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        errorCode: error.Code,
        errorName: error.name,
        details: error.toString(),
        // Environment variables for debugging
        env: {
          APP_AWS_ACCESS_KEY_ID: process.env.APP_AWS_ACCESS_KEY_ID ? 'SET' : 'NOT SET',
          AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ? 'SET' : 'NOT SET',
          DYNAMODB_TABLE_NAME: process.env.DYNAMODB_TABLE_NAME || 'NOT SET',
          AWS_REGION: process.env.AWS_REGION || 'NOT SET',
        },
      },
      { status: 500 }
    );
  }
}
