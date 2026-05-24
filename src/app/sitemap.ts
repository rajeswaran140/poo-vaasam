import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentStatus } from '@/types/content';

// Regenerate hourly rather than per-request.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPaths = ['', '/songs', '/poems', '/lyrics', '/stories', '/essays', '/all', '/about', '/contact', '/ai-search'];
  const staticRoutes: MetadataRoute.Sitemap = staticPaths.map((p) => ({
    url: `${SITE_URL}${p}`,
    lastModified: new Date(),
    changeFrequency: 'weekly',
    priority: p === '' ? 1 : 0.7,
  }));

  let contentRoutes: MetadataRoute.Sitemap = [];
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
      return {
        url: `${SITE_URL}/content/${c.id}`,
        lastModified: c.updatedAt ? new Date(String(c.updatedAt)) : new Date(),
        changeFrequency: 'monthly',
        priority: 0.8,
      };
    });
  } catch (error) {
    console.error('[sitemap] failed to load content, returning static routes only:', error);
  }

  return [...staticRoutes, ...contentRoutes];
}
