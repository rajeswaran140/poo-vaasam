/**
 * Next.js Middleware
 *
 * Protects admin routes with authentication check
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only protect /admin routes (login is at /login, not /admin/login)
  if (pathname.startsWith('/admin')) {
    // Check for Cognito auth tokens in cookies
    // AWS Amplify stores tokens with pattern: CognitoIdentityServiceProvider.{clientId}.*
    const cookies = request.cookies.getAll();

    // Look for any Cognito token (idToken, accessToken, or LastAuthUser)
    // Validates pattern strictly — no path traversal (..) or slashes allowed
    const cognitoPattern = /^CognitoIdentityServiceProvider\.[a-zA-Z0-9]+\.(?!.*\.\.)(?!.*\/)[^/\\]+(\.idToken|\.accessToken)$|^CognitoIdentityServiceProvider\.[a-zA-Z0-9]+\.LastAuthUser$/;
    const hasAuthToken = cookies.some(cookie => cognitoPattern.test(cookie.name));

    if (!hasAuthToken) {
      const loginUrl = new URL('/login', request.url);
      // Preserve full path including query string in redirect param
      const redirectPath = request.nextUrl.search
        ? `${pathname}${request.nextUrl.search}`
        : pathname;
      loginUrl.searchParams.set('redirect', redirectPath);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/admin/:path*',
  ],
};
