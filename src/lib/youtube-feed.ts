/**
 * YouTube channel feed (RSS).
 *
 * Fetches a channel's latest uploads from YouTube's public Atom RSS feed —
 * no API key, no quota. The fetch is cached via Next's `revalidate`, so the
 * site stays fresh without hammering YouTube.
 *
 * Feed: https://www.youtube.com/feeds/videos.xml?channel_id=UC...
 */

export interface ChannelVideo {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnail: string;
  watchUrl: string;
}

const FEED_REVALIDATE_SECONDS = 300; // 5 minutes — keep channel deletions visible quickly

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

/**
 * Parse a YouTube Atom feed XML string into video entries (pure — testable).
 */
export function parseChannelFeed(xml: string, limit = 12): ChannelVideo[] {
  // Each video is an <entry>…</entry>; the segment before the first entry is
  // the channel header, so drop it.
  const entries = xml.split('<entry>').slice(1);
  const videos: ChannelVideo[] = [];

  for (const entry of entries) {
    const id = entry.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/)?.[1];
    if (!id) continue;

    const title = decodeEntities(
      entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? ''
    );
    const publishedAt = entry.match(/<published>([^<]+)<\/published>/)?.[1] ?? '';
    const description = decodeEntities(
      entry.match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1]?.trim() ?? ''
    );

    videos.push({
      id,
      title,
      description,
      publishedAt,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      watchUrl: `https://www.youtube.com/watch?v=${id}`,
    });

    if (videos.length >= limit) break;
  }

  return videos;
}

// In-process feed cache, keyed by channel ID. We deliberately do NOT use Next's
// `fetch` data cache (`next: { revalidate }`) here: it shares the same
// incremental cache that Amplify's SSR compute does not persist across Lambda
// instances, so time-based revalidation never fires and the feed freezes at the
// last build (a new upload never appears). A simple module-level TTL cache lives
// in the warm Lambda's memory instead — fresh within FEED_REVALIDATE_SECONDS,
// cheap, and immune to the platform's incremental-cache behaviour.
interface FeedCacheEntry {
  at: number;
  videos: ChannelVideo[];
}
const feedCache = new Map<string, FeedCacheEntry>();

/** Test-only: clear the in-process feed cache so cases don't bleed into each other. */
export function _resetFeedCache(): void {
  feedCache.clear();
}

/**
 * Fetch the channel's latest videos from the RSS feed (in-process TTL cache).
 * Returns the last good result on a transient failure, [] when nothing has ever
 * been fetched or no channel ID is configured — so callers always render safely.
 */
export async function fetchChannelVideos(
  channelId: string,
  limit = 12
): Promise<ChannelVideo[]> {
  if (!channelId) return [];

  const now = Date.now();
  const cached = feedCache.get(channelId);
  if (cached && now - cached.at < FEED_REVALIDATE_SECONDS * 1000) {
    return cached.videos.slice(0, limit);
  }

  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;

  try {
    const res = await fetch(url, {
      cache: 'no-store', // always hit YouTube; freshness is governed by feedCache above
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; tamilagaval/1.0)' },
    });
    if (!res.ok) return cached ? cached.videos.slice(0, limit) : [];
    // Parse the whole feed (YouTube returns ~15 entries) and cache it; slice per caller.
    const videos = parseChannelFeed(await res.text(), 50);
    feedCache.set(channelId, { at: now, videos });
    return videos.slice(0, limit);
  } catch {
    return cached ? cached.videos.slice(0, limit) : [];
  }
}

/** Multi-resolution thumbnail URLs for a YouTube video — Google prefers an
 *  array of sizes for richer video snippets. */
export function thumbnailVariants(videoId: string): string[] {
  return [
    `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
  ];
}

/**
 * Schema.org ItemList of VideoObjects for the videos page — makes the videos
 * eligible for Google video rich results (more discovery → more subscribers).
 */
export function videosItemListJsonLd(videos: ChannelVideo[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: videos.map((video, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'VideoObject',
        name: video.title,
        description: video.description || video.title,
        thumbnailUrl: thumbnailVariants(video.id),
        uploadDate: video.publishedAt,
        contentUrl: video.watchUrl,
        embedUrl: `https://www.youtube.com/embed/${video.id}`,
      },
    })),
  };
}
