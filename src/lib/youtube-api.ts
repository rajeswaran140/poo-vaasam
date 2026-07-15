/**
 * YouTube Data API v3 client — read-only public stats for the admin dashboard.
 *
 * Two endpoints we care about for Phase 1:
 *   - channels.list     → channel snapshot (subs, total views, video count)
 *   - playlistItems +   → newest N videos in the channel's uploads playlist
 *     videos.list         → per-video statistics (views/likes/comments/duration)
 *
 * Cached via Next's fetch cache so the API key's 10k-units/day quota goes a
 * long way (one stats refresh per hour ≈ ~24 channel calls + ~24 video-stats
 * calls per day → well under 100 units).
 *
 * Requires YOUTUBE_API_KEY (NOT NEXT_PUBLIC_ — server-only). When unset every
 * helper returns null so the admin dashboard can degrade to "API key not
 * configured" instead of breaking.
 */

import { fetchWithRetry } from '@/lib/fetch-retry';

export interface ChannelStats {
  channelId: string;
  title: string;
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
  uploadsPlaylistId: string;
}

export interface VideoStats {
  id: string;
  title: string;
  publishedAt: string;       // ISO 8601
  thumbnail: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  /** Raw ISO-8601 duration (e.g. "PT3M15S"); pretty-formatted via formatDuration. */
  duration: string;
  /** Seconds, parsed from duration. */
  durationSeconds: number;
}

/** Parse the YouTube ISO-8601 duration (PT#H#M#S) into total seconds. */
export function parseIsoDurationSeconds(iso: string): number {
  if (!iso) return 0;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  const [, h, mn, s] = m;
  return (Number(h) || 0) * 3600 + (Number(mn) || 0) * 60 + (Number(s) || 0);
}

/** Format seconds as H:MM:SS (drops the hour when zero). */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0:00';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** True when an API key is configured — gate the admin UI on this. */
export function isYouTubeApiConfigured(): boolean {
  return Boolean(process.env.YOUTUBE_API_KEY);
}

/**
 * A YouTube video ID is exactly 11 URL-safe base64 chars. Validate before
 * interpolating a caller-supplied id into an Analytics `filters=video==<id>`
 * clause (that grammar is `;`-delimited, so an unvalidated id could smuggle an
 * extra filter). Also a cheap guard against malformed lookups.
 */
export function isValidYouTubeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(id);
}

async function ytFetch<T>(url: string): Promise<T | null> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return null;
  const sep = url.includes('?') ? '&' : '?';
  try {
    // Always fetch LIVE. We previously used Next's fetch data cache
    // (`next: { revalidate }`), but Amplify's SSR compute doesn't reliably
    // revalidate/persist that cache across Lambda instances, so the admin
    // dashboard's channel stats (subscribers / views / per-video counts)
    // froze at the first fetch and never updated. These are admin-only,
    // low-frequency reads, so `no-store` is cheap and keeps the numbers current.
    const res = await fetchWithRetry(`${url}${sep}key=${key}`, {
      cache: 'no-store',
    } as RequestInit);
    if (!res.ok) {
      console.error(`[youtube-api] ${res.status} ${url}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error('[youtube-api] fetch failed:', err);
    return null;
  }
}

interface ChannelsResponse {
  items?: Array<{
    id: string;
    snippet?: { title?: string };
    statistics?: { subscriberCount?: string; viewCount?: string; videoCount?: string };
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
  }>;
}

export async function fetchChannelStats(channelId: string): Promise<ChannelStats | null> {
  if (!channelId) return null;
  const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&id=${encodeURIComponent(channelId)}`;
  const data = await ytFetch<ChannelsResponse>(url);
  const item = data?.items?.[0];
  if (!item) return null;
  return {
    channelId: item.id,
    title: item.snippet?.title ?? '',
    subscriberCount: Number(item.statistics?.subscriberCount ?? 0),
    viewCount: Number(item.statistics?.viewCount ?? 0),
    videoCount: Number(item.statistics?.videoCount ?? 0),
    uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads ?? '',
  };
}

interface PlaylistItemsResponse {
  items?: Array<{
    contentDetails?: { videoId?: string };
  }>;
  nextPageToken?: string;
}

interface VideosResponse {
  items?: Array<{
    id: string;
    snippet?: { title?: string; publishedAt?: string; thumbnails?: { medium?: { url?: string }; default?: { url?: string } } };
    statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
    contentDetails?: { duration?: string };
  }>;
}

/**
 * Fetch up to `limit` of the channel's most-recent uploads, with full
 * statistics. Pages through the uploads playlist (50 IDs/page) until it has
 * `limit` IDs or the playlist is exhausted, then hydrates statistics in
 * batches of 50 (the videos.list id cap) — so the dashboard doesn't silently
 * drop videos once the channel passes 50 uploads.
 *
 * Pass `opts.channel` to reuse an already-fetched ChannelStats and avoid a
 * duplicate channels.list call (the page fetches the channel once).
 */
export async function fetchChannelVideoStats(
  channelId: string,
  limit = 50,
  opts: { channel?: ChannelStats } = {}
): Promise<VideoStats[]> {
  const channel = opts.channel ?? (await fetchChannelStats(channelId));
  if (!channel?.uploadsPlaylistId) return [];

  const wanted = Math.max(1, Math.min(limit, 500)); // hard cap: quota safety
  const uploads = encodeURIComponent(channel.uploadsPlaylistId);

  // 1) Page playlistItems for video IDs until we have `wanted` or run out.
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const pageSize = Math.min(50, wanted - ids.length);
    const tokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const playlistUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=${pageSize}&playlistId=${uploads}${tokenParam}`;
    const playlist = await ytFetch<PlaylistItemsResponse>(playlistUrl);
    if (!playlist) break; // a failed page shouldn't drop the IDs already gathered
    for (const i of playlist.items ?? []) {
      const vid = i.contentDetails?.videoId;
      if (vid) ids.push(vid);
    }
    pageToken = playlist.nextPageToken;
  } while (pageToken && ids.length < wanted);

  if (ids.length === 0) return [];

  // 2) Hydrate statistics in chunks of 50 (videos.list id cap), preserving order.
  const out: VideoStats[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const videosUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${encodeURIComponent(chunk.join(','))}`;
    const videos = await ytFetch<VideosResponse>(videosUrl);
    for (const v of videos?.items ?? []) {
      const duration = v.contentDetails?.duration ?? '';
      out.push({
        id: v.id,
        title: v.snippet?.title ?? '',
        publishedAt: v.snippet?.publishedAt ?? '',
        thumbnail:
          v.snippet?.thumbnails?.medium?.url ?? v.snippet?.thumbnails?.default?.url ?? '',
        viewCount: Number(v.statistics?.viewCount ?? 0),
        likeCount: Number(v.statistics?.likeCount ?? 0),
        commentCount: Number(v.statistics?.commentCount ?? 0),
        duration,
        durationSeconds: parseIsoDurationSeconds(duration),
      });
    }
  }
  return out;
}

/** Public snippet/stats for ONE video (title, upload date, duration). */
export async function fetchVideoStatsById(videoId: string): Promise<VideoStats | null> {
  if (!isValidYouTubeId(videoId)) return null;
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${encodeURIComponent(videoId)}`;
  const data = await ytFetch<VideosResponse>(url);
  const v = data?.items?.[0];
  if (!v) return null;
  const duration = v.contentDetails?.duration ?? '';
  return {
    id: v.id,
    title: v.snippet?.title ?? '',
    publishedAt: v.snippet?.publishedAt ?? '',
    thumbnail: v.snippet?.thumbnails?.medium?.url ?? v.snippet?.thumbnails?.default?.url ?? '',
    viewCount: Number(v.statistics?.viewCount ?? 0),
    likeCount: Number(v.statistics?.likeCount ?? 0),
    commentCount: Number(v.statistics?.commentCount ?? 0),
    duration,
    durationSeconds: parseIsoDurationSeconds(duration),
  };
}
