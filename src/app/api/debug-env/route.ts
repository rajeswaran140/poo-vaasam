import { NextResponse } from 'next/server';

/**
 * Debug API to check environment variables
 * Server-side check
 */

export async function GET() {
  const config = {
    // Cognito Config
    userPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID || 'NOT SET',
    clientId: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID || 'NOT SET',
    region: process.env.NEXT_PUBLIC_AWS_REGION || 'NOT SET',
    userPoolIdSet: !!process.env.NEXT_PUBLIC_USER_POOL_ID,
    clientIdSet: !!process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID,
    regionSet: !!process.env.NEXT_PUBLIC_AWS_REGION,
    userPoolIdPreview: process.env.NEXT_PUBLIC_USER_POOL_ID?.substring(0, 15) + '...' || 'NOT SET',
    clientIdPreview: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID?.substring(0, 10) + '...' || 'NOT SET',

    // AWS Credentials (server-side only)
    hasAppAwsAccessKey: !!process.env.APP_AWS_ACCESS_KEY_ID,
    hasAppAwsSecretKey: !!process.env.APP_AWS_SECRET_ACCESS_KEY,
    hasAwsAccessKey: !!process.env.AWS_ACCESS_KEY_ID,
    hasAwsSecretKey: !!process.env.AWS_SECRET_ACCESS_KEY,
    appAwsAccessKeyPreview: process.env.APP_AWS_ACCESS_KEY_ID?.substring(0, 10) + '...' || 'NOT SET',

    // DynamoDB Config
    dynamoTableName: process.env.DYNAMODB_TABLE_NAME || 'NOT SET',
    hasDynamoTableName: !!process.env.DYNAMODB_TABLE_NAME,

    // S3 Config
    s3Bucket: process.env.S3_BUCKET || 'NOT SET',
    s3Region: process.env.S3_REGION || 'NOT SET',
  };

  return NextResponse.json(config);
}
