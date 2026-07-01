/** @jest-environment node */
/**
 * INTEGRATION TESTS — GET /api/admin/youtube/retention.
 *
 * Exercises the route handler end-to-end through the real pure-analysis layer,
 * with auth + the network-bound analytics lib mocked. Covers auth gating, the
 * env-not-configured gate, the videoId requirement, the benchmark verdict, the
 * new-upload empty-curve path, and upstream failure.
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/youtube-analytics', () => ({
  isYouTubeAnalyticsConfigured: jest.fn(() => true),
  fetchRetentionCurve: jest.fn(),
}));

import { GET } from '@/app/api/admin/youtube/retention/route';
import * as auth from '@/lib/auth-helper';
import * as yta from '@/lib/youtube-analytics';

const mockRequireAdmin = auth.requireAdmin as jest.Mock;
const mockConfigured = yta.isYouTubeAnalyticsConfigured as jest.Mock;
const mockCurve = yta.fetchRetentionCurve as jest.Mock;

// Strong (template) and weak retention curves as the lib would return them.
const STRONG: Array<[number, number]> = [[0, 1.05], [0.05, 0.8], [0.1, 0.73], [0.5, 0.49], [1, 0.36]];
const WEAK: Array<[number, number]> = [[0, 1.0], [0.05, 0.55], [0.1, 0.4], [0.5, 0.12], [1, 0.05]];

const req = (qs: string) =>
  new NextRequest(`https://tamilagaval.com/api/admin/youtube/retention${qs}`, { method: 'GET' });

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireAdmin.mockResolvedValue({ isAuthenticated: true });
  mockConfigured.mockReturnValue(true);
});

it('returns 403 when not admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockRequireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  expect((await GET(req('?videoId=aaaaaaaaaaa'))).status).toBe(403);
});

it('returns 503 when Analytics OAuth is not configured', async () => {
  mockConfigured.mockReturnValueOnce(false);
  const res = await GET(req('?videoId=aaaaaaaaaaa'));
  expect(res.status).toBe(503);
  expect(mockCurve).not.toHaveBeenCalled();
});

it('returns 400 when videoId is missing', async () => {
  const res = await GET(req(''));
  expect(res.status).toBe(400);
  expect((await res.json()).error).toMatch(/videoId/);
});

it('returns 400 for a malformed videoId (not 11 url-safe chars)', async () => {
  const res = await GET(req('?videoId=not-valid'));
  expect(res.status).toBe(400);
  expect((await res.json()).error).toMatch(/invalid videoId/);
  expect(mockCurve).not.toHaveBeenCalled();
});

it('classifies a weak video against a strong benchmark', async () => {
  mockCurve
    .mockResolvedValueOnce({ ok: true, data: WEAK }) // the video
    .mockResolvedValueOnce({ ok: true, data: STRONG }); // the benchmark
  const res = await GET(req('?videoId=Weak1234567&benchmarkId=Bench123456&duration=300'));
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.success).toBe(true);
  expect(body.hasData).toBe(true);
  expect(body.holdAtCheckpoint).toBeCloseTo(0.4);
  expect(body.benchmarkHoldAtCheckpoint).toBeCloseTo(0.73);
  expect(body.verdict).toBe('weak');
  expect(body.summary.hold15s).toBeCloseTo(0.55); // WEAK curve at 15/300 = 5%
  // both video + benchmark were fetched
  expect(mockCurve).toHaveBeenCalledTimes(2);
});

it('does not fetch a benchmark when benchmarkId equals videoId', async () => {
  mockCurve.mockResolvedValueOnce({ ok: true, data: STRONG });
  const res = await GET(req('?videoId=Same1234567&benchmarkId=Same1234567'));
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.benchmarkId).toBeNull();
  expect(body.verdict).toBe('strong'); // absolute thresholds, holds 0.73 at 10%
  expect(mockCurve).toHaveBeenCalledTimes(1);
});

it('treats a brand-new upload (empty curve) as hasData:false + unknown', async () => {
  mockCurve.mockResolvedValueOnce({ ok: true, data: [] });
  const res = await GET(req('?videoId=NewNewNew12'));
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.hasData).toBe(false);
  expect(body.verdict).toBe('unknown');
});

it('returns 502 when the analytics fetch fails', async () => {
  mockCurve.mockResolvedValueOnce({ ok: false, error: 'Analytics API 500: boom' });
  const res = await GET(req('?videoId=ErrErrErr12'));
  expect(res.status).toBe(502);
  expect((await res.json()).error).toMatch(/boom/);
});
