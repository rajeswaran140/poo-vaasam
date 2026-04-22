/**
 * API Authentication Tests
 *
 * Unit tests for API authentication helper functions
 */

import { NextRequest } from 'next/server';
import {
  validateAuth,
  requireAuth,
  unauthorizedResponse,
  isAdmin,
} from '@/lib/auth-helper';

// Mock Next.js cookies
jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

import { cookies } from 'next/headers';

describe('API Authentication Helper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateAuth', () => {
    it('should return authenticated: true when idToken cookie exists', async () => {
      const mockCookies = {
        getAll: jest.fn().mockReturnValue([
          {
            name: 'CognitoIdentityServiceProvider.abc123.user@example.com.idToken',
            value: 'mock-id-token',
          },
        ]),
      };

      (cookies as jest.Mock).mockResolvedValue(mockCookies);

      const mockRequest = {} as NextRequest;
      const result = await validateAuth(mockRequest);

      expect(result.isAuthenticated).toBe(true);
    });

    it('should return authenticated: true when accessToken cookie exists', async () => {
      const mockCookies = {
        getAll: jest.fn().mockReturnValue([
          {
            name: 'CognitoIdentityServiceProvider.abc123.user@example.com.accessToken',
            value: 'mock-access-token',
          },
        ]),
      };

      (cookies as jest.Mock).mockResolvedValue(mockCookies);

      const mockRequest = {} as NextRequest;
      const result = await validateAuth(mockRequest);

      expect(result.isAuthenticated).toBe(true);
    });

    it('should return authenticated: true when LastAuthUser cookie exists', async () => {
      const mockCookies = {
        getAll: jest.fn().mockReturnValue([
          {
            name: 'CognitoIdentityServiceProvider.abc123.LastAuthUser',
            value: 'user@example.com',
          },
        ]),
      };

      (cookies as jest.Mock).mockResolvedValue(mockCookies);

      const mockRequest = {} as NextRequest;
      const result = await validateAuth(mockRequest);

      expect(result.isAuthenticated).toBe(true);
      expect(result.email).toBe('user@example.com');
    });

    it('should return authenticated: false when no auth cookies exist', async () => {
      const mockCookies = {
        getAll: jest.fn().mockReturnValue([
          { name: 'some-other-cookie', value: 'value' },
        ]),
      };

      (cookies as jest.Mock).mockResolvedValue(mockCookies);

      const mockRequest = {} as NextRequest;
      const result = await validateAuth(mockRequest);

      expect(result.isAuthenticated).toBe(false);
    });

    it('should return authenticated: false when cookies is empty', async () => {
      const mockCookies = {
        getAll: jest.fn().mockReturnValue([]),
      };

      (cookies as jest.Mock).mockResolvedValue(mockCookies);

      const mockRequest = {} as NextRequest;
      const result = await validateAuth(mockRequest);

      expect(result.isAuthenticated).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      (cookies as jest.Mock).mockRejectedValue(new Error('Cookie error'));

      const mockRequest = {} as NextRequest;
      const result = await validateAuth(mockRequest);

      expect(result.isAuthenticated).toBe(false);
    });

    it('should extract email from LastAuthUser cookie', async () => {
      const mockCookies = {
        getAll: jest.fn().mockReturnValue([
          {
            name: 'CognitoIdentityServiceProvider.abc123.LastAuthUser',
            value: 'test@example.com',
          },
        ]),
      };

      (cookies as jest.Mock).mockResolvedValue(mockCookies);

      const mockRequest = {} as NextRequest;
      const result = await validateAuth(mockRequest);

      expect(result.email).toBe('test@example.com');
      expect(result.userId).toBe('test@example.com');
    });
  });

  describe('requireAuth', () => {
    it('should return auth context when authenticated', async () => {
      const mockCookies = {
        getAll: jest.fn().mockReturnValue([
          {
            name: 'CognitoIdentityServiceProvider.abc123.user@example.com.idToken',
            value: 'token',
          },
        ]),
      };

      (cookies as jest.Mock).mockResolvedValue(mockCookies);

      const mockRequest = {} as NextRequest;
      const result = await requireAuth(mockRequest);

      expect(result.isAuthenticated).toBe(true);
    });

    it('should throw error when not authenticated', async () => {
      const mockCookies = {
        getAll: jest.fn().mockReturnValue([]),
      };

      (cookies as jest.Mock).mockResolvedValue(mockCookies);

      const mockRequest = {} as NextRequest;

      await expect(requireAuth(mockRequest)).rejects.toThrow('Unauthorized');
    });

    it('should throw error when cookies check fails', async () => {
      (cookies as jest.Mock).mockRejectedValue(new Error('Cookie error'));

      const mockRequest = {} as NextRequest;

      await expect(requireAuth(mockRequest)).rejects.toThrow('Unauthorized');
    });
  });

  describe('unauthorizedResponse', () => {
    it('should return 401 response with default message', () => {
      const response = unauthorizedResponse();

      expect(response.status).toBe(401);
      expect(response.headers.get('Content-Type')).toBe('application/json');
    });

    it('should return 401 response with custom message', async () => {
      const response = unauthorizedResponse('Custom unauthorized message');

      expect(response.status).toBe(401);

      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Custom unauthorized message');
    });

    it('should have correct response structure', async () => {
      const response = unauthorizedResponse();
      const body = await response.json();

      expect(body).toHaveProperty('success');
      expect(body).toHaveProperty('error');
      expect(body.success).toBe(false);
    });
  });

  describe('isAdmin', () => {
    it('should return true for authenticated users', () => {
      const authContext = {
        isAuthenticated: true,
        userId: 'user123',
        email: 'admin@example.com',
      };

      expect(isAdmin(authContext)).toBe(true);
    });

    it('should return false for unauthenticated users', () => {
      const authContext = {
        isAuthenticated: false,
      };

      expect(isAdmin(authContext)).toBe(false);
    });

    // TODO: Add role-based tests when RBAC is implemented
  });

  describe('Integration with Cognito cookie patterns', () => {
    it('should recognize valid Cognito cookie patterns', async () => {
      const cognitoPatterns = [
        'CognitoIdentityServiceProvider.1a2b3c4d5e.user@test.com.idToken',
        'CognitoIdentityServiceProvider.xyz789.admin@test.com.accessToken',
        'CognitoIdentityServiceProvider.abc123.LastAuthUser',
        'CognitoIdentityServiceProvider.test123.user@example.com.refreshToken',
      ];

      for (const pattern of cognitoPatterns) {
        const mockCookies = {
          getAll: jest.fn().mockReturnValue([
            { name: pattern, value: 'token-value' },
          ]),
        };

        (cookies as jest.Mock).mockResolvedValue(mockCookies);

        const mockRequest = {} as NextRequest;
        const result = await validateAuth(mockRequest);

        expect(result.isAuthenticated).toBe(true);
      }
    });

    it('should reject invalid cookie patterns', async () => {
      const invalidPatterns = [
        'regular-session-cookie',
        'auth-token',
        'CognitoWrongPattern',
        'Cognito.partial.pattern',
      ];

      for (const pattern of invalidPatterns) {
        const mockCookies = {
          getAll: jest.fn().mockReturnValue([
            { name: pattern, value: 'value' },
          ]),
        };

        (cookies as jest.Mock).mockResolvedValue(mockCookies);

        const mockRequest = {} as NextRequest;
        const result = await validateAuth(mockRequest);

        expect(result.isAuthenticated).toBe(false);
      }
    });
  });
});
