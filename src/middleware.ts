/**
 * Next.js Middleware
 *
 * 1. Canonical host: 301-redirect www → apex so the site has a single
 *    indexable host (fixes duplicate-host issues in Search Console).
 * 2. Protects admin routes with an authentication check.
 * 3. Forces browser revalidation of content list pages (see below).
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Content list pages are regenerated each deploy. Next's ISR Cache-Control ships
// a ~1-year `stale-while-revalidate`, so a RETURNING visitor is served their
// last-seen snapshot (e.g. an old, shorter song list) until a background
// revalidation completes — they had to hard-refresh to see new songs. Override
// it so the browser always revalidates (a cheap 304 via the ETag when nothing
// changed) while CloudFront still caches for s-maxage. Set in middleware because
// Next overwrites Cache-Control set via next.config headers() for these routes.
const FRESH_CONTENT_PATHS = new Set(['/', '/songs', '/poems', '/videos', '/lyrics', '/stories', '/essays']);
const FRESH_CACHE_CONTROL = 'public, max-age=0, s-maxage=300, stale-while-revalidate=60';

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

  const response = NextResponse.next();
  // Keep returning visitors from being shown a long-stale content snapshot.
  if (FRESH_CONTENT_PATHS.has(pathname)) {
    response.headers.set('Cache-Control', FRESH_CACHE_CONTROL);
  }
  return response;
}

export const config = {
  // Run on everything except Next internals/assets, so the www→apex canonical
  // redirect applies site-wide (pages, sitemap.xml, robots.txt).
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
