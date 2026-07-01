/** @jest-environment node */
/**
 * /api/admin/youtube/recommendations — admin-gated. GET returns the cache;
 * POST regenerates (one LLM call) + caches. The LLM lives ONLY here.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockGet = jest.fn();
const mockSave = jest.fn();
jest.mock('@/infrastructure/database/YtRecsRepository', () => ({
  YtRecsRepository: jest.fn().mockImplementation(() => ({ get: mockGet, save: mockSave })),
}));

jest.mock('@/lib/youtube-analytics', () => ({
  isYouTubeAnalyticsConfigured: jest.fn(() => true),
  fetchChannelAnalyticsSnapshot: jest.fn(),
  fetchVideoAnalytics: jest.fn(),
}));
jest.mock('@/lib/youtube-api', () => ({
  isYouTubeApiConfigured: jest.fn(() => false),
  fetchChannelVideoStats: jest.fn(),
}));
jest.mock('@/services/ai/youtube-recommendations', () => ({
  generateYouTubeRecommendations: jest.fn(),
}));

import { GET, POST } from '@/app/api/admin/youtube/recommendations/route';
import * as auth from '@/lib/auth-helper';
import * as yta from '@/lib/youtube-analytics';
import { generateYouTubeRecommendations } from '@/services/ai/youtube-recommendations';

const mockedRequireAdmin = auth.requireAdmin as jest.Mock;
const mockSnapshot = yta.fetchChannelAnalyticsSnapshot as jest.Mock;
const mockVideoAnalytics = yta.fetchVideoAnalytics as jest.Mock;
const mockGen = generateYouTubeRecommendations as jest.Mock;
const mockConfigured = yta.isYouTubeAnalyticsConfigured as jest.Mock;

const req = (method = 'GET', withBearer = true) =>
  new NextRequest('https://tamilagaval.com/api/admin/youtube/recommendations', {
    method,
    headers: withBearer ? { Authorization: 'Bearer test-token' } : undefined,
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockedRequireAdmin.mockResolvedValue({ isAuthenticated: true });
  mockConfigured.mockReturnValue(true);
  mockSnapshot.mockResolvedValue({ ok: true, data: { daysBack: 28, views: 100, subscribersGained: 5, subscribersLost: 0, estimatedMinutesWatched: 50, averageViewDuration: 60 } });
  mockVideoAnalytics.mockResolvedValue({ ok: true, data: [{ videoId: 'v1', views: 10, estimatedMinutesWatched: 5, averageViewDuration: 30, subscribersGained: 1 }] });
  mockGen.mockResolvedValue({ ok: true, data: ['rec one', 'rec two'] });
});

it('GET returns the cached recs', async () => {
  mockGet.mockResolvedValueOnce({ recommendations: ['cached rec'], generatedAt: 't', days: 28 });
  const res = await GET(req('GET'));
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.cached.recommendations).toEqual(['cached rec']);
  expect(mockGen).not.toHaveBeenCalled(); // GET never calls the LLM
});

it('GET returns 403 when not admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockedRequireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  expect((await GET(req('GET'))).status).toBe(403);
});

it('POST regenerates, caches, and returns the recs', async () => {
  const res = await POST(req('POST'));
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.success).toBe(true);
  expect(body.recommendations).toEqual(['rec one', 'rec two']);
  expect(mockGen).toHaveBeenCalledTimes(1);
  expect(mockSave).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ recommendations: ['rec one', 'rec two'], days: 28 }));
});

it('POST returns 401 without a Bearer token (CSRF defense on the mutation)', async () => {
  const res = await POST(req('POST', false));
  expect(res.status).toBe(401);
  expect(mockGen).not.toHaveBeenCalled();
  expect(mockSave).not.toHaveBeenCalled();
});

it('POST returns 503 when Analytics OAuth is not configured', async () => {
  mockConfigured.mockReturnValueOnce(false);
  expect((await POST(req('POST'))).status).toBe(503);
  expect(mockGen).not.toHaveBeenCalled();
});

it('POST returns 502 when an analytics query fails (no LLM call)', async () => {
  mockSnapshot.mockResolvedValueOnce({ ok: false, error: 'analytics down' });
  const res = await POST(req('POST'));
  expect(res.status).toBe(502);
  expect(mockGen).not.toHaveBeenCalled();
  expect(mockSave).not.toHaveBeenCalled();
});
