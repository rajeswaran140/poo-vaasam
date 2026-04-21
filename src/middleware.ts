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

    // Look for any Cognito token (idToken, accessToken, or refreshToken)
    const hasAuthToken = cookies.some(cookie =>
      cookie.name.includes('CognitoIdentityServiceProvider') &&
      (cookie.name.includes('.idToken') ||
       cookie.name.includes('.accessToken') ||
       cookie.name.includes('.LastAuthUser'))
    );

    if (!hasAuthToken) {
      // Redirect to login if not authenticated
      const loginUrl = new URL('/login', request.url);
      // Add redirect query param to return user after login
      loginUrl.searchParams.set('redirect', pathname);
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
