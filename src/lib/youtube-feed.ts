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

/**
 * Fetch the channel's latest videos from the RSS feed (cached).
 * Returns [] on any failure or when no channel ID is configured, so callers
 * can render safely.
 */
export async function fetchChannelVideos(
  channelId: string,
  limit = 12
): Promise<ChannelVideo[]> {
  if (!channelId) return [];

  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;

  try {
    const res = await fetch(url, {
      next: { revalidate: FEED_REVALIDATE_SECONDS },
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; tamilagaval/1.0)' },
    });
    if (!res.ok) return [];
    return parseChannelFeed(await res.text(), limit);
  } catch {
    return [];
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
