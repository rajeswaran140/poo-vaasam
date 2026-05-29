import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentStatus } from '@/types/content';
import { isYouTubeVideosConfigured } from '@/config/site';

// Regenerate hourly rather than per-request.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Section/landing pages that surface content, and lower-priority info pages.
  const sectionPaths = ['', '/songs', '/poems', '/lyrics', '/stories', '/essays', '/all', '/music-composition'];
  if (isYouTubeVideosConfigured()) {
    sectionPaths.push('/videos');
  }
  const infoPaths = ['/about', '/contact'];

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
  }));

  const infoRoutes: MetadataRoute.Sitemap = infoPaths.map((p) => ({
    url: `${SITE_URL}${p}`,
    lastModified,
    changeFrequency: 'monthly',
    priority: 0.5,
  }));

  return [...sectionRoutes, ...infoRoutes, ...contentRoutes];
}
