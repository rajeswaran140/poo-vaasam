/**
 * Schema.org JSON-LD for a content listing page — a CollectionPage whose
 * mainEntity is an ItemList of the items, so search engines see the page as a
 * structured collection that links to each item. Shared by /poems and /all (and
 * any future /stories, /essays). Pure + testable, like videosItemListJsonLd.
 */

import { SITE_URL, SITE_NAME, absoluteUrl } from '@/lib/seo';
import { contentPath } from '@/config/vanity-paths';

export interface CollectionItem {
  id: string;
  title: string;
  featuredImage?: string | null;
}

export function collectionPageJsonLd(
  items: CollectionItem[],
  opts: { name: string; description: string; url: string }
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: opts.name,
    description: opts.description,
    url: opts.url,
    inLanguage: 'ta',
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE_URL },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: items.length,
      itemListElement: items.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        // Canonical URL = the item's vanity path when it has one (e.g. /thayagam).
        url: absoluteUrl(contentPath(item.id)),
        name: item.title,
        ...(item.featuredImage ? { image: item.featuredImage } : {}),
      })),
    },
  };
}
