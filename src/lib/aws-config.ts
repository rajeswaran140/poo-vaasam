/**
 * AWS Configuration
 *
 * Central configuration for all AWS services
 *
 * For AWS Amplify deployment: credentials are automatically provided by the service role
 * For local development: credentials come from .env.local
 */

// AWS Credentials
// Amplify Hosting Gen 2 doesn't pass non-NEXT_PUBLIC env vars to runtime
// So we need to use NEXT_PUBLIC_ prefix (these get baked into the build)
// Try multiple prefixes for compatibility
const accessKeyId = process.env.NEXT_PUBLIC_APP_AWS_ACCESS_KEY_ID ||
                     process.env.APP_AWS_ACCESS_KEY_ID ||
                     process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.NEXT_PUBLIC_APP_AWS_SECRET_ACCESS_KEY ||
                         process.env.APP_AWS_SECRET_ACCESS_KEY ||
                         process.env.AWS_SECRET_ACCESS_KEY;

// Debug logging
if (typeof window === 'undefined') {
  console.log('[AWS-CONFIG] APP_AWS_ACCESS_KEY_ID:', process.env.APP_AWS_ACCESS_KEY_ID ? 'SET' : 'NOT SET');
  console.log('[AWS-CONFIG] AWS_ACCESS_KEY_ID:', process.env.AWS_ACCESS_KEY_ID ? 'SET' : 'NOT SET');
  console.log('[AWS-CONFIG] DYNAMODB_TABLE_NAME:', process.env.DYNAMODB_TABLE_NAME || 'NOT SET');
}

const credentials = accessKeyId && secretAccessKey
  ? {
      accessKeyId,
      secretAccessKey,
    }
  : undefined;

/**
 * Server-only AWS configuration
 * These values are NOT exposed to the browser
 */
export const awsConfig = {
  region: process.env.AWS_REGION || 'ca-central-1',
  ...(credentials && { credentials }),
};

/**
 * DynamoDB Configuration (server-only)
 */
export const dynamoDBConfig = {
  ...awsConfig,
  tableName: process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME || process.env.DYNAMODB_TABLE_NAME || 'TamilWebContent',
};

/**
 * S3 Configuration (server-only)
 */
export const s3Config = {
  ...awsConfig,
  bucket: process.env.S3_BUCKET || 'tamil-web-media',
};

/**
 * Cognito Configuration (exposed to browser for Auth UI)
 * Uses NEXT_PUBLIC_ prefix because Amplify UI components need these values
 */
export const cognitoConfig = {
  region: process.env.NEXT_PUBLIC_AWS_REGION || 'ca-central-1',
  userPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID || '',
  userPoolWebClientId: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID || '',
  identityPoolId: process.env.NEXT_PUBLIC_IDENTITY_POOL_ID || '',
};

/**
 * Amplify Configuration
 */
export const amplifyConfig = {
  Auth: {
    Cognito: {
      userPoolId: cognitoConfig.userPoolId,
      userPoolClientId: cognitoConfig.userPoolWebClientId,
      identityPoolId: cognitoConfig.identityPoolId,
      loginWith: {
        email: true,
      },
      signUpVerificationMethod: 'code',
      userAttributes: {
        email: {
          required: true,
        },
        name: {
          required: true,
        },
      },
      passwordFormat: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireNumbers: true,
        requireSpecialCharacters: true,
      },
    },
  },
  Storage: {
    S3: {
      bucket: s3Config.bucket,
      region: s3Config.region,
    },
  },
};
