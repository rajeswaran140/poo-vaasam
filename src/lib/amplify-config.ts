/**
 * AWS Amplify Configuration
 *
 * Configure Amplify with Cognito authentication
 */

import { Amplify } from 'aws-amplify';

const cognitoConfig: Record<string, unknown> = {
  userPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID || '',
  userPoolClientId: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID || '',
  loginWith: { email: true },
  signUpVerificationMethod: 'code' as const,
  userAttributes: { email: { required: true } },
  allowGuestAccess: false,
  passwordFormat: {
    minLength: 8,
    requireLowercase: true,
    requireUppercase: true,
    requireNumbers: true,
    requireSpecialCharacters: true,
  },
};

if (process.env.NEXT_PUBLIC_IDENTITY_POOL_ID) {
  cognitoConfig.identityPoolId = process.env.NEXT_PUBLIC_IDENTITY_POOL_ID;
}

const amplifyConfig = { Auth: { Cognito: cognitoConfig } } as const;

Amplify.configure(amplifyConfig);

export default amplifyConfig;
