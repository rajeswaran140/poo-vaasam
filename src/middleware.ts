/**
 * Next.js Middleware
 *
 * 1. Canonical host: 301-redirect www → apex so the site has a single
 *    indexable host (fixes duplicate-host issues in Search Console).
 * 2. Protects admin routes with an authentication check.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // 1. Canonicalise the host before anything else.
  const host = request.headers?.get('host') ?? '';
  if (host.startsWith('www.')) {
    const apexUrl = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, `https://${host.slice(4)}`);
    return NextResponse.redirect(apexUrl, 301);
  }

  const { pathname } = request.nextUrl;

  // 2. Only protect /admin routes (login is at /login, not /admin/login)
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
  // Run on everything except Next internals/assets, so the www→apex canonical
  // redirect applies site-wide (pages, sitemap.xml, robots.txt).
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
