/** @jest-environment node */
/**
 * generateMetadata for /videos — the share-image audit fix: the OG/Twitter image
 * must be the latest LONG-FORM video's mirrored (S3) thumbnail, never a Short's
 * portrait frame and never an i.ytimg `maxresdefault` (which 404s for some
 * videos). Falls back gracefully when there are no long-form videos / no feed.
 */

// Mock only fetchChannelVideos / isYouTubeVideosConfigured; keep the real
// s3ThumbnailUrl + JSON-LD builder + the rest of config/site. Mocks are defined
// INSIDE the factories (jest hoists them above outer consts → TDZ otherwise).
jest.mock('@/lib/youtube-feed', () => ({
  ...jest.requireActual('@/lib/youtube-feed'),
  fetchChannelVideos: jest.fn(),
}));
jest.mock('@/config/site', () => ({
  ...jest.requireActual('@/config/site'),
  isYouTubeVideosConfigured: jest.fn(),
}));

import { generateMetadata } from '@/app/videos/page';
import { s3ThumbnailUrl } from '@/lib/youtube-feed';

const fetchChannelVideos = (jest.requireMock('@/lib/youtube-feed') as any).fetchChannelVideos as jest.Mock;
const isConfigured = (jest.requireMock('@/config/site') as any).isYouTubeVideosConfigured as jest.Mock;

const SHORT = { id: 'shortAAAAAAA', title: 'A Short', description: 's', publishedAt: '2026-06-09T00:00:00Z', thumbnail: s3ThumbnailUrl('shortAAAAAAA'), watchUrl: 'w', duration: 'PT50S' };
const LONG_A = { id: 'longAAAAAAAA', title: 'Song A', description: 'a', publishedAt: '2026-06-08T00:00:00Z', thumbnail: s3ThumbnailUrl('longAAAAAAAA'), watchUrl: 'w', duration: 'PT4M30S' };
const LONG_B = { id: 'longBBBBBBBB', title: 'Song B', description: 'b', publishedAt: '2026-06-07T00:00:00Z', thumbnail: s3ThumbnailUrl('longBBBBBBBB'), watchUrl: 'w', duration: 'PT5M0S' };

const ogUrl = (m: Awaited<ReturnType<typeof generateMetadata>>) => {
  const imgs = m.openGraph?.images as Array<{ url: string }>;
  return imgs[0].url;
};
const twUrl = (m: Awaited<ReturnType<typeof generateMetadata>>) => {
  const imgs = m.twitter?.images as string[];
  return imgs[0];
};

beforeEach(() => {
  fetchChannelVideos.mockReset();
  isConfigured.mockReset();
});

it('uses the latest LONG-FORM video thumbnail for the share image (not the latest Short)', async () => {
  isConfigured.mockReturnValue(true);
  // Latest upload is the Short; the share image must skip it for the first long-form.
  fetchChannelVideos.mockResolvedValueOnce([SHORT, LONG_A, LONG_B]);

  const m = await generateMetadata();
  const og = ogUrl(m);

  expect(og).toBe(s3ThumbnailUrl('longAAAAAAAA'));
  expect(og).toContain('video-thumbs/longAAAAAAAA');
  expect(og).not.toContain('shortAAAAAAA');     // not the latest Short
  expect(og).not.toMatch(/ytimg|maxresdefault/); // not the 404-prone i.ytimg variant
  expect(twUrl(m)).toBe(og);                     // twitter mirrors og
});

it('falls back to the latest item when there are no long-form videos', async () => {
  isConfigured.mockReturnValue(true);
  fetchChannelVideos.mockResolvedValueOnce([SHORT]); // shorts only
  const m = await generateMetadata();
  expect(ogUrl(m)).toBe(s3ThumbnailUrl('shortAAAAAAA')); // graceful, no crash
});

it('uses a static mirrored fallback when the channel is not configured', async () => {
  isConfigured.mockReturnValue(false);
  const m = await generateMetadata();
  expect(ogUrl(m)).toBe(s3ThumbnailUrl('gfywsN483lI'));
  expect(fetchChannelVideos).not.toHaveBeenCalled();
  expect(ogUrl(m)).not.toMatch(/ytimg|maxresdefault/);
});

it('keeps title/description/canonical intact', async () => {
  isConfigured.mockReturnValue(true);
  fetchChannelVideos.mockResolvedValueOnce([LONG_A]);
  const m = await generateMetadata();
  expect(m.title).toMatch(/Tamil Videos/i);
  expect(m.openGraph?.url).toBe('/videos');
});

it('uses a keyword-rich description covering songs, poems and the brand', async () => {
  isConfigured.mockReturnValue(true);
  fetchChannelVideos.mockResolvedValueOnce([LONG_A]);
  const m = await generateMetadata();
  const desc = String(m.description);
  expect(desc).toMatch(/Tamil songs/i);
  expect(desc).toMatch(/poems/i);
  expect(desc).toMatch(/Tamilagaval/);
  // Description stays within a sane meta length (Google truncates ~160).
  expect(desc.length).toBeLessThanOrEqual(160);
});
