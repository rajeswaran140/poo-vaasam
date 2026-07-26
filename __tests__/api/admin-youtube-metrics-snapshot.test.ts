/** @jest-environment node */
/**
 * Tests for POST /api/admin/youtube/metrics/snapshot — the CRON_SECRET-or-admin
 * gate, the not-configured 503, the upstream 502, and a successful capture.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockConfigured = jest.fn();
const mockCapture = jest.fn();
jest.mock('@/lib/youtube-analytics', () => ({ isYouTubeAnalyticsConfigured: () => mockConfigured() }));
jest.mock('@/lib/youtube-metrics-history', () => ({ captureChannelMetrics: (...a: unknown[]) => mockCapture(...a) }));

import { POST } from '@/app/api/admin/youtube/metrics/snapshot/route';
import * as auth from '@/lib/auth-helper';

const mockedRequireAdmin = auth.requireAdmin as jest.Mock;
const SECRET = 'cron-secret-xyz';

// The admin fallback path is bearer-gated (CSRF defense); the cron path is not,
// since it authenticates with a shared secret header rather than a session.
const post = (opts?: { cronSecret?: string; days?: number; withBearer?: boolean }) => {
  const headers: Record<string, string> = {};
  if (opts?.cronSecret) headers['x-cron-secret'] = opts.cronSecret;
  if (opts?.withBearer ?? !opts?.cronSecret) headers.Authorization = 'Bearer test-token';
  return new NextRequest(`https://tamilagaval.com/api/admin/youtube/metrics/snapshot?days=${opts?.days ?? 3}`, {
    method: 'POST',
    headers,
  });
};

beforeEach(() => {
  mockedRequireAdmin.mockReset();
  mockConfigured.mockReset().mockReturnValue(true);
  mockCapture.mockReset().mockResolvedValue({ ok: true, data: { scope: 'CHANNEL', daysCaptured: 3, from: '2026-07-07', to: '2026-07-09' } });
  process.env.CRON_SECRET = SECRET;
});

it('accepts the cron secret and does NOT require an admin session', async () => {
  const res = await POST(post({ cronSecret: SECRET }));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ success: true, snapshot: { daysCaptured: 3 } });
  expect(mockedRequireAdmin).not.toHaveBeenCalled();
});

it('falls back to the admin gate when no cron secret is presented', async () => {
  mockedRequireAdmin.mockResolvedValueOnce({ isAuthenticated: true });
  const res = await POST(post());
  expect(res.status).toBe(200);
  expect(mockedRequireAdmin).toHaveBeenCalledTimes(1);
});

it('rejects a cookie-only admin (no Bearer) with 401 — CSRF defense', async () => {
  mockedRequireAdmin.mockResolvedValueOnce({ isAuthenticated: true });
  const res = await POST(post({ withBearer: false }));
  expect(res.status).toBe(401);
  expect(mockCapture).not.toHaveBeenCalled();
});

it('rejects a wrong cron secret with no admin session (401/403)', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockedRequireAdmin.mockRejectedValueOnce(new AuthError('Unauthorized', 401));
  const res = await POST(post({ cronSecret: 'WRONG' }));
  expect(res.status).toBe(401);
  expect(mockCapture).not.toHaveBeenCalled();
});

it('returns 503 when Analytics OAuth is not configured', async () => {
  mockConfigured.mockReturnValue(false);
  const res = await POST(post({ cronSecret: SECRET }));
  expect(res.status).toBe(503);
  expect(mockCapture).not.toHaveBeenCalled();
});

it('maps an upstream capture failure to 502', async () => {
  mockCapture.mockResolvedValueOnce({ ok: false, error: 'No response from YouTube Analytics' });
  const res = await POST(post({ cronSecret: SECRET }));
  expect(res.status).toBe(502);
});

it('passes the clamped days through to capture', async () => {
  await POST(post({ cronSecret: SECRET, days: 180 }));
  expect(mockCapture).toHaveBeenCalledWith({ daysBack: 180 });
});
