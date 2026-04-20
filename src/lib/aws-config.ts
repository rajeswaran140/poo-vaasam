/**
 * AWS Configuration
 *
 * Central configuration for all AWS services
 */

export const awsConfig = {
  region: process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
};

/**
 * DynamoDB Configuration
 */
export const dynamoDBConfig = {
  ...awsConfig,
  tableName: process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME || 'TamilWebContent',
};

/**
 * S3 Configuration
 */
export const s3Config = {
  ...awsConfig,
  bucket: process.env.NEXT_PUBLIC_S3_BUCKET || 'tamil-web-media',
};

/**
 * Cognito Configuration
 */
export const cognitoConfig = {
  region: process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1',
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
