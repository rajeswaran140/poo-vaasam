/** @jest-environment node */
/**
 * The sitemap should advertise /status and attach the self-hosted Status clips
 * as video entries (content_loc = the mp4) so the shorts are eligible for video
 * search. SongCatalog is mocked to return a song matching a STATUS_CLIPS id.
 */

jest.mock('@/infrastructure/database/ContentRepository', () => ({
  ContentRepository: jest.fn().mockReturnValue({
    findAll: jest.fn().mockResolvedValue({ items: [], lastEvaluatedKey: undefined }),
  }),
}));

jest.mock('@/lib/youtube-feed', () => ({ fetchChannelVideos: jest.fn().mockResolvedValue([]) }));

jest.mock('@/application/use-cases/SongCatalog', () => ({
  SongCatalog: jest.fn().mockReturnValue({
    listPublished: jest.fn().mockResolvedValue([
      { id: 'cnt_1780067292516_rpxtdnhoa', title: 'அக்கம் பக்கம்', theme: 'love', publishedAt: '2026-02-01T00:00:00Z' },
    ]),
  }),
}));

import sitemap from '@/app/sitemap';
import { SITE_URL } from '@/lib/seo';

it('lists /status and attaches the self-hosted clip as a video entry', async () => {
  const routes = await sitemap();
  const status = routes.find((r) => r.url === `${SITE_URL}/status`);

  expect(status).toBeDefined();
  expect(status?.videos?.length).toBeGreaterThan(0);

  const v = status!.videos![0];
  expect(v.content_loc).toBe(`${SITE_URL}/clips/akkam-short.mp4`);
  expect(v.thumbnail_loc).toBe(`${SITE_URL}/clips/akkam-short.jpg`);
  expect(v.publication_date).toBe('2026-02-01T00:00:00Z');
});
