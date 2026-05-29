/**
 * Middleware Authentication Tests
 *
 * Tests server-side authentication checks for admin routes
 */

import { NextRequest, NextResponse } from 'next/server';
import { middleware } from '@/middleware';

// Mock NextResponse
jest.mock('next/server', () => ({
  ...jest.requireActual('next/server'),
  NextResponse: {
    next: jest.fn(() => ({ type: 'next' })),
    redirect: jest.fn((url, status) => ({ type: 'redirect', url: url.toString(), status })),
  },
}));

describe('Authentication Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Admin Route Protection', () => {
    it('should allow access to admin routes with valid Cognito idToken', () => {
      const request = createMockRequest('/admin/content', [
        { name: 'CognitoIdentityServiceProvider.abc123.user@example.com.idToken', value: 'valid-token' },
      ]);

      const response = middleware(request);

      expect(response).toEqual({ type: 'next' });
      expect(NextResponse.next).toHaveBeenCalled();
      expect(NextResponse.redirect).not.toHaveBeenCalled();
    });

    it('should allow access to admin routes with valid Cognito accessToken', () => {
      const request = createMockRequest('/admin/categories', [
        { name: 'CognitoIdentityServiceProvider.abc123.user@example.com.accessToken', value: 'valid-token' },
      ]);

      const response = middleware(request);

      expect(response).toEqual({ type: 'next' });
      expect(NextResponse.next).toHaveBeenCalled();
    });

    it('should allow access to admin routes with LastAuthUser cookie', () => {
      const request = createMockRequest('/admin/tags', [
        { name: 'CognitoIdentityServiceProvider.abc123.LastAuthUser', value: 'user@example.com' },
      ]);

      const response = middleware(request);

      expect(response).toEqual({ type: 'next' });
      expect(NextResponse.next).toHaveBeenCalled();
    });

    it('should redirect to login when no Cognito cookies present', () => {
      const request = createMockRequest('/admin/content', []);

      const response = middleware(request);

      expect(response).toHaveProperty('type', 'redirect');
      expect(NextResponse.redirect).toHaveBeenCalled();

      // Check redirect URL
      const redirectUrl = (NextResponse.redirect as jest.Mock).mock.calls[0][0];
      expect(redirectUrl.pathname).toBe('/login');
      expect(redirectUrl.searchParams.get('redirect')).toBe('/admin/content');
    });

    it('should redirect to login with non-Cognito cookies', () => {
      const request = createMockRequest('/admin/settings', [
        { name: 'some-other-cookie', value: 'value' },
        { name: 'session-id', value: '12345' },
      ]);

      const response = middleware(request);

      expect(response).toHaveProperty('type', 'redirect');
      expect(NextResponse.redirect).toHaveBeenCalled();
    });

    it('should redirect to login with invalid Cognito cookie pattern', () => {
      const request = createMockRequest('/admin', [
        { name: 'CognitoIdentityServiceProvider.abc123.invalidType', value: 'token' },
      ]);

      const response = middleware(request);

      expect(response).toHaveProperty('type', 'redirect');
      expect(NextResponse.redirect).toHaveBeenCalled();
    });
  });

  describe('Redirect Parameter', () => {
    it('should include original path in redirect query parameter', () => {
      const request = createMockRequest('/admin/content/new', []);

      middleware(request);

      const redirectUrl = (NextResponse.redirect as jest.Mock).mock.calls[0][0];
      expect(redirectUrl.searchParams.get('redirect')).toBe('/admin/content/new');
    });

    it('should preserve query parameters in redirect', () => {
      const request = createMockRequest('/admin/content?type=POEMS&status=PUBLISHED', []);

      middleware(request);

      const redirectUrl = (NextResponse.redirect as jest.Mock).mock.calls[0][0];
      expect(redirectUrl.searchParams.get('redirect')).toBe('/admin/content?type=POEMS&status=PUBLISHED');
    });
  });

  describe('Non-Admin Routes', () => {
    it('should allow public routes without authentication', () => {
      const publicRoutes = ['/', '/poems', '/songs', '/lyrics', '/about', '/contact'];

      publicRoutes.forEach((route) => {
        jest.clearAllMocks();
        const request = createMockRequest(route, []);
        const response = middleware(request);

        expect(response).toEqual({ type: 'next' });
        expect(NextResponse.next).toHaveBeenCalled();
        expect(NextResponse.redirect).not.toHaveBeenCalled();
      });
    });

    it('should allow login page without authentication', () => {
      const request = createMockRequest('/login', []);

      const response = middleware(request);

      expect(response).toEqual({ type: 'next' });
      expect(NextResponse.next).toHaveBeenCalled();
    });
  });

  describe('Host canonicalization (www → apex)', () => {
    it('301-redirects www to the apex host, preserving the path', () => {
      const request = createMockRequest('/songs', [], 'www.tamilagaval.com');

      const response = middleware(request);

      expect(response).toHaveProperty('type', 'redirect');
      expect((response as any).status).toBe(301);
      const url = (NextResponse.redirect as jest.Mock).mock.calls[0][0];
      expect(url.host).toBe('tamilagaval.com');
      expect(url.pathname).toBe('/songs');
    });

    it('preserves the query string when redirecting www to apex', () => {
      const request = createMockRequest('/all?type=SONGS&sort=newest', [], 'www.tamilagaval.com');

      middleware(request);

      const url = (NextResponse.redirect as jest.Mock).mock.calls[0][0];
      expect(url.toString()).toBe('https://tamilagaval.com/all?type=SONGS&sort=newest');
    });

    it('redirects www for sitemap.xml and robots.txt too', () => {
      for (const path of ['/sitemap.xml', '/robots.txt']) {
        jest.clearAllMocks();
        const request = createMockRequest(path, [], 'www.tamilagaval.com');
        middleware(request);
        const url = (NextResponse.redirect as jest.Mock).mock.calls[0][0];
        expect(url.toString()).toBe(`https://tamilagaval.com${path}`);
      }
    });

    it('canonicalizes the host before the admin auth check (no login bounce on www)', () => {
      const request = createMockRequest('/admin', [], 'www.tamilagaval.com');

      const response = middleware(request);

      expect(response).toHaveProperty('type', 'redirect');
      expect((response as any).status).toBe(301);
      const url = (NextResponse.redirect as jest.Mock).mock.calls[0][0];
      expect(url.host).toBe('tamilagaval.com');
      expect(url.pathname).toBe('/admin'); // not /login
    });

    it('does not redirect requests already on the apex host', () => {
      const request = createMockRequest('/songs', [], 'tamilagaval.com');

      const response = middleware(request);

      expect(response).toEqual({ type: 'next' });
      expect(NextResponse.redirect).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple Cognito cookies correctly', () => {
      const request = createMockRequest('/admin', [
        { name: 'CognitoIdentityServiceProvider.abc123.user1.idToken', value: 'token1' },
        { name: 'CognitoIdentityServiceProvider.abc123.user2.accessToken', value: 'token2' },
        { name: 'CognitoIdentityServiceProvider.abc123.LastAuthUser', value: 'user1' },
      ]);

      const response = middleware(request);

      expect(response).toEqual({ type: 'next' });
      expect(NextResponse.next).toHaveBeenCalled();
    });

    it('should handle admin root path', () => {
      const request = createMockRequest('/admin', []);

      const response = middleware(request);

      expect(response).toHaveProperty('type', 'redirect');
      const redirectUrl = (NextResponse.redirect as jest.Mock).mock.calls[0][0];
      expect(redirectUrl.pathname).toBe('/login');
    });

    it('should handle nested admin paths', () => {
      const request = createMockRequest('/admin/content/123/edit', [
        { name: 'CognitoIdentityServiceProvider.abc123.user.idToken', value: 'token' },
      ]);

      const response = middleware(request);

      expect(response).toEqual({ type: 'next' });
      expect(NextResponse.next).toHaveBeenCalled();
    });
  });
});

// Helper function to create mock NextRequest
function createMockRequest(
  pathnameWithQuery: string,
  cookies: Array<{ name: string; value: string }>,
  host = 'tamilagaval.com'
): NextRequest {
  const [pathname, query] = pathnameWithQuery.split('?');
  const search = query ? `?${query}` : '';
  const url = `https://${host}${pathnameWithQuery}`;

  return {
    headers: {
      get: (name: string) => (name.toLowerCase() === 'host' ? host : null),
    },
    nextUrl: {
      pathname,
      search,
      searchParams: new URLSearchParams(query || ''),
    },
    url,
    cookies: {
      get: (name: string) => cookies.find(c => c.name === name),
      getAll: () => cookies,
    },
  } as any;
}
