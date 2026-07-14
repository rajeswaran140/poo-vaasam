/** @jest-environment node */
/**
 * Tests for GET /api/admin/youtube/referrals — the WhatsApp referral coefficient
 * (the return leg of the share loop). Admin gate, not-configured 503, upstream
 * 502, day clamping, and the payload contract.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockConfigured = jest.fn();
const mockCoefficient = jest.fn();
jest.mock('@/lib/youtube-analytics', () => ({ isYouTubeAnalyticsConfigured: () => mockConfigured() }));
jest.mock('@/lib/whatsapp-referrals', () => ({
  fetchReferralCoefficient: (...a: unknown[]) => mockCoefficient(...a),
}));

import { GET } from '@/app/api/admin/youtube/referrals/route';
import * as auth from '@/lib/auth-helper';

const mockedRequireAdmin = auth.requireAdmin as jest.Mock;
const req = (qs = '') => new NextRequest(`https://tamilagaval.com/api/admin/youtube/referrals${qs}`);

const COEFFICIENT = {
  windowDays: 28,
  channelViews: 213_046,
  whatsappViews: 2600,
  externalViews: 2646,
  whatsappPer1k: 12.2,
  whatsappShareOfExternal: 98.3,
  sources: [
    { source: 'WhatsApp', views: 1578, estimatedMinutesWatched: 3000, isWhatsApp: true },
    { source: 'facebook.com', views: 26, estimatedMinutesWatched: 40, isWhatsApp: false },
  ],
};

beforeEach(() => {
  mockedRequireAdmin.mockReset().mockResolvedValue({ isAuthenticated: true });
  mockConfigured.mockReset().mockReturnValue(true);
  mockCoefficient.mockReset().mockResolvedValue({ ok: true, data: COEFFICIENT });
});

it('returns the coefficient for an admin', async () => {
  const res = await GET(req('?days=28'));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    success: true,
    whatsappPer1k: 12.2,
    whatsappViews: 2600,
    channelViews: 213_046,
    whatsappShareOfExternal: 98.3,
  });
});

it('includes the per-source breakdown with WhatsApp flagged', async () => {
  const res = await GET(req());
  const json = await res.json();
  expect(json.sources).toHaveLength(2);
  expect(json.sources[0]).toMatchObject({ source: 'WhatsApp', isWhatsApp: true });
  expect(json.sources[1]).toMatchObject({ source: 'facebook.com', isWhatsApp: false });
});

it('rejects a non-admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockedRequireAdmin.mockRejectedValueOnce(new AuthError('Unauthorized', 401));
  const res = await GET(req());
  expect(res.status).toBe(401);
  expect(mockCoefficient).not.toHaveBeenCalled();
});

it('returns 503 when Analytics OAuth is not configured', async () => {
  mockConfigured.mockReturnValue(false);
  const res = await GET(req());
  expect(res.status).toBe(503);
  expect(mockCoefficient).not.toHaveBeenCalled();
});

it('maps an upstream failure to 502 rather than reporting a 0 coefficient', async () => {
  mockCoefficient.mockResolvedValueOnce({ ok: false, error: 'Analytics API 429' });
  const res = await GET(req());
  expect(res.status).toBe(502);
  expect(await res.json()).toMatchObject({ success: false, error: 'Analytics API 429' });
});

it('defaults to a 28-day window', async () => {
  await GET(req());
  expect(mockCoefficient).toHaveBeenCalledWith(28);
});

it('clamps the window into range', async () => {
  await GET(req('?days=9999'));
  expect(mockCoefficient).toHaveBeenCalledWith(365);
  mockCoefficient.mockClear();
  await GET(req('?days=-5'));
  expect(mockCoefficient).toHaveBeenCalledWith(1);
  mockCoefficient.mockClear();
  await GET(req('?days=junk'));
  expect(mockCoefficient).toHaveBeenCalledWith(28);
});
