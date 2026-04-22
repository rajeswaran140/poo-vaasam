/**
 * Authentication Helper for API Routes
 *
 * Validates authentication tokens in API requests
 */

import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';

export interface AuthContext {
  isAuthenticated: boolean;
  userId?: string;
  email?: string;
}

/**
 * Check if request has valid Cognito authentication
 *
 * @param request - Next.js API request object
 * @returns Authentication context
 */
export async function validateAuth(request: NextRequest): Promise<AuthContext> {
  try {
    // Get cookies from the request
    const cookieStore = await cookies();
    const allCookies = cookieStore.getAll();

    // Check for Cognito authentication tokens
    // AWS Amplify stores tokens with pattern: CognitoIdentityServiceProvider.{clientId}.{username}.{tokenType}
    const hasIdToken = allCookies.some(cookie =>
      cookie.name.includes('CognitoIdentityServiceProvider') &&
      cookie.name.includes('.idToken')
    );

    const hasAccessToken = allCookies.some(cookie =>
      cookie.name.includes('CognitoIdentityServiceProvider') &&
      cookie.name.includes('.accessToken')
    );

    const lastAuthUser = allCookies.find(cookie =>
      cookie.name.includes('CognitoIdentityServiceProvider') &&
      cookie.name.includes('.LastAuthUser')
    );

    // User is authenticated if they have either idToken or accessToken
    const isAuthenticated = hasIdToken || hasAccessToken || !!lastAuthUser;

    if (!isAuthenticated) {
      return { isAuthenticated: false };
    }

    // Extract user email from LastAuthUser cookie if available
    let email: string | undefined;
    if (lastAuthUser) {
      // LastAuthUser cookie value is the username/email
      email = lastAuthUser.value;
    }

    return {
      isAuthenticated: true,
      email,
      userId: email, // Using email as userId for now
    };
  } catch (error) {
    console.error('Auth validation error:', error);
    return { isAuthenticated: false };
  }
}

/**
 * Require authentication for an API route
 * Throws error if not authenticated
 *
 * @param request - Next.js API request object
 * @returns Authentication context
 * @throws Error if not authenticated
 */
export async function requireAuth(request: NextRequest): Promise<AuthContext> {
  const auth = await validateAuth(request);

  if (!auth.isAuthenticated) {
    throw new Error('Unauthorized');
  }

  return auth;
}

/**
 * Create a 401 Unauthorized response
 */
export function unauthorizedResponse(message = 'Unauthorized') {
  return new Response(
    JSON.stringify({
      success: false,
      error: message,
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
}

/**
 * Verify admin role (placeholder for future RBAC)
 *
 * @param authContext - Authentication context
 * @returns True if user is admin
 */
export function isAdmin(authContext: AuthContext): boolean {
  // TODO: Implement role-based access control
  // For now, all authenticated users are considered admins
  // In future, check user roles from Cognito groups
  return authContext.isAuthenticated;
}
