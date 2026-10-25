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

describe('middleware — scraper block', () => {
  function uaReq(pathname: string, userAgent?: string): NextRequest {
    const headers: Record<string, string> = { host: 'tamilagaval.com' };
    if (userAgent !== undefined) headers['user-agent'] = userAgent;
    return new NextRequest(`https://tamilagaval.com${pathname}`, { headers });
  }

  const BLOCKED = [
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
    'CCBot/2.0 (https://commoncrawl.org/faq/)',
    'Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
    'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)',
    'python-requests/2.31.0',
    'Python-urllib/3.12',
    'Scrapy/2.11.0 (+https://scrapy.org)',
    'curl/8.5.0',
    'Wget/1.21.4',
    'Go-http-client/2.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
  ];

  test.each(BLOCKED)('403s %s', (ua) => {
    const response = middleware(uaReq('/songs', ua));
    expect(response.status).toBe(403);
    // A cached 403 would be served to the next real listener on this URL.
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  const ALLOWED = [
    // browsers
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    // search crawlers
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    // link previews — WhatsApp is how most listeners share
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'WhatsApp/2.23.20.0',
    'TelegramBot (like TwitterBot)',
    'Twitterbot/1.0',
    'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
    // AI answer engines that cite and send visitors
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
    // the site's own /videos → /api/songs self-fetch (Node's default UA)
    'node',
    'undici',
  ];

  test.each(ALLOWED)('passes %s', (ua) => {
    expect(middleware(uaReq('/songs', ua)).status).toBe(200);
  });

  test('passes a request with no User-Agent (self-fetch safety)', () => {
    expect(middleware(uaReq('/songs')).status).toBe(200);
  });

  test('a blocked crawler can still read robots.txt', () => {
    expect(middleware(uaReq('/robots.txt', 'GPTBot/1.2')).status).toBe(200);
  });

  test('blocks API routes too', () => {
    expect(middleware(uaReq('/api/songs', 'python-requests/2.31.0')).status).toBe(403);
  });
});
