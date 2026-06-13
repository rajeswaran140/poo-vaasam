/**
 * Schema.org JSON-LD for a content detail page (song / poem / story / …).
 *
 * Pure + testable (mirrors the videosItemListJsonLd style): given the content
 * fields and a few presentation values, it returns the array of LD objects the
 * page embeds — the main CreativeWork, a BreadcrumbList, and (for content backed
 * by a YouTube video) a VideoObject.
 */

import { SITE_URL, SITE_NAME, crawlerAuthor } from '@/lib/seo';
import { ContentType } from '@/types/content';

/**
 * Schema.org @type per content kind — sharper than always-CreativeWork.
 * A SONG is a listenable *recording* → MusicRecording (carries byArtist + audio);
 * LYRICS are the written *composition* → MusicComposition. (They intentionally
 * differ: the same work can be both, modelled on different pages.)
 */
const SCHEMA_TYPE: Record<string, string | string[]> = {
  SONGS: 'MusicRecording',
  POEMS: ['CreativeWork', 'Poem'],
  LYRICS: ['CreativeWork', 'MusicComposition'],
  STORIES: ['CreativeWork', 'ShortStory'],
  ESSAYS: 'Article',
};

export interface ContentJsonLdInput {
  type: string;
  title: string;
  author?: string | null;
  publishedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  description?: string | null;
  audioUrl?: string | null;
}

export interface ContentJsonLdOptions {
  /** Absolute canonical URL of the page. */
  canonicalUrl: string;
  /** Absolute share/structured-data image, if any. */
  image?: string | null;
  /** ISO-8601 audio duration (e.g. "PT5M36S"), if known. */
  audioDurationIso?: string;
  /** Breadcrumb parent (the browse/section destination): its label + absolute URL. */
  parent: { name: string; url: string };
  /** YouTube video id when the content has a linked video (adds a VideoObject). */
  youtubeId?: string | null;
  /** Pre-truncated plain-text description for the VideoObject. */
  videoDescription?: string;
}

export function contentJsonLd(
  content: ContentJsonLdInput,
  opts: ContentJsonLdOptions
): Record<string, unknown>[] {
  // Crawler-facing → romanised (the visible UI keeps the stored Tamil name).
  const authorName = crawlerAuthor(content.author);
  const isSong = content.type === ContentType.SONGS;
  const published = content.publishedAt || content.createdAt;

  const main: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': SCHEMA_TYPE[content.type] || 'CreativeWork',
    name: content.title,
    headline: content.title,
    inLanguage: 'ta',
    author: { '@type': 'Person', name: authorName },
    // byArtist is the music-specific creator relation expected on a MusicRecording.
    ...(isSong ? { byArtist: { '@type': 'Person', name: authorName } } : {}),
    datePublished: published,
    dateModified: content.updatedAt || content.createdAt,
    url: opts.canonicalUrl,
    ...(opts.image ? { image: opts.image } : {}),
    ...(content.description ? { description: content.description } : {}),
    // Make a song's audio + length machine-readable (rich-result signals).
    ...(content.audioUrl
      ? {
          audio: {
            '@type': 'AudioObject',
            contentUrl: content.audioUrl,
            ...(opts.audioDurationIso ? { duration: opts.audioDurationIso } : {}),
          },
        }
      : {}),
    ...(opts.audioDurationIso ? { duration: opts.audioDurationIso } : {}),
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
  };

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'முகப்பு', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: opts.parent.name, item: opts.parent.url },
      { '@type': 'ListItem', position: 3, name: content.title, item: opts.canonicalUrl },
    ],
  };

  const out: Record<string, unknown>[] = [main, breadcrumb];

  if (opts.youtubeId) {
    out.push({
      '@context': 'https://schema.org',
      '@type': 'VideoObject',
      name: content.title,
      description: opts.videoDescription || content.title,
      thumbnailUrl: [`https://i.ytimg.com/vi/${opts.youtubeId}/hqdefault.jpg`],
      uploadDate: published,
      embedUrl: `https://www.youtube.com/embed/${opts.youtubeId}`,
      contentUrl: `https://www.youtube.com/watch?v=${opts.youtubeId}`,
    });
  }

  return out;
}
