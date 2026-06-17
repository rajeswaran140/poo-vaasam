/** @jest-environment node */
/**
 * GET /api/performers/me — gated by requirePerformer. Returns the signed-in
 * performer's identity; surfaces the AuthError status (401/403) otherwise.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requirePerformer: jest.fn(),
}));

import { GET } from '@/app/api/performers/me/route';
import * as auth from '@/lib/auth-helper';

const requirePerformer = auth.requirePerformer as jest.Mock;
const req = () => new NextRequest('https://tamilagaval.com/api/performers/me');

beforeEach(() => jest.clearAllMocks());

it('returns the performer identity on the happy path', async () => {
  requirePerformer.mockResolvedValue({ isAuthenticated: true, userId: 'u-1', email: 'singer@example.com', emailVerified: true });
  const res = await GET(req());
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({ success: true, userId: 'u-1', email: 'singer@example.com' });
});

it('returns 401 when unauthenticated', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  requirePerformer.mockRejectedValue(new AuthError('Unauthorized', 401));
  const res = await GET(req());
  expect(res.status).toBe(401);
});

it('returns 403 when the email is not verified', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  requirePerformer.mockRejectedValue(new AuthError('Email not verified', 403));
  const res = await GET(req());
  expect(res.status).toBe(403);
  expect((await res.json()).error).toBe('Email not verified');
});
