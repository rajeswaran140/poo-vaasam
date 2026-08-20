/** @jest-environment node */
/**
 * Middleware tests — the /admin auth guard + www→apex canonicalisation.
 *
 * The middleware is the FIRST line of defence for admin routes: it 307s
 * unauthenticated requests to /login before the SSR layer runs. It only checks
 * that a Cognito-shaped cookie IS PRESENT — the cryptographic JWT check happens
 * later in `requireAdmin()` at the API layer (`src/lib/auth-helper.ts`).
 *
 * This suite proves the guard actually fires on every /admin path and rejects
 * malformed cookies. It is a REGRESSION FLOOR — if a future refactor changes
 * the regex or the pathname test, these tests should catch it. The point is
 * NOT to prove the middleware is cryptographically secure (it isn't, by
 * design); it's to prove the fast-fail behaviour matches the audit assumption.
 */

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

const VALID_COGNITO_COOKIE_NAME =
  'CognitoIdentityServiceProvider.testclient.poet@tamilagaval.com.idToken';

/**
 * Build a NextRequest with the given path and optional cookies. Uses the
 * apex host so the www→apex redirect does not fire.
 */
function req(pathname: string, cookies: Record<string, string> = {}): NextRequest {
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  const headers: Record<string, string> = { host: 'tamilagaval.com' };
  if (cookieHeader) headers.cookie = cookieHeader;
  return new NextRequest(`https://tamilagaval.com${pathname}`, { headers });
}

describe('middleware — /admin auth guard', () => {
  const ADMIN_PATHS = [
    '/admin',
    '/admin/',
    '/admin/mastering',
    '/admin/mastering/',
    '/admin/mastering/library',
    '/admin/songs',
    '/admin/comments',
    '/admin/youtube',
    '/admin/captions',
    '/admin/music-lab',
    '/admin/some/future/deep/route',
  ];

  test.each(ADMIN_PATHS)(
    'redirects to /login when no Cognito cookie is present: %s',
    (path) => {
      const response = middleware(req(path));
      expect(response.status).toBe(307);
      const location = response.headers.get('location');
      expect(location).toBeTruthy();
      const url = new URL(location!);
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('redirect')).toBe(path);
    }
  );

  test('passes through when a valid-looking Cognito idToken cookie is present', () => {
    const response = middleware(req('/admin/mastering', { [VALID_COGNITO_COOKIE_NAME]: 'anything' }));
    // NextResponse.next() has no `redirect` — status 200-ish; we assert no /login redirect.
    const location = response.headers.get('location');
    expect(location).toBeNull();
  });

  test('passes through when a Cognito accessToken cookie is present', () => {
    const cookie = 'CognitoIdentityServiceProvider.testclient.poet@tamilagaval.com.accessToken';
    const response = middleware(req('/admin', { [cookie]: 'anything' }));
    expect(response.headers.get('location')).toBeNull();
  });

  test('passes through when a Cognito LastAuthUser cookie is present', () => {
    const cookie = 'CognitoIdentityServiceProvider.testclient.LastAuthUser';
    const response = middleware(req('/admin', { [cookie]: 'anything' }));
    expect(response.headers.get('location')).toBeNull();
  });

  test('preserves query string in the redirect target', () => {
    const request = new NextRequest('https://tamilagaval.com/admin/mastering?job=abc123', {
      headers: { host: 'tamilagaval.com' },
    });
    const response = middleware(request);
    expect(response.status).toBe(307);
    const url = new URL(response.headers.get('location')!);
    expect(url.searchParams.get('redirect')).toBe('/admin/mastering?job=abc123');
  });

  test('rejects a malformed cookie name with path traversal (..)', () => {
    // The middleware regex must not treat this as a valid Cognito cookie.
    const forged = 'CognitoIdentityServiceProvider.testclient.evil..payload.idToken';
    const response = middleware(req('/admin', { [forged]: 'anything' }));
    expect(response.status).toBe(307);
  });

  test('rejects a malformed cookie name with a slash in the user portion', () => {
    const forged = 'CognitoIdentityServiceProvider.testclient.evil/payload.idToken';
    const response = middleware(req('/admin', { [forged]: 'anything' }));
    expect(response.status).toBe(307);
  });

  test('rejects a Cognito-shaped cookie without idToken/accessToken suffix', () => {
    const notEnoughSuffix = 'CognitoIdentityServiceProvider.testclient.user.somethingElse';
    const response = middleware(req('/admin', { [notEnoughSuffix]: 'anything' }));
    expect(response.status).toBe(307);
  });
});

describe('middleware — public paths pass through without an auth check', () => {
  const PUBLIC_PATHS = ['/', '/songs', '/poems', '/videos', '/login', '/lyrics/some-poem'];

  test.each(PUBLIC_PATHS)('does not 307 on public path: %s', (path) => {
    const response = middleware(req(path));
    // NextResponse.next() returns without a location header set.
    expect(response.headers.get('location')).toBeNull();
  });
});

describe('middleware — www→apex canonicalisation', () => {
  test('www.tamilagaval.com → tamilagaval.com (301)', () => {
    const request = new NextRequest('https://www.tamilagaval.com/songs', {
      headers: { host: 'www.tamilagaval.com' },
    });
    const response = middleware(request);
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('https://tamilagaval.com/songs');
  });

  test('preserves path + query string in www→apex redirect', () => {
    const request = new NextRequest('https://www.tamilagaval.com/admin/mastering?job=abc', {
      headers: { host: 'www.tamilagaval.com' },
    });
    const response = middleware(request);
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('https://tamilagaval.com/admin/mastering?job=abc');
  });
});

describe('middleware — fresh-content Cache-Control on list pages', () => {
  const FRESH_PATHS = ['/', '/all', '/songs', '/poems', '/videos', '/lyrics', '/stories', '/essays'];

  test.each(FRESH_PATHS)('sets short s-maxage + swr on: %s', (path) => {
    const response = middleware(req(path));
    const cc = response.headers.get('Cache-Control');
    expect(cc).toBe('public, max-age=0, s-maxage=300, stale-while-revalidate=60');
  });

  test('does NOT set the fresh Cache-Control on a non-list path', () => {
    const response = middleware(req('/some-random-poem-slug'));
    expect(response.headers.get('Cache-Control')).toBeNull();
  });
});
