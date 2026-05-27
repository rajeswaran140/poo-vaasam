/** @jest-environment node */
/**
 * Tests for GET /api/youtube/videos.
 */

jest.mock('@/config/site', () => ({
  ...jest.requireActual('@/config/site'),
  isYouTubeVideosConfigured: jest.fn(),
}));
jest.mock('@/lib/youtube-feed', () => ({ fetchChannelVideos: jest.fn() }));

import { GET } from '@/app/api/youtube/videos/route';
import * as site from '@/config/site';
import { fetchChannelVideos } from '@/lib/youtube-feed';

beforeEach(() => {
  jest.clearAllMocks();
});

it('returns configured:false and no videos when the channel is not configured', async () => {
  (site.isYouTubeVideosConfigured as jest.Mock).mockReturnValue(false);

  const res = await GET();
  const json = await res.json();

  expect(json.success).toBe(true);
  expect(json.data.configured).toBe(false);
  expect(json.data.videos).toEqual([]);
  expect(json.data.subscribeUrl).toContain('sub_confirmation=1');
  expect(fetchChannelVideos).not.toHaveBeenCalled();
});

it('returns the latest videos when configured', async () => {
  (site.isYouTubeVideosConfigured as jest.Mock).mockReturnValue(true);
  (fetchChannelVideos as jest.Mock).mockResolvedValue([
    { id: 'gfywsN483lI', title: 'பாடல்', publishedAt: '', thumbnail: 't', watchUrl: 'w' },
  ]);

  const res = await GET();
  const json = await res.json();

  expect(json.data.configured).toBe(true);
  expect(json.data.videos).toHaveLength(1);
  expect(json.data.videos[0].id).toBe('gfywsN483lI');
});
