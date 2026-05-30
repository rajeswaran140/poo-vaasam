/** @jest-environment node */
/**
 * Unit tests for GET /api/admin/youtube/stats — admin gating + the three
 * status branches: missing API key (503), upstream failure (502), happy path.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/youtube-api', () => ({
  isYouTubeApiConfigured: jest.fn(),
  fetchChannelStats: jest.fn(),
  fetchChannelVideoStats: jest.fn(),
}));

import { GET } from '@/app/api/admin/youtube/stats/route';
import * as auth from '@/lib/auth-helper';
import * as ytApi from '@/lib/youtube-api';

const mockedRequireAdmin = auth.requireAdmin as jest.Mock;
const mockedIsConfigured = ytApi.isYouTubeApiConfigured as jest.Mock;
const mockedFetchChannel = ytApi.fetchChannelStats as jest.Mock;
const mockedFetchVideos = ytApi.fetchChannelVideoStats as jest.Mock;

const req = () => new NextRequest('https://tamilagaval.com/api/admin/youtube/stats');

beforeEach(() => {
  jest.clearAllMocks();
  mockedRequireAdmin.mockResolvedValue({ isAuthenticated: true, email: 'admin@example.com' });
});

it('rejects with the AuthError status when the caller is not an admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockedRequireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  const res = await GET(req());
  expect(res.status).toBe(403);
  // The expensive upstream calls must not be made when auth fails.
  expect(mockedFetchChannel).not.toHaveBeenCalled();
  expect(mockedFetchVideos).not.toHaveBeenCalled();
});

it('returns 503 when YOUTUBE_API_KEY is not configured', async () => {
  mockedIsConfigured.mockReturnValue(false);
  const res = await GET(req());
  expect(res.status).toBe(503);
  const body = await res.json();
  expect(body.success).toBe(false);
  expect(body.error).toMatch(/YOUTUBE_API_KEY/);
  // The expensive upstream calls must not be made when the key is missing.
  expect(mockedFetchChannel).not.toHaveBeenCalled();
  expect(mockedFetchVideos).not.toHaveBeenCalled();
});

it('returns 502 when the YouTube API fails or returns no channel', async () => {
  mockedIsConfigured.mockReturnValue(true);
  mockedFetchChannel.mockResolvedValue(null);
  mockedFetchVideos.mockResolvedValue([]);
  const res = await GET(req());
  expect(res.status).toBe(502);
  const body = await res.json();
  expect(body.success).toBe(false);
});

it('returns channel + videos on the happy path', async () => {
  mockedIsConfigured.mockReturnValue(true);
  mockedFetchChannel.mockResolvedValue({
    channelId: 'UCabc',
    title: 'Ch',
    subscriberCount: 1234,
    viewCount: 56789,
    videoCount: 12,
    uploadsPlaylistId: 'UUabc',
  });
  mockedFetchVideos.mockResolvedValue([
    { id: 'vid1', title: 'First', publishedAt: '', thumbnail: '', viewCount: 10, likeCount: 1, commentCount: 0, duration: 'PT1M', durationSeconds: 60 },
  ]);
  const res = await GET(req());
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.channel.subscriberCount).toBe(1234);
  expect(body.videos).toHaveLength(1);
  // Channel + videos fetched in parallel.
  expect(mockedFetchChannel).toHaveBeenCalledTimes(1);
  expect(mockedFetchVideos).toHaveBeenCalledTimes(1);
});
