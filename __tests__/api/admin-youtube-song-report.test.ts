/** @jest-environment node */
/**
 * INTEGRATION TESTS — GET /api/admin/youtube/song-report.
 * Auth + validation gating, happy-path composition, and per-section degradation.
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/youtube-analytics', () => ({
  ...jest.requireActual('@/lib/youtube-analytics'),
  isYouTubeAnalyticsConfigured: jest.fn(() => true),
  fetchVideoTotals: jest.fn(),
  fetchVideoDailySeries: jest.fn(),
  fetchVideoTrafficSources: jest.fn(),
  fetchVideoSubscribedSplit: jest.fn(),
  fetchVideoDeviceMix: jest.fn(),
}));

jest.mock('@/lib/youtube-api', () => ({
  ...jest.requireActual('@/lib/youtube-api'),
  fetchVideoStatsById: jest.fn(),
}));

import { GET } from '@/app/api/admin/youtube/song-report/route';
import * as auth from '@/lib/auth-helper';
import * as yta from '@/lib/youtube-analytics';
import * as ytApi from '@/lib/youtube-api';

const mockAdmin = auth.requireAdmin as jest.Mock;
const mockConfigured = yta.isYouTubeAnalyticsConfigured as jest.Mock;
const mockTotals = yta.fetchVideoTotals as jest.Mock;
const mockDaily = yta.fetchVideoDailySeries as jest.Mock;
const mockSources = yta.fetchVideoTrafficSources as jest.Mock;
const mockSub = yta.fetchVideoSubscribedSplit as jest.Mock;
const mockDevice = yta.fetchVideoDeviceMix as jest.Mock;
const mockMeta = ytApi.fetchVideoStatsById as jest.Mock;

const VID = 'GXLu3Y7FghU';
const req = (id: string | null = VID) =>
  new NextRequest(new Request(`http://localhost/api/admin/youtube/song-report${id ? `?videoId=${id}` : ''}`));

function daily14() {
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date('2026-06-11T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    return {
      date: d.toISOString().slice(0, 10),
      views: i < 7 ? 2000 : 700,
      subscribersGained: 5,
      estimatedMinutesWatched: 3000,
      averageViewPercentage: i < 7 ? 32 : 50, // rising retention
    };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAdmin.mockResolvedValue({ isAuthenticated: true });
  mockConfigured.mockReturnValue(true);
  mockMeta.mockResolvedValue({
    id: VID,
    title: 'நீ சிரிச்ச நேரம் தான்',
    publishedAt: '2026-06-11T01:09:34Z',
    durationSeconds: 365,
  });
  mockTotals.mockResolvedValue({
    ok: true,
    data: {
      views: 40086,
      estimatedMinutesWatched: 111846,
      averageViewDuration: 167,
      averageViewPercentage: 45.9,
      subscribersGained: 187,
      subscribersLost: 1,
      likes: 359,
      comments: 7,
      shares: 1140,
    },
  });
  mockDaily.mockResolvedValue({ ok: true, data: daily14() });
  mockSources.mockImplementation((_id: string, start: string) =>
    // recent window (start within July) returns lower Suggested than prior
    Promise.resolve({
      ok: true,
      data:
        start >= '2026-07-08'
          ? [{ source: 'RELATED_VIDEO', views: 2183 }]
          : start >= '2026-07-01'
            ? [{ source: 'RELATED_VIDEO', views: 5555 }]
            : [
                { source: 'RELATED_VIDEO', views: 18182 },
                { source: 'PLAYLIST', views: 14061 },
                { source: 'SUBSCRIBER', views: 4625 },
              ],
    })
  );
  mockSub.mockResolvedValue({
    ok: true,
    data: [
      { status: 'SUBSCRIBED', views: 783, averageViewPercentage: 61.5 },
      { status: 'UNSUBSCRIBED', views: 39303, averageViewPercentage: 45.6 },
    ],
  });
  mockDevice.mockResolvedValue({ ok: true, data: [{ device: 'MOBILE', views: 37157 }, { device: 'DESKTOP', views: 1998 }] });
});

it('401s when not an admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockAdmin.mockRejectedValueOnce(new AuthError('Unauthorized', 401));
  expect((await GET(req())).status).toBe(401);
});

it('400s on a missing/invalid videoId', async () => {
  expect((await GET(req(null))).status).toBe(400);
  expect((await GET(req('not a real id!'))).status).toBe(400);
});

it('503s when Analytics OAuth is not configured', async () => {
  mockConfigured.mockReturnValue(false);
  expect((await GET(req())).status).toBe(503);
});

it('404s when the video metadata is unavailable', async () => {
  mockMeta.mockResolvedValue(null);
  expect((await GET(req())).status).toBe(404);
});

it('builds the full report on the happy path', async () => {
  const res = await GET(req());
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  const r = body.report;
  expect(r.videoId).toBe(VID);
  expect(r.summary.netSubscribers).toBe(186);
  expect(r.summary.shareRatePer1k).toBeCloseTo(28.4, 1);
  expect(r.weekly.length).toBeGreaterThanOrEqual(2);
  expect(r.sourceTrend.floor).toBe('durable');
  expect(r.subscribedSplit.retentionGap).toBeCloseTo(15.9, 1);
  expect(r.diagnosis.verdict).toBe('reach-cooldown');
  expect(r.impressionsCaveat).toMatch(/Studio-only/);
});

it('degrades a failed section without 500ing (totals unavailable)', async () => {
  mockTotals.mockResolvedValue({ ok: false, error: 'boom' });
  const res = await GET(req());
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.report.summary).toBeNull();
  // diagnosis (from daily) still computes
  expect(body.report.diagnosis.verdict).toBe('reach-cooldown');
});
