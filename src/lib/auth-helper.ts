/**
 * Authentication Helper for API Routes
 *
 * Verifies AWS Cognito JWTs (signature, issuer, audience and expiry) on every
 * request and exposes role checks.
 *
 * This replaces the previous implementation, which only checked that a
 * Cognito-shaped cookie *existed* — any caller could forge a cookie named
 * `CognitoIdentityServiceProvider.x.user.idToken=anything` and be treated as
 * authenticated. We now cryptographically verify the ID token instead.
 */

import { NextRequest } from 'next/server';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { logger } from '@/lib/logger';

export interface AuthContext {
  isAuthenticated: boolean;
  userId?: string;
  email?: string;
  groups?: string[];
}

/** Error that carries an HTTP status so callers can distinguish 401 vs 403. */
export class AuthError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'AuthError';
  }
}

// Cognito group names (case-insensitive) that grant admin access.
const ADMIN_GROUPS = ['admin', 'admins', 'administrator', 'administrators'];

function adminEmailAllowList(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

// Minimal shape we rely on from aws-jwt-verify. The verifier is created once
// and cached; the first verify() call fetches and caches the pool's JWKS.
interface JwtVerifier {
  verify(token: string): Promise<Record<string, unknown>>;
}
let cachedVerifier: JwtVerifier | null | undefined;

function getVerifier(): JwtVerifier | null {
  if (cachedVerifier !== undefined) return cachedVerifier;

  const userPoolId =
    process.env.NEXT_PUBLIC_USER_POOL_ID || process.env.USER_POOL_ID;
  const clientId =
    process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID ||
    process.env.USER_POOL_CLIENT_ID;

  if (!userPoolId || !clientId) {
    logger.error(
      'Cognito verifier not configured: missing USER_POOL_ID / USER_POOL_CLIENT_ID. All requests will be denied.'
    );
    cachedVerifier = null;
    return null;
  }

  cachedVerifier = CognitoJwtVerifier.create({
    userPoolId,
    tokenUse: 'id',
    clientId,
  }) as unknown as JwtVerifier;
  return cachedVerifier;
}

/** Test hook: clears the cached verifier so env changes take effect. */
export function __resetVerifierForTests(): void {
  cachedVerifier = undefined;
}

/**
 * Verify the Cognito ID token carried in the request cookies.
 *
 * Returns an authenticated context only when the JWT's signature, issuer,
 * audience and expiry all validate. Any failure (missing/forged/expired token,
 * or an unconfigured verifier) yields `{ isAuthenticated: false }`.
 */
export async function validateAuth(request: NextRequest): Promise<AuthContext> {
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = parseCookies(cookieHeader);

  // Amplify stores the JWT under:
  // CognitoIdentityServiceProvider.{clientId}.{username}.idToken
  const idTokenName = Object.keys(cookies).find(
    (name) =>
      name.includes('CognitoIdentityServiceProvider') &&
      name.endsWith('.idToken')
  );

  if (!idTokenName) {
    return { isAuthenticated: false };
  }

  const verifier = getVerifier();
  if (!verifier) {
    return { isAuthenticated: false };
  }

  try {
    const payload = await verifier.verify(cookies[idTokenName]);

    const rawGroups = payload['cognito:groups'];
    const groups = Array.isArray(rawGroups)
      ? (rawGroups.filter((g) => typeof g === 'string') as string[])
      : [];

    return {
      isAuthenticated: true,
      userId: typeof payload.sub === 'string' ? payload.sub : undefined,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      groups,
    };
  } catch (error) {
    // Invalid signature, expired token, wrong audience, etc.
    // Never log the token value itself.
    logger.warn('Cognito JWT verification failed', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return { isAuthenticated: false };
  }
}

/**
 * Require an authenticated user. Throws `AuthError(401)` if not authenticated.
 */
export async function requireAuth(request: NextRequest): Promise<AuthContext> {
  const auth = await validateAuth(request);
  if (!auth.isAuthenticated) {
    throw new AuthError('Unauthorized', 401);
  }
  return auth;
}

/**
 * Require an authenticated admin.
 * Throws `AuthError(401)` if unauthenticated, `AuthError(403)` if the user is
 * authenticated but not an admin.
 */
export async function requireAdmin(request: NextRequest): Promise<AuthContext> {
  const auth = await requireAuth(request);
  if (!isAdmin(auth)) {
    throw new AuthError('Forbidden', 403);
  }
  return auth;
}

/**
 * Role check. An authenticated user is an admin when they belong to a Cognito
 * admin group OR their email is in the `ADMIN_EMAILS` allow-list.
 *
 * If no RBAC is configured (token has no admin group AND `ADMIN_EMAILS` is
 * unset) we fall back to "any authenticated user is admin". Reaching this point
 * already required a valid, verified Cognito session, so this is a reasonable
 * dev-stage posture; we log a warning in production so it's visible. Tighten by
 * setting `ADMIN_EMAILS` or a Cognito admin group before launch — see HARDENING.md.
 */
export function isAdmin(authContext: AuthContext): boolean {
  if (!authContext.isAuthenticated) return false;

  const groups = authContext.groups ?? [];
  if (groups.some((group) => ADMIN_GROUPS.includes(group.toLowerCase()))) {
    return true;
  }

  const allowList = adminEmailAllowList();
  if (allowList.length > 0) {
    return (
      !!authContext.email && allowList.includes(authContext.email.toLowerCase())
    );
  }

  // No RBAC configured: allow any authenticated user, but make it visible in prod.
  if (process.env.NODE_ENV === 'production') {
    logger.warn(
      'isAdmin: no RBAC configured (set ADMIN_EMAILS or a Cognito admin group); allowing any authenticated user'
    );
  }
  return true;
}

/** 401 response. */
export function unauthorizedResponse(message = 'Unauthorized') {
  return jsonError(message, 401);
}

/** 403 response. */
export function forbiddenResponse(message = 'Forbidden') {
  return jsonError(message, 403);
}

/** Convert a thrown AuthError (or any error) into the correct HTTP response. */
export function authErrorResponse(error: unknown) {
  if (error instanceof AuthError) {
    return jsonError(error.message, error.status);
  }
  return jsonError('Unauthorized', 401);
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Parse a Cookie header into a name→value map.
 * Splits on the first `=` only, since JWTs contain `=` base64 padding.
 */
function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  cookieHeader.split(';').forEach((cookie) => {
    const trimmed = cookie.trim();
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const name = decodeURIComponent(trimmed.slice(0, eqIndex));
      const value = decodeURIComponent(trimmed.slice(eqIndex + 1));
      cookies[name] = value;
    }
  });

  return cookies;
}
