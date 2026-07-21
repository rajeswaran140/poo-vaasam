/** @jest-environment node */
/**
 * POST /api/performers/consent — gated; records consent for the TOKEN identity
 * (never the body), returns 200/400, and maps auth failure to 401.
 */

const mockRequirePerformer = jest.fn();
const mockRecord = jest.fn();

jest.mock('@/lib/auth-helper', () => ({
  requirePerformer: (...a: unknown[]) => mockRequirePerformer(...a),
  authErrorResponse: (e: { message?: string; status?: number }) =>
    new Response(JSON.stringify({ success: false, error: e?.message ?? 'err' }), { status: e?.status ?? 401 }),
}));
jest.mock('@/lib/performer-consent', () => ({
  recordPerformerConsent: (...a: unknown[]) => mockRecord(...a),
}));

import { POST } from '@/app/api/performers/consent/route';
import { NextRequest } from 'next/server';

const req = () => new NextRequest('https://tamilagaval.com/api/performers/consent', { method: 'POST' });

class AuthError extends Error {
  status: number;
  constructor(m: string, s: number) {
    super(m);
    this.status = s;
  }
}

beforeEach(() => {
  mockRequirePerformer.mockReset();
  mockRecord.mockReset();
});

it('returns 401 when not an authenticated performer (records nothing)', async () => {
  mockRequirePerformer.mockRejectedValueOnce(new AuthError('Unauthorized', 401));
  const res = await POST(req());
  expect(res.status).toBe(401);
  expect(mockRecord).not.toHaveBeenCalled();
});

it('records consent for the token identity and returns 200', async () => {
  mockRequirePerformer.mockResolvedValueOnce({ userId: 'sub-9', email: 'p@x.com', emailVerified: true });
  mockRecord.mockResolvedValueOnce({
    recorded: true,
    consent: { termsVersion: '2026-07-21', acceptedAt: '2026-07-21T12:00:00.000Z' },
  });

  const res = await POST(req());

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    success: true,
    recorded: true,
    termsVersion: '2026-07-21',
    acceptedAt: '2026-07-21T12:00:00.000Z',
  });
  // Identity comes from the token, not the request body.
  expect(mockRecord).toHaveBeenCalledWith({ userId: 'sub-9', email: 'p@x.com' });
});

it('returns 400 when the token carries no user id', async () => {
  mockRequirePerformer.mockResolvedValueOnce({ email: 'p@x.com', emailVerified: true });
  const res = await POST(req());
  expect(res.status).toBe(400);
  expect(mockRecord).not.toHaveBeenCalled();
});

it('returns 500 when the write fails', async () => {
  mockRequirePerformer.mockResolvedValueOnce({ userId: 'sub-9', emailVerified: true });
  mockRecord.mockRejectedValueOnce(new Error('ddb down'));
  const res = await POST(req());
  expect(res.status).toBe(500);
});
