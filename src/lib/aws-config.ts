/**
 * AWS Configuration
 *
 * Central configuration for all AWS services
 *
 * For AWS Amplify deployment: credentials are automatically provided by the service role
 * For local development: credentials come from .env.local
 */

// AWS Credentials — SERVER-ONLY. Amplify SSR's Lambda receives every env
// var at runtime, so non-NEXT_PUBLIC_ keys are available here (and never
// shipped to the browser). The earlier comment claiming NEXT_PUBLIC_ was
// required for runtime was wrong and caused the access key to leak into
// the client bundle. NEXT_PUBLIC_ fallbacks are kept only as a transition
// shim until they're removed from the Amplify env panel.
const accessKeyId = process.env.APP_AWS_ACCESS_KEY_ID ||
                     process.env.AWS_ACCESS_KEY_ID ||
                     process.env.NEXT_PUBLIC_APP_AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.APP_AWS_SECRET_ACCESS_KEY ||
                         process.env.AWS_SECRET_ACCESS_KEY ||
                         process.env.NEXT_PUBLIC_APP_AWS_SECRET_ACCESS_KEY;

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
  // Server-only — DynamoDB is never queried from the browser.
  tableName: process.env.DYNAMODB_TABLE_NAME || process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME || 'TamilWebContent',
};

/**
 * S3 Configuration (server-only)
 */
export const s3Config = {
  ...awsConfig,
  // The tamil-web-media bucket lives in us-east-1 (verified via get-bucket-location).
  // AWS_REGION (ca-central-1) is the app/DynamoDB region; S3 must target the bucket's region.
  region: 'us-east-1',
  // Server-only — S3 SDK calls happen from the SSR Lambda + API routes.
  bucket: process.env.S3_BUCKET || process.env.NEXT_PUBLIC_S3_BUCKET || 'tamil-web-media',
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
