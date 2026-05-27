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

import sitemap from '@/app/sitemap';

it('includes /videos and the core static routes', async () => {
  const urls = (await sitemap()).map((route) => route.url);

  expect(urls.some((u) => u.endsWith('/videos'))).toBe(true);
  expect(urls.some((u) => u.endsWith('/songs'))).toBe(true);
  expect(urls.some((u) => u.endsWith('.com') || u.endsWith('.com/'))).toBe(true); // home
});
