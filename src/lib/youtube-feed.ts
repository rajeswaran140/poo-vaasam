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
  publishedAt: string;
  thumbnail: string;
  watchUrl: string;
}

const FEED_REVALIDATE_SECONDS = 1800; // 30 minutes

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

    videos.push({
      id,
      title,
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
