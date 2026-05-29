import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentStatus } from '@/types/content';
import { SITE, isYouTubeVideosConfigured } from '@/config/site';
import { fetchChannelVideos } from '@/lib/youtube-feed';

// Regenerate hourly rather than per-request.
export const revalidate = 3600;

type VideoEntry = NonNullable<MetadataRoute.Sitemap[number]['videos']>[number];

// Next.js does not XML-escape video title/description fields, so a raw "&",
// "<" or ">" (common in YouTube descriptions) would corrupt the sitemap.
const xmlEscape = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const videosEnabled = isYouTubeVideosConfigured();

  // Section/landing pages that surface content, and lower-priority info pages.
  const sectionPaths = ['', '/songs', '/poems', '/lyrics', '/stories', '/essays', '/all', '/music-composition'];
  if (videosEnabled) {
    sectionPaths.push('/videos');
  }
  const infoPaths = ['/about', '/contact'];

  // YouTube videos attached to the /videos page so they're eligible for video
  // search. fetchChannelVideos returns [] on any error, so this never breaks
  // the sitemap.
  let videoEntries: VideoEntry[] = [];
  if (videosEnabled) {
    const videos = await fetchChannelVideos(SITE.youtube.channelId, 50);
    videoEntries = videos.map((v) => ({
      title: xmlEscape(v.title),
      thumbnail_loc: v.thumbnail,
      // Video sitemap descriptions are capped at 2048 chars; trim then escape.
      description: xmlEscape((v.description || v.title).slice(0, 1900)),
      player_loc: `https://www.youtube.com/embed/${v.id}`,
      ...(v.publishedAt ? { publication_date: v.publishedAt } : {}),
    }));
  }

  let contentRoutes: MetadataRoute.Sitemap = [];
  // Newest content change drives the site-wide lastmod, so static pages only
  // look "modified" when content actually changes (not on every regeneration).
  let siteLastMod = new Date(0);

  try {
    const repo = new ContentRepository();
    let cursor: Record<string, unknown> | undefined;
    type ContentEntity = Awaited<ReturnType<typeof repo.findAll>>['items'][number];
    const items: ContentEntity[] = [];

    // Page through published content (cap at 10 pages = 1000 items).
    for (let i = 0; i < 10; i++) {
      const res = await repo.findAll({ limit: 100, status: ContentStatus.PUBLISHED, lastEvaluatedKey: cursor });
      items.push(...res.items);
      cursor = res.lastEvaluatedKey;
      if (!cursor) break;
    }

    contentRoutes = items.map((entity) => {
      const c = entity.toObject();
      const updated = c.updatedAt ? new Date(String(c.updatedAt)) : new Date();
      if (updated > siteLastMod) siteLastMod = updated;
      return {
        url: `${SITE_URL}/content/${c.id}`,
        lastModified: updated,
        changeFrequency: 'monthly',
        priority: 0.7,
      };
    });
  } catch (error) {
    console.error('[sitemap] failed to load content, returning static routes only:', error);
  }

  const lastModified = siteLastMod.getTime() > 0 ? siteLastMod : new Date();

  const sectionRoutes: MetadataRoute.Sitemap = sectionPaths.map((p) => ({
    url: `${SITE_URL}${p}`,
    lastModified,
    changeFrequency: 'weekly',
    priority: p === '' ? 1 : 0.8,
    ...(p === '/videos' && videoEntries.length > 0 ? { videos: videoEntries } : {}),
  }));

  const infoRoutes: MetadataRoute.Sitemap = infoPaths.map((p) => ({
    url: `${SITE_URL}${p}`,
    lastModified,
    changeFrequency: 'monthly',
    priority: 0.5,
  }));

  return [...sectionRoutes, ...infoRoutes, ...contentRoutes];
}
