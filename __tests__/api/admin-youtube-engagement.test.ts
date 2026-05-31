/** @jest-environment node */
/**
 * Tests for GET /api/admin/youtube/engagement — auth gate, env gate, days
 * clamp, and happy-path payload shape.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/ga4-api', () => ({
  isGA4Configured: jest.fn(),
  fetchAudioPlays: jest.fn(),
  fetchYouTubeOpens: jest.fn(),
}));

import { GET } from '@/app/api/admin/youtube/engagement/route';
import * as auth from '@/lib/auth-helper';
import * as ga4 from '@/lib/ga4-api';

const mockedRequireAdmin = auth.requireAdmin as jest.Mock;
const mockedIsConfigured = ga4.isGA4Configured as jest.Mock;
const mockedAudio = ga4.fetchAudioPlays as jest.Mock;
const mockedYouTube = ga4.fetchYouTubeOpens as jest.Mock;

const req = (qs = '') =>
  new NextRequest(`https://tamilagaval.com/api/admin/youtube/engagement${qs}`);

beforeEach(() => {
  jest.clearAllMocks();
  mockedRequireAdmin.mockResolvedValue({ isAuthenticated: true, email: 'admin@example.com' });
});

it('rejects with 403 when caller is not admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockedRequireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  const res = await GET(req());
  expect(res.status).toBe(403);
  expect(mockedAudio).not.toHaveBeenCalled();
  expect(mockedYouTube).not.toHaveBeenCalled();
});

it('returns 503 when GA4 is not configured', async () => {
  mockedIsConfigured.mockReturnValue(false);
  const res = await GET(req());
  expect(res.status).toBe(503);
  const body = await res.json();
  expect(body.error).toMatch(/GA4_PROPERTY_ID|GA4_SERVICE_ACCOUNT_KEY/);
});

it('clamps `days` into 1..90', async () => {
  mockedIsConfigured.mockReturnValue(true);
  mockedAudio.mockResolvedValue({ ok: true, data: { rows: [], total: 0 } });
  mockedYouTube.mockResolvedValue({ ok: true, data: { rows: [], total: 0 } });

  await GET(req('?days=999'));
  expect(mockedAudio).toHaveBeenCalledWith(90);

  await GET(req('?days=-5'));
  expect(mockedAudio).toHaveBeenLastCalledWith(1);
});

it('returns aggregated payload on happy path', async () => {
  mockedIsConfigured.mockReturnValue(true);
  mockedAudio.mockResolvedValue({
    ok: true,
    data: {
      rows: [
        { label: 'அந்தி மேகமே', eventCount: 100 },
        { label: 'என்ன மாயம்', eventCount: 60 },
      ],
      total: 160,
    },
  });
  mockedYouTube.mockResolvedValue({
    ok: true,
    data: {
      rows: [
        { label: 'video:abc123', eventCount: 25 },
        { label: 'channel', eventCount: 7 },
      ],
      total: 32,
    },
  });

  const res = await GET(req('?days=28'));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.days).toBe(28);
  expect(body.audioPlays.ok).toBe(true);
  expect(body.audioPlays.data.total).toBe(160);
  expect(body.audioPlays.data.rows).toHaveLength(2);
  expect(body.youtubeOpens.ok).toBe(true);
  expect(body.youtubeOpens.data.total).toBe(32);
  // Parallel fetch.
  expect(mockedAudio).toHaveBeenCalledTimes(1);
  expect(mockedYouTube).toHaveBeenCalledTimes(1);
});
