/** @jest-environment node */
/**
 * Authentication Integration Tests
 *
 * End-to-end tests for complete authentication flows
 */

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

// Mock NextResponse for integration testing
jest.mock('next/server', () => ({
  ...jest.requireActual('next/server'),
  NextResponse: {
    next: jest.fn(() => ({ type: 'next' })),
    redirect: jest.fn((url) => ({ type: 'redirect', url: url.toString() })),
  },
}));

describe('Authentication Integration Tests', () => {
  describe('Complete Login Flow', () => {
    it('should complete full authentication flow', () => {
      // Step 1: Unauthenticated user tries to access admin
      const request1 = createMockRequest('/admin/content', []);
      const response1 = middleware(request1);

      expect(response1).toHaveProperty('type', 'redirect');
      const redirectUrl = (response1 as any).url;
      expect(redirectUrl).toContain('/login');
      expect(redirectUrl).toContain('redirect=%2Fadmin%2Fcontent');

      // Step 2: User authenticates (Cognito cookies set)
      const request2 = createMockRequest('/admin/content', [
        {
          name: 'CognitoIdentityServiceProvider.abc123.user@example.com.idToken',
          value: 'eyJhbGc...', // Mock JWT token
        },
      ]);
      const response2 = middleware(request2);

      // Step 3: User can now access admin routes
      expect(response2).toEqual({ type: 'next' });
    });

    it('should maintain session across multiple requests', () => {
      const cookies = [
        {
          name: 'CognitoIdentityServiceProvider.abc123.user@example.com.idToken',
          value: 'valid-token',
        },
        {
          name: 'CognitoIdentityServiceProvider.abc123.user@example.com.accessToken',
          value: 'valid-access-token',
        },
        {
          name: 'CognitoIdentityServiceProvider.abc123.LastAuthUser',
          value: 'user@example.com',
        },
      ];

      // Multiple requests to different admin routes
      const routes = [
        '/admin',
        '/admin/content',
        '/admin/content/new',
        '/admin/categories',
        '/admin/tags',
        '/admin/settings',
      ];

      routes.forEach((route) => {
        const request = createMockRequest(route, cookies);
        const response = middleware(request);
        expect(response).toEqual({ type: 'next' });
      });
    });
  });

  describe('Session Expiry Scenarios', () => {
    it('should redirect when session expires (cookies cleared)', () => {
      // User initially authenticated
      const authenticatedRequest = createMockRequest('/admin/content', [
        {
          name: 'CognitoIdentityServiceProvider.abc123.user.idToken',
          value: 'token',
        },
      ]);

      let response = middleware(authenticatedRequest);
      expect(response).toEqual({ type: 'next' });

      // Session expires (cookies cleared)
      const expiredRequest = createMockRequest('/admin/content', []);
      response = middleware(expiredRequest);

      expect(response).toHaveProperty('type', 'redirect');
    });

    it('should handle partial cookie deletion', () => {
      // User has only LastAuthUser cookie (other tokens expired)
      const request = createMockRequest('/admin/content', [
        {
          name: 'CognitoIdentityServiceProvider.abc123.LastAuthUser',
          value: 'user@example.com',
        },
      ]);

      const response = middleware(request);

      // Should still allow access (LastAuthUser indicates recent session)
      expect(response).toEqual({ type: 'next' });
    });
  });

  describe('Multi-User Scenarios', () => {
    it('should handle user switching', () => {
      // User 1 authenticated
      const user1Request = createMockRequest('/admin/content', [
        {
          name: 'CognitoIdentityServiceProvider.abc123.user1@example.com.idToken',
          value: 'user1-token',
        },
        {
          name: 'CognitoIdentityServiceProvider.abc123.LastAuthUser',
          value: 'user1@example.com',
        },
      ]);

      let response = middleware(user1Request);
      expect(response).toEqual({ type: 'next' });

      // User 2 authenticated (different session)
      const user2Request = createMockRequest('/admin/content', [
        {
          name: 'CognitoIdentityServiceProvider.abc123.user2@example.com.idToken',
          value: 'user2-token',
        },
        {
          name: 'CognitoIdentityServiceProvider.abc123.LastAuthUser',
          value: 'user2@example.com',
        },
      ]);

      response = middleware(user2Request);
      expect(response).toEqual({ type: 'next' });
    });
  });

  describe('Attack Prevention', () => {
    it('should prevent unauthorized access with fake cookies', () => {
      const request = createMockRequest('/admin/content', [
        { name: 'fake-auth-token', value: 'malicious-token' },
        { name: 'session', value: 'fake-session' },
      ]);

      const response = middleware(request);

      expect(response).toHaveProperty('type', 'redirect');
      expect((response as any).url).toContain('/login');
    });

    it('should prevent access with malformed Cognito cookies', () => {
      const request = createMockRequest('/admin/content', [
        {
          name: 'CognitoIdentityServiceProvider', // Missing parts
          value: 'incomplete',
        },
      ]);

      const response = middleware(request);

      expect(response).toHaveProperty('type', 'redirect');
    });

    it('should handle cookie injection attempts', () => {
      const request = createMockRequest('/admin/content', [
        {
          name: 'CognitoIdentityServiceProvider.../../admin.idToken',
          value: 'path-traversal-attempt',
        },
      ]);

      const response = middleware(request);

      // Should still redirect as cookie pattern doesn't match exactly
      expect(response).toHaveProperty('type', 'redirect');
    });
  });

  describe('Edge Case Flows', () => {
    it('should handle rapid authentication state changes', () => {
      const routes = ['/admin', '/admin/content', '/admin/tags'];

      routes.forEach((route) => {
        // Unauthenticated
        let request = createMockRequest(route, []);
        let response = middleware(request);
        expect(response).toHaveProperty('type', 'redirect');

        // Authenticated
        request = createMockRequest(route, [
          {
            name: 'CognitoIdentityServiceProvider.abc123.user.idToken',
            value: 'token',
          },
        ]);
        response = middleware(request);
        expect(response).toEqual({ type: 'next' });

        // Unauthenticated again
        request = createMockRequest(route, []);
        response = middleware(request);
        expect(response).toHaveProperty('type', 'redirect');
      });
    });

    it('should preserve complex redirect parameters', () => {
      const complexPath = '/admin/content?type=POEMS&status=DRAFT&page=2';
      const request = createMockRequest(complexPath, []);

      const response = middleware(request);

      expect(response).toHaveProperty('type', 'redirect');
      const redirectUrl = (response as any).url;
      expect(redirectUrl).toContain('redirect=');
      // Should preserve the full path with query params
      expect(decodeURIComponent(redirectUrl)).toContain('type=POEMS');
      expect(decodeURIComponent(redirectUrl)).toContain('status=DRAFT');
    });

    it('should handle concurrent requests from same user', () => {
      const cookies = [
        {
          name: 'CognitoIdentityServiceProvider.abc123.user.idToken',
          value: 'token',
        },
      ];

      // Simulate multiple concurrent requests
      const requests = [
        createMockRequest('/admin/content', cookies),
        createMockRequest('/admin/categories', cookies),
        createMockRequest('/admin/tags', cookies),
        createMockRequest('/admin/settings', cookies),
      ];

      // All should succeed
      requests.forEach((request) => {
        const response = middleware(request);
        expect(response).toEqual({ type: 'next' });
      });
    });
  });

  describe('Public vs Protected Route Separation', () => {
    it('should allow public routes without authentication', () => {
      const publicRoutes = [
        '/',
        '/poems',
        '/songs',
        '/lyrics',
        '/stories',
        '/essays',
        '/all',
        '/about',
        '/contact',
        '/login',
        '/content/123',
      ];

      publicRoutes.forEach((route) => {
        const request = createMockRequest(route, []);
        const response = middleware(request);

        expect(response).toEqual({ type: 'next' });
      });
    });

    it('should protect all admin routes', () => {
      const adminRoutes = [
        '/admin',
        '/admin/content',
        '/admin/content/new',
        '/admin/content/123/edit',
        '/admin/categories',
        '/admin/tags',
        '/admin/media',
        '/admin/settings',
      ];

      adminRoutes.forEach((route) => {
        const request = createMockRequest(route, []);
        const response = middleware(request);

        expect(response).toHaveProperty('type', 'redirect');
        expect((response as any).url).toContain('/login');
      });
    });
  });

  describe('Performance', () => {
    it('should handle auth check efficiently for high traffic', () => {
      const cookies = [
        {
          name: 'CognitoIdentityServiceProvider.abc123.user.idToken',
          value: 'token',
        },
      ];

      const startTime = Date.now();

      // Simulate 100 requests
      for (let i = 0; i < 100; i++) {
        const request = createMockRequest('/admin/content', cookies);
        middleware(request);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete 100 requests in under 100ms (very generous threshold)
      expect(duration).toBeLessThan(100);
    });
  });
});

// Helper function to create mock NextRequest
function createMockRequest(
  pathname: string,
  cookies: Array<{ name: string; value: string }>
): NextRequest {
  const url = `https://tamilagaval.com${pathname}`;

  const queryString = pathname.split('?')[1] || '';
  return {
    nextUrl: {
      pathname: pathname.split('?')[0],
      search: queryString ? `?${queryString}` : '',
      searchParams: new URLSearchParams(queryString),
    },
    url,
    cookies: {
      get: (name: string) => cookies.find((c) => c.name === name),
      getAll: () => cookies,
    },
  } as any;
}
