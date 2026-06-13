/**
 * Schema.org JSON-LD for the /poems listing — a CollectionPage whose mainEntity
 * is an ItemList of the poems, so search engines see the page as a structured
 * collection that links to each poem (parity with /songs' MusicPlaylist and
 * /videos' ItemList). Pure + testable, like videosItemListJsonLd.
 */

import { SITE_URL, SITE_NAME, absoluteUrl } from '@/lib/seo';
import { contentPath } from '@/config/vanity-paths';

export interface PoemListItem {
  id: string;
  title: string;
  featuredImage?: string | null;
}

export function poemsCollectionJsonLd(
  poems: PoemListItem[],
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
      numberOfItems: poems.length,
      itemListElement: poems.map((poem, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: absoluteUrl(contentPath(poem.id)),
        name: poem.title,
        ...(poem.featuredImage ? { image: poem.featuredImage } : {}),
      })),
    },
  };
}
