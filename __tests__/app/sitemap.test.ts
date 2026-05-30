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
    {
      // Special characters that would corrupt the XML if not escaped.
      id: 'zyxwvu98765',
      title: 'Music & Production <Live>',
      description: 'Lyrics & music © 2026 <TamilAgaval>',
      publishedAt: '2026-05-02T00:00:00Z',
      thumbnail: 'https://i.ytimg.com/vi/zyxwvu98765/hqdefault.jpg',
    },
  ]),
}));

import sitemap from '@/app/sitemap';

it('includes /videos and the core static routes', async () => {
  const urls = (await sitemap()).map((route) => route.url);

  expect(urls.some((u) => u.endsWith('/videos'))).toBe(true);
  expect(urls.some((u) => u.endsWith('/songs'))).toBe(true);
  expect(urls.some((u) => u.endsWith('/poems'))).toBe(true);
  expect(urls.some((u) => u.endsWith('/about'))).toBe(true);
  expect(urls.some((u) => u.endsWith('/contact'))).toBe(true);
  expect(urls.some((u) => u.endsWith('/privacy'))).toBe(true);
  expect(urls.some((u) => u.endsWith('.com') || u.endsWith('.com/'))).toBe(true); // home
  // Empty sections are excluded via the live-section registry.
  for (const empty of ['/lyrics', '/stories', '/essays']) {
    expect(urls.some((u) => u.endsWith(empty))).toBe(false);
  }
});

it('ranks primary content destinations above secondary ones', async () => {
  const routes = await sitemap();
  const priority = (url: string) =>
    routes.find((r) => r.url.endsWith(url))?.priority;

  expect(priority('.com')).toBe(1);                  // home wins
  expect(priority('/songs')).toBe(0.9);              // primary content
  expect(priority('/poems')).toBe(0.9);
  expect(priority('/videos')).toBe(0.9);
  expect(priority('/all')).toBeLessThan(0.9);        // secondary
  expect(priority('/music-composition')).toBeLessThan(0.9);
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

it('XML-escapes special characters in video title/description', async () => {
  const routes = await sitemap();
  const videos = routes.find((r) => r.url.endsWith('/videos'))?.videos ?? [];
  const special = videos.find((v) => v.player_loc?.includes('zyxwvu98765'));

  expect(special?.title).toBe('Music &amp; Production &lt;Live&gt;');
  expect(special?.description).toBe('Lyrics &amp; music © 2026 &lt;TamilAgaval&gt;');
  // No raw &, < or > should survive in any video field.
  for (const v of videos) {
    expect(/&(?!amp;|lt;|gt;|quot;|apos;)|<|>/.test(`${v.title}${v.description}`)).toBe(false);
  }
});
