/** @jest-environment node */
/**
 * INTEGRATION TESTS — GET /api/admin/youtube/resonance.
 * Auth + config gating, and the core promise: a low-view, high-advocacy song
 * outranks a high-view, low-advocacy song; Shorts excluded.
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/youtube-api', () => ({
  ...jest.requireActual('@/lib/youtube-api'),
  isYouTubeApiConfigured: jest.fn(() => true),
  fetchChannelVideoStats: jest.fn(),
}));

jest.mock('@/lib/youtube-analytics', () => ({
  ...jest.requireActual('@/lib/youtube-analytics'),
  isYouTubeAnalyticsConfigured: jest.fn(() => true),
  fetchVideoEngagement: jest.fn(),
}));

const mockFindByType = jest.fn();
jest.mock('@/infrastructure/database/ContentRepository', () => ({
  ContentRepository: jest.fn(() => ({ findByType: mockFindByType })),
}));

import { GET } from '@/app/api/admin/youtube/resonance/route';
import * as auth from '@/lib/auth-helper';
import * as ytApi from '@/lib/youtube-api';
import * as yta from '@/lib/youtube-analytics';

const mockAdmin = auth.requireAdmin as jest.Mock;
const mockApiOn = ytApi.isYouTubeApiConfigured as jest.Mock;
const mockVideos = ytApi.fetchChannelVideoStats as jest.Mock;
const mockYtaOn = yta.isYouTubeAnalyticsConfigured as jest.Mock;
const mockEng = yta.fetchVideoEngagement as jest.Mock;

const req = (qs = '') => new NextRequest(new Request(`http://localhost/api/admin/youtube/resonance${qs}`));

const vid = (id: string, title: string, duration: string, durationSeconds: number) => ({
  id, title, publishedAt: '2026-06-01T00:00:00Z', thumbnail: '', viewCount: 1, likeCount: 0, commentCount: 0, duration, durationSeconds,
});
const eng = (videoId: string, views: number, likes: number, comments: number, shares: number, subscribersGained: number) => ({
  videoId, views, likes, comments, shares, subscribersGained,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAdmin.mockResolvedValue({ isAuthenticated: true });
  mockApiOn.mockReturnValue(true);
  mockYtaOn.mockReturnValue(true);
  mockVideos.mockResolvedValue([
    vid('motiv', 'Motivation Song', 'PT6M4S', 364),
    vid('love', 'Love Hit', 'PT4M', 240),
    vid('sh', 'A Short', 'PT30S', 30),
  ]);
  mockEng.mockResolvedValue({
    ok: true,
    data: [
      eng('love', 16000, 160, 6, 512, 64), // huge reach, weaker per-1k advocacy
      eng('motiv', 2000, 40, 1, 88, 10), // tiny reach, strong per-1k advocacy
      eng('sh', 5000, 500, 20, 500, 50), // Short — excluded
    ],
  });
  mockFindByType.mockResolvedValue({
    items: [
      { id: 'c1', youtubeVideoId: 'motiv', theme: 'motivation' },
      { id: 'c2', youtubeVideoId: 'love', theme: 'love' },
    ],
  });
});

it('401s when not an admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockAdmin.mockRejectedValueOnce(new AuthError('Unauthorized', 401));
  expect((await GET(req())).status).toBe(401);
});

it('503s without the Data API key', async () => {
  mockApiOn.mockReturnValue(false);
  expect((await GET(req())).status).toBe(503);
});

it('503s without Analytics', async () => {
  mockYtaOn.mockReturnValue(false);
  expect((await GET(req())).status).toBe(503);
});

it('502s when the engagement report fails', async () => {
  mockEng.mockResolvedValue({ ok: false, error: 'boom' });
  expect((await GET(req())).status).toBe(502);
});

it('ranks the low-view high-advocacy song above the high-view one; excludes Shorts', async () => {
  const res = await GET(req());
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.songs[0].videoId).toBe('motiv'); // resonance beats reach
  expect(body.songs.some((s: { videoId: string }) => s.videoId === 'sh')).toBe(false);
  expect(body.channel.ranked).toBe(2);
  // resonance breakdown carries advocacy signals, not reach
  expect(body.songs[0].breakdown.some((b: { key: string }) => b.key === 'sharesPer1k')).toBe(true);
  expect(body.songs[0].breakdown.some((b: { key: string }) => b.key === 'viewsPerDay')).toBe(false);
  expect(body.songs[0].theme).toBe('motivation');
  expect(body.caveats.some((c: string) => /RESONANCE ranks by/.test(c))).toBe(true);
});
