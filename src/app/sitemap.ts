import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentStatus } from '@/types/content';
import { SITE, liveContentSections, isYouTubeVideosConfigured } from '@/config/site';
import { contentPath } from '@/config/vanity-paths';
import { fetchChannelVideos } from '@/lib/youtube-feed';
import { isoDurationToSeconds } from '@/lib/iso-duration';
import { SongCatalog } from '@/application/use-cases/SongCatalog';
import { eligibleCollectionThemes } from '@/config/song-collections';
import { joinStatusClips, statusSitemapVideos } from '@/lib/status-jsonld';

// Regenerate hourly rather than per-request.
export const revalidate = 3600;

// Google's video sitemap caps <video:duration> at 8 hours, expressed in seconds.
const MAX_VIDEO_DURATION_SECONDS = 28800;

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

  // Section/landing pages: home, the live content sections (empty ones are
  // excluded via the shared registry), the aggregate, and the service page.
  const sectionPaths = ['', ...liveContentSections().map((s) => s.href), '/all', '/music-composition', '/status'];
  if (videosEnabled) {
    sectionPaths.push('/videos');
  }
  const infoPaths = ['/about', '/contact', '/privacy', '/terms'];

  // YouTube videos attached to the /videos page so they're eligible for video
  // search. fetchChannelVideos returns [] on any error, so this never breaks
  // the sitemap.
  let videoEntries: VideoEntry[] = [];
  if (videosEnabled) {
    const videos = await fetchChannelVideos(SITE.youtube.channelId, 50);
    videoEntries = videos.map((v) => {
      // Durations are attached best-effort; only emit <video:duration> when we
      // have a sane, in-range value (Google rejects 0 / > 8h).
      const durationSeconds = v.duration ? isoDurationToSeconds(v.duration) : 0;
      return {
        title: xmlEscape(v.title),
        thumbnail_loc: v.thumbnail,
        // Video sitemap descriptions are capped at 2048 chars; trim then escape.
        description: xmlEscape((v.description || v.title).slice(0, 1900)),
        player_loc: `https://www.youtube.com/embed/${v.id}`,
        ...(durationSeconds > 0 && durationSeconds <= MAX_VIDEO_DURATION_SECONDS
          ? { duration: durationSeconds }
          : {}),
        ...(v.publishedAt ? { publication_date: v.publishedAt } : {}),
      };
    });
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
        url: `${SITE_URL}${contentPath(c.id)}`,
        lastModified: updated,
        changeFrequency: 'monthly',
        priority: 0.7,
      };
    });
  } catch (error) {
    console.error('[sitemap] failed to load content, returning static routes only:', error);
  }

  const lastModified = siteLastMod.getTime() > 0 ? siteLastMod : new Date();

  // Published songs, loaded once and reused for the /status video entries and the
  // /songs/[theme] collection routes. [] on any error so the sitemap never breaks.
  let publishedSongs: Awaited<ReturnType<SongCatalog['listPublished']>> = [];
  try {
    publishedSongs = await new SongCatalog(new ContentRepository()).listPublished(100);
  } catch (error) {
    console.error('[sitemap] failed to load songs:', error);
  }

  // Self-hosted Status clips as video-sitemap entries (content_loc = the mp4),
  // so the shorts are eligible for video search. Title/description XML-escaped.
  const statusVideoEntries: VideoEntry[] = statusSitemapVideos(joinStatusClips(publishedSongs)).map((v) => ({
    ...v,
    title: xmlEscape(v.title),
    description: xmlEscape(v.description),
  }));

  // Primary content destinations (songs/poems/videos) outrank /all and
  // /music-composition so crawl budget skews toward the pages we want indexed.
  const PRIORITY_BY_PATH: Record<string, number> = {
    '': 1,
    '/songs': 0.9,
    '/poems': 0.9,
    '/videos': 0.9,
  };
  const sectionRoutes: MetadataRoute.Sitemap = sectionPaths.map((p) => ({
    url: `${SITE_URL}${p}`,
    lastModified,
    changeFrequency: 'weekly',
    priority: PRIORITY_BY_PATH[p] ?? 0.7,
    ...(p === '/videos' && videoEntries.length > 0 ? { videos: videoEntries } : {}),
    ...(p === '/status' && statusVideoEntries.length > 0 ? { videos: statusVideoEntries } : {}),
  }));

  const infoRoutes: MetadataRoute.Sitemap = infoPaths.map((p) => ({
    url: `${SITE_URL}${p}`,
    lastModified,
    changeFrequency: 'monthly',
    priority: 0.5,
  }));

  // Theme collection pages (/songs/[theme]) — only themes with enough songs to
  // have a generated page, kept in sync with the page's generateStaticParams by
  // using the same SongCatalog source.
  const collectionRoutes: MetadataRoute.Sitemap = eligibleCollectionThemes(
    publishedSongs.map((s) => s.theme)
  ).map((theme) => ({
    url: `${SITE_URL}/songs/${theme}`,
    lastModified,
    changeFrequency: 'weekly',
    priority: 0.8,
  }));

  return [...sectionRoutes, ...collectionRoutes, ...infoRoutes, ...contentRoutes];
}
