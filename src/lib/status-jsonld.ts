/**
 * Structured-data + sitemap builders for /status (the WhatsApp Status clip
 * gallery). The page is a CollectionPage whose items are schema.org VideoObjects
 * (one per short) so search engines index the clips as video; the same joined
 * data also yields Google video-sitemap entries (content_loc = the self-hosted
 * mp4). Pure + testable, mirroring src/lib/collection-jsonld.ts.
 *
 * `joinStatusClips` is the single source of truth for the clip⋈song join, shared
 * by the /status page (render) and the sitemap (discovery) so they never drift.
 */

import type { MetadataRoute } from 'next';
import { SITE_NAME, SITE_URL, absoluteUrl } from '@/lib/seo';
import { STATUS_CLIPS, posterForClip } from '@/config/status-clips';
import { contentPath } from '@/config/vanity-paths';

/** The data a single Status clip contributes to JSON-LD + the sitemap. */
export interface StatusVideoItem {
  songId: string;
  title: string;
  /** Root-relative song path (the VideoObject landing url). */
  path: string;
  /** Root-relative clip file under /clips (becomes the absolute contentUrl). */
  clip: string;
  /** ISO-8601 publish date of the underlying song (VideoObject.uploadDate). */
  uploadDate?: string;
}

/** Minimal song shape the join needs (works with PublicSong + its DTO). */
interface SongLike {
  id: string;
  title: string;
  publishedAt?: string;
}

/**
 * Join the curated clip list to the live catalogue: keep only clips whose song
 * is published (present in `songs`), in STATUS_CLIPS order. Drops the rest.
 */
export function joinStatusClips(songs: SongLike[]): StatusVideoItem[] {
  const byId = new Map(songs.map((s) => [s.id, s]));
  return STATUS_CLIPS.flatMap(({ songId, clip }) => {
    const song = byId.get(songId);
    if (!song) return [];
    return [{ songId, title: song.title, path: contentPath(song.id), clip, uploadDate: song.publishedAt }];
  });
}

/** One schema.org VideoObject for a Status clip. */
function videoObject(item: StatusVideoItem): Record<string, unknown> {
  return {
    '@type': 'VideoObject',
    name: item.title,
    description: `${item.title} — தமிழகவல் குறும்படம் (WhatsApp Status clip).`,
    thumbnailUrl: absoluteUrl(posterForClip(item.clip)),
    contentUrl: absoluteUrl(item.clip),
    // Where a viewer lands to hear the full song.
    url: absoluteUrl(item.path),
    ...(item.uploadDate ? { uploadDate: item.uploadDate } : {}),
    inLanguage: 'ta',
    isFamilyFriendly: true,
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
  };
}

/** CollectionPage JSON-LD whose mainEntity is an ItemList of VideoObjects. */
export function statusCollectionJsonLd(
  items: StatusVideoItem[],
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
        item: videoObject(item),
      })),
    },
  };
}

type VideoEntry = NonNullable<MetadataRoute.Sitemap[number]['videos']>[number];

/**
 * Google video-sitemap entries for the Status clips (self-hosted mp4 via
 * `content_loc`). Title/description are returned raw — the sitemap route
 * XML-escapes them (it owns the one escape implementation).
 */
export function statusSitemapVideos(items: StatusVideoItem[]): VideoEntry[] {
  return items.map((item) => ({
    title: item.title,
    thumbnail_loc: absoluteUrl(posterForClip(item.clip)),
    description: `${item.title} — Tamilagaval WhatsApp Status clip`,
    content_loc: absoluteUrl(item.clip),
    ...(item.uploadDate ? { publication_date: item.uploadDate } : {}),
  }));
}
