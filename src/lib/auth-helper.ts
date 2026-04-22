/**
 * Authentication Helper for API Routes
 *
 * Validates authentication tokens in API requests
 */

import { NextRequest } from 'next/server';

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
    // Get cookies from the request object
    const cookieHeader = request.headers.get('cookie') || '';
    const cookies = parseCookies(cookieHeader);

    // Check for Cognito authentication tokens
    // AWS Amplify stores tokens with pattern: CognitoIdentityServiceProvider.{clientId}.{username}.{tokenType}
    const cookieNames = Object.keys(cookies);

    const hasIdToken = cookieNames.some(name =>
      name.includes('CognitoIdentityServiceProvider') &&
      name.includes('.idToken')
    );

    const hasAccessToken = cookieNames.some(name =>
      name.includes('CognitoIdentityServiceProvider') &&
      name.includes('.accessToken')
    );

    const lastAuthUserCookie = cookieNames.find(name =>
      name.includes('CognitoIdentityServiceProvider') &&
      name.includes('.LastAuthUser')
    );

    // User is authenticated if they have either idToken or accessToken
    const isAuthenticated = hasIdToken || hasAccessToken || !!lastAuthUserCookie;

    if (!isAuthenticated) {
      return { isAuthenticated: false };
    }

    // Extract user email from LastAuthUser cookie if available
    let email: string | undefined;
    if (lastAuthUserCookie) {
      // LastAuthUser cookie value is the username/email
      email = cookies[lastAuthUserCookie];
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

/**
 * Parse cookie header string into object
 *
 * @param cookieHeader - Cookie header string
 * @returns Object with cookie names as keys and values
 */
function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};

  if (!cookieHeader) {
    return cookies;
  }

  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.trim().split('=');
    if (parts.length === 2) {
      const name = decodeURIComponent(parts[0]);
      const value = decodeURIComponent(parts[1]);
      cookies[name] = value;
    }
  });

  return cookies;
}
