'use client';

import { Amplify } from 'aws-amplify';

/**
 * aws-amplify v5 Cognito configuration.
 *
 * v5 reads the Cognito settings *flat* under `Auth` (region / userPoolId /
 * userPoolWebClientId). The previous config used the v6 nesting
 * (`Auth: { Cognito: { ... } }`) plus v6-only keys (`loginWith`,
 * `signUpVerificationMethod`, `passwordFormat`) — all of which v5 silently
 * ignores. The result: the Auth module was never configured, so
 * `Auth.currentSession()` threw and no ID token reached the API
 * (server logged "no token presented"). This is the fix. See client-auth.ts.
 */

const userPoolId = process.env.NEXT_PUBLIC_USER_POOL_ID || '';
const userPoolWebClientId = process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID || '';

// Cognito user-pool IDs are "<region>_<suffix>"; derive region from the pool id
// if the explicit env var is absent.
const region =
  process.env.NEXT_PUBLIC_AWS_REGION ||
  (userPoolId.includes('_') ? userPoolId.split('_')[0] : '') ||
  'ca-central-1';

const authConfig: Record<string, unknown> = {
  region,
  userPoolId,
  userPoolWebClientId,
  mandatorySignIn: false,
  authenticationFlowType: 'USER_SRP_AUTH',
};

if (process.env.NEXT_PUBLIC_IDENTITY_POOL_ID) {
  authConfig.identityPoolId = process.env.NEXT_PUBLIC_IDENTITY_POOL_ID;
  authConfig.identityPoolRegion = region;
}

const amplifyConfig = { Auth: authConfig } as const;

Amplify.configure(amplifyConfig);

export default amplifyConfig;
