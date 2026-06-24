/** @jest-environment node */
/**
 * Auth helper tests — Cognito JWT verification + RBAC.
 *
 * The previous suite only proved that a Cognito-shaped cookie was *present*.
 * These tests prove that we actually verify the JWT (signature/expiry, via the
 * mocked aws-jwt-verify) and that role checks behave correctly. A forged cookie
 * must NOT authenticate.
 */

// Controllable mock for aws-jwt-verify. The name must start with "mock" so jest
// allows referencing it inside the (hoisted) module factory.
const mockVerify = jest.fn();
jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: jest.fn(() => ({ verify: mockVerify })),
  },
}));

import { NextRequest } from 'next/server';
import {
  validateAuth,
  requireAuth,
  requireAdmin,
  isAdmin,
  unauthorizedResponse,
  forbiddenResponse,
  authErrorResponse,
  AuthError,
  __resetVerifierForTests,
} from '@/lib/auth-helper';

const ID_TOKEN_COOKIE =
  'CognitoIdentityServiceProvider.testclient.poet@tamilagaval.com.idToken';

function makeRequest(cookies: Record<string, string> = {}): NextRequest {
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return new NextRequest('http://localhost/api/admin/content', {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
}

function makeBearerRequest(
  token: string,
  cookies: Record<string, string> = {}
): NextRequest {
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (cookieHeader) headers.cookie = cookieHeader;
  return new NextRequest('http://localhost/api/admin/content', { headers });
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  mockVerify.mockReset();
  // Restore baseline env, then configure a verifier-capable environment.
  process.env = { ...ORIGINAL_ENV };
  process.env.NEXT_PUBLIC_USER_POOL_ID = 'us-east-1_testpool';
  process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID = 'testclient';
  delete process.env.ADMIN_EMAILS;
  __resetVerifierForTests();
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('validateAuth — JWT verification', () => {
  it('authenticates and surfaces claims when the ID token verifies', async () => {
    mockVerify.mockResolvedValue({
      sub: 'user-123',
      email: 'poet@tamilagaval.com',
      'cognito:groups': ['readers', 'admin'],
    });

    const result = await validateAuth(makeRequest({ [ID_TOKEN_COOKIE]: 'a.b.c' }));

    expect(mockVerify).toHaveBeenCalledWith('a.b.c');
    expect(result.isAuthenticated).toBe(true);
    expect(result.userId).toBe('user-123');
    expect(result.email).toBe('poet@tamilagaval.com');
    expect(result.groups).toEqual(['readers', 'admin']);
  });

  it('authenticates via an Authorization: Bearer token', async () => {
    mockVerify.mockResolvedValue({ sub: 'u1', email: 'a@b.com', 'cognito:groups': ['admin'] });
    const result = await validateAuth(makeBearerRequest('header.jwt.token'));
    expect(mockVerify).toHaveBeenCalledWith('header.jwt.token');
    expect(result.isAuthenticated).toBe(true);
    expect(result.email).toBe('a@b.com');
  });

  it('prefers the Bearer token over the cookie', async () => {
    mockVerify.mockResolvedValue({ sub: 'u1' });
    await validateAuth(makeBearerRequest('header-token', { [ID_TOKEN_COOKIE]: 'cookie-token' }));
    expect(mockVerify).toHaveBeenCalledWith('header-token');
  });

  it('REJECTS a forged/invalid token (verification throws)', async () => {
    mockVerify.mockRejectedValue(new Error('Invalid signature'));

    const result = await validateAuth(makeRequest({ [ID_TOKEN_COOKIE]: 'forged' }));

    expect(result.isAuthenticated).toBe(false);
  });

  it('rejects when no idToken cookie is present (accessToken/LastAuthUser alone are not enough)', async () => {
    const result = await validateAuth(
      makeRequest({
        'CognitoIdentityServiceProvider.testclient.x.accessToken': 'tok',
        'CognitoIdentityServiceProvider.testclient.LastAuthUser': 'poet@tamilagaval.com',
      })
    );

    expect(result.isAuthenticated).toBe(false);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('rejects when there are no cookies at all', async () => {
    const result = await validateAuth(makeRequest());
    expect(result.isAuthenticated).toBe(false);
  });

  it('fails closed when the verifier is not configured (missing pool/client env)', async () => {
    delete process.env.NEXT_PUBLIC_USER_POOL_ID;
    delete process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID;
    delete process.env.USER_POOL_ID;
    delete process.env.USER_POOL_CLIENT_ID;
    __resetVerifierForTests();

    const result = await validateAuth(makeRequest({ [ID_TOKEN_COOKIE]: 'a.b.c' }));

    expect(result.isAuthenticated).toBe(false);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('handles a missing groups claim by returning an empty array', async () => {
    mockVerify.mockResolvedValue({ sub: 'u9', email: 'x@y.com' });

    const result = await validateAuth(makeRequest({ [ID_TOKEN_COOKIE]: 't' }));

    expect(result.isAuthenticated).toBe(true);
    expect(result.groups).toEqual([]);
  });
});

describe('requireAuth', () => {
  it('returns the context when authenticated', async () => {
    mockVerify.mockResolvedValue({ sub: 'u1', email: 'a@b.com', 'cognito:groups': [] });
    const result = await requireAuth(makeRequest({ [ID_TOKEN_COOKIE]: 't' }));
    expect(result.isAuthenticated).toBe(true);
  });

  it('throws AuthError(401) when not authenticated', async () => {
    mockVerify.mockRejectedValue(new Error('expired'));
    await expect(requireAuth(makeRequest({ [ID_TOKEN_COOKIE]: 't' }))).rejects.toMatchObject({
      name: 'AuthError',
      status: 401,
    });
  });
});

describe('requireAdmin', () => {
  it('returns the context for a user in a Cognito admin group', async () => {
    mockVerify.mockResolvedValue({ sub: 'u1', email: 'a@b.com', 'cognito:groups': ['admin'] });
    const result = await requireAdmin(makeRequest({ [ID_TOKEN_COOKIE]: 't' }));
    expect(result.isAuthenticated).toBe(true);
  });

  it('throws AuthError(403) for an authenticated NON-admin (RBAC configured)', async () => {
    process.env.ADMIN_EMAILS = 'boss@tamilagaval.com';
    __resetVerifierForTests();
    mockVerify.mockResolvedValue({ sub: 'u2', email: 'reader@example.com', 'cognito:groups': [] });

    await expect(requireAdmin(makeRequest({ [ID_TOKEN_COOKIE]: 't' }))).rejects.toMatchObject({
      status: 403,
    });
  });

  it('throws AuthError(401) when unauthenticated', async () => {
    mockVerify.mockRejectedValue(new Error('bad'));
    await expect(requireAdmin(makeRequest({ [ID_TOKEN_COOKIE]: 't' }))).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('isAdmin — RBAC', () => {
  it('returns false for unauthenticated users', () => {
    expect(isAdmin({ isAuthenticated: false })).toBe(false);
  });

  it('grants admin via a Cognito group (case-insensitive)', () => {
    expect(isAdmin({ isAuthenticated: true, groups: ['Administrators'] })).toBe(true);
  });

  it('grants admin via the ADMIN_EMAILS allow-list', () => {
    process.env.ADMIN_EMAILS = 'a@b.com, boss@tamilagaval.com';
    expect(isAdmin({ isAuthenticated: true, email: 'BOSS@tamilagaval.com', groups: [] })).toBe(true);
    expect(isAdmin({ isAuthenticated: true, email: 'nope@x.com', groups: [] })).toBe(false);
  });

  it('falls back to allowing any authenticated user when no RBAC is configured (non-production)', () => {
    expect(isAdmin({ isAuthenticated: true, email: 'anyone@x.com', groups: [] })).toBe(true);
  });

  it('DENIES (fails closed) in production when no RBAC is configured', () => {
    const prev = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.ADMIN_EMAILS;
      // Open Cognito self-signup means an allow-everyone fallback would hand
      // admin to any registered user — so production must deny.
      expect(isAdmin({ isAuthenticated: true, email: 'anyone@x.com', groups: [] })).toBe(false);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('still grants admin in production via the ADMIN_EMAILS allow-list (fail-closed does not lock out configured admins)', () => {
    const prev = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      process.env.ADMIN_EMAILS = 'boss@tamilagaval.com';
      expect(isAdmin({ isAuthenticated: true, email: 'boss@tamilagaval.com', groups: [] })).toBe(true);
      expect(isAdmin({ isAuthenticated: true, email: 'intruder@x.com', groups: [] })).toBe(false);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('still grants admin in production via a Cognito admin group', () => {
    const prev = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.ADMIN_EMAILS;
      expect(isAdmin({ isAuthenticated: true, email: 'x@y.com', groups: ['admin'] })).toBe(true);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('still denies an UNauthenticated user even with no RBAC configured', () => {
    const prev = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      expect(isAdmin({ isAuthenticated: false })).toBe(false);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

describe('response helpers', () => {
  it('unauthorizedResponse returns 401', async () => {
    const res = unauthorizedResponse();
    expect(res.status).toBe(401);
    expect((await new Response(res.body).json()).error).toBe('Unauthorized');
  });

  it('forbiddenResponse returns 403', async () => {
    const res = forbiddenResponse();
    expect(res.status).toBe(403);
    expect((await new Response(res.body).json()).error).toBe('Forbidden');
  });

  it('authErrorResponse maps AuthError status, defaulting unknown errors to 401', async () => {
    expect(authErrorResponse(new AuthError('Forbidden', 403)).status).toBe(403);
    expect(authErrorResponse(new AuthError('Unauthorized', 401)).status).toBe(401);
    expect(authErrorResponse(new Error('boom')).status).toBe(401);
  });
});
