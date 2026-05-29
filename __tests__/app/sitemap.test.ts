/** @jest-environment node */
/**
 * Sitemap should advertise the /videos page (when the channel is configured),
 * alongside the core static routes, even if content loading fails.
 */

jest.mock('@/infrastructure/database/ContentRepository', () => ({
  ContentRepository: jest.fn().mockReturnValue({
    findAll: jest.fn().mockResolvedValue({ items: [], lastEvaluatedKey: undefined }),
  }),
}));

// Avoid a real network call to the YouTube RSS feed during the test.
jest.mock('@/lib/youtube-feed', () => ({
  fetchChannelVideos: jest.fn().mockResolvedValue([
    {
      id: 'abcdef12345',
      title: 'Sample Tamil Song',
      description: 'A sample description',
      publishedAt: '2026-05-01T00:00:00Z',
      thumbnail: 'https://i.ytimg.com/vi/abcdef12345/hqdefault.jpg',
    },
  ]),
}));

import sitemap from '@/app/sitemap';

it('includes /videos and the core static routes', async () => {
  const urls = (await sitemap()).map((route) => route.url);

  expect(urls.some((u) => u.endsWith('/videos'))).toBe(true);
  expect(urls.some((u) => u.endsWith('/songs'))).toBe(true);
  expect(urls.some((u) => u.endsWith('.com') || u.endsWith('.com/'))).toBe(true); // home
});

it('attaches YouTube video entries to the /videos page', async () => {
  const routes = await sitemap();
  const videosRoute = routes.find((r) => r.url.endsWith('/videos'));

  expect(videosRoute?.videos?.length).toBeGreaterThan(0);
  expect(videosRoute?.videos?.[0]).toMatchObject({
    title: 'Sample Tamil Song',
    thumbnail_loc: 'https://i.ytimg.com/vi/abcdef12345/hqdefault.jpg',
    description: 'A sample description',
    player_loc: 'https://www.youtube.com/embed/abcdef12345',
    publication_date: '2026-05-01T00:00:00Z',
  });
  // Non-video pages must not carry video entries.
  expect(routes.find((r) => r.url.endsWith('/songs'))?.videos).toBeUndefined();
});
