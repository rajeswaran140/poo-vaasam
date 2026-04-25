/** @jest-environment node */
import { NextRequest } from 'next/server';
import {
  validateAuth,
  requireAuth,
  unauthorizedResponse,
  isAdmin,
} from '@/lib/auth-helper';

function makeRequest(cookies: Record<string, string> = {}): NextRequest {
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return new NextRequest('http://localhost/api/test', {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
}

describe('validateAuth', () => {
  it('authenticates when idToken cookie exists', async () => {
    const req = makeRequest({
      'CognitoIdentityServiceProvider.abc123.user@example.com.idToken': 'tok',
    });
    const result = await validateAuth(req);
    expect(result.isAuthenticated).toBe(true);
  });

  it('authenticates when accessToken cookie exists', async () => {
    const req = makeRequest({
      'CognitoIdentityServiceProvider.abc123.user@example.com.accessToken': 'tok',
    });
    const result = await validateAuth(req);
    expect(result.isAuthenticated).toBe(true);
  });

  it('authenticates when LastAuthUser cookie exists and returns email', async () => {
    const req = makeRequest({
      'CognitoIdentityServiceProvider.abc123.LastAuthUser': 'user@example.com',
    });
    const result = await validateAuth(req);
    expect(result.isAuthenticated).toBe(true);
    expect(result.email).toBe('user@example.com');
    expect(result.userId).toBe('user@example.com');
  });

  it('rejects when no auth cookies present', async () => {
    const req = makeRequest({ 'session': 'abc' });
    const result = await validateAuth(req);
    expect(result.isAuthenticated).toBe(false);
  });

  it('rejects when cookie header is empty', async () => {
    const req = makeRequest();
    const result = await validateAuth(req);
    expect(result.isAuthenticated).toBe(false);
  });

  it('recognizes idToken and accessToken patterns', async () => {
    const patterns = [
      'CognitoIdentityServiceProvider.1a2b.user@test.com.idToken',
      'CognitoIdentityServiceProvider.xyz789.admin@test.com.accessToken',
      'CognitoIdentityServiceProvider.abc123.LastAuthUser',
    ];
    for (const name of patterns) {
      const req = makeRequest({ [name]: 'token-value' });
      const result = await validateAuth(req);
      expect(result.isAuthenticated).toBe(true);
    }
  });

  it('rejects invalid cookie patterns', async () => {
    const invalid = ['regular-session', 'auth-token', 'CognitoWrongPattern'];
    for (const name of invalid) {
      const req = makeRequest({ [name]: 'value' });
      const result = await validateAuth(req);
      expect(result.isAuthenticated).toBe(false);
    }
  });

  it('handles cookie values with = signs (JWT base64 padding)', async () => {
    const req = makeRequest({
      'CognitoIdentityServiceProvider.abc.user.idToken': 'head.payload.sig==',
    });
    const result = await validateAuth(req);
    expect(result.isAuthenticated).toBe(true);
  });
});

describe('requireAuth', () => {
  it('returns auth context when authenticated', async () => {
    const req = makeRequest({
      'CognitoIdentityServiceProvider.abc.user.idToken': 'tok',
    });
    const result = await requireAuth(req);
    expect(result.isAuthenticated).toBe(true);
  });

  it('throws Unauthorized when not authenticated', async () => {
    const req = makeRequest();
    await expect(requireAuth(req)).rejects.toThrow('Unauthorized');
  });
});

describe('unauthorizedResponse', () => {
  it('returns 401 with default message', async () => {
    const res = unauthorizedResponse();
    expect(res.status).toBe(401);
    const body = await new Response(res.body).json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 401 with custom message', async () => {
    const res = unauthorizedResponse('Not allowed');
    const body = await new Response(res.body).json();
    expect(body.error).toBe('Not allowed');
  });
});

describe('isAdmin', () => {
  it('returns true for authenticated users', () => {
    expect(isAdmin({ isAuthenticated: true, userId: 'u1', email: 'a@b.com' })).toBe(true);
  });

  it('returns false for unauthenticated users', () => {
    expect(isAdmin({ isAuthenticated: false })).toBe(false);
  });
});
