/**
 * YouTube channel feed.
 *
 * Primary source is YouTube's public Atom RSS feed — free, no API key, no quota.
 * But RSS caps at ~15 items, so once the channel outgrows that it can't be the
 * whole catalogue. When RSS comes back full (≥ RSS_FEED_CAP — so there may be
 * more) or fails, we escalate to the YouTube Data API uploads playlist, which is
 * paginated (no cap) and more reliable. That keeps the common small-channel case
 * quota-free while staying complete as the catalogue grows.
 *
 * Feed: https://www.youtube.com/feeds/videos.xml?channel_id=UC...
 */

import { ensureThumbnailsMirrored } from '@/lib/video-thumbnails';
import { mediaUrl } from '@/lib/aws-config';
import { toDescription, SITE_NAME, SITE_URL } from '@/lib/seo';

/**
 * Full YouTube descriptions run up to ~1.6k chars; with 24 videos they bloat
 * both the VideoObject JSON-LD and (worse) the RSC hydration payload passed to
 * the client gallery — which only renders a 2-line excerpt. Bound them before
 * they cross either boundary. ~200 chars is ample for the JSON-LD (Google
 * truncates) and the on-card excerpt.
 */
const VIDEO_DESCRIPTION_MAX = 200;

export interface ChannelVideo {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnail: string;
  watchUrl: string;
  /** ISO-8601 duration (e.g. "PT3M5S"), attached best-effort from the Data API. */
  duration?: string;
  /**
   * Lifetime view count, attached best-effort alongside `duration` from the
   * SAME videos.list call — that endpoint costs 1 quota unit per request
   * regardless of how many `part`s are asked for, so this is free. Feeds
   * `interactionStatistic` in the JSON-LD, which is the field Google weighs
   * most for video rich results.
   */
  viewCount?: number;
}

const FEED_REVALIDATE_SECONDS = 300; // 5 minutes — keep channel deletions visible quickly

// YouTube's channel RSS feed returns at most ~15 entries. If we get a page that
// full, treat it as possibly-truncated and reach for the Data API instead.
const RSS_FEED_CAP = 15;
// Safety bound on Data API pagination (50 items/page → up to 250 videos).
const MAX_DATA_API_PAGES = 5;

/**
 * Self-hosted (S3) thumbnail URL for a video — NOT YouTube's CDN. Mirrored by
 * ensureThumbnailsMirrored() so it doesn't depend on i.ytimg.com at view time
 * (some networks/regions block it). Pure string builder (no AWS SDK) so the
 * feed parsers stay light.
 */
export function s3ThumbnailUrl(videoId: string): string {
  return mediaUrl(`images/video-thumbs/${videoId}.jpg`);
}

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
      thumbnail: s3ThumbnailUrl(id),
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

/** Uploads playlist id for a channel: `UC…` → `UU…`. */
function uploadsPlaylistId(channelId: string): string {
  return channelId.startsWith('UC') ? `UU${channelId.slice(2)}` : channelId;
}

/**
 * Parse a YouTube Data API `playlistItems.list` response into video entries
 * (pure — testable). Skips items without a valid 11-char video id.
 */
export function parseDataApiItems(json: unknown, limit = 12): ChannelVideo[] {
  const items = (json as { items?: unknown[] })?.items;
  if (!Array.isArray(items)) return [];
  const videos: ChannelVideo[] = [];
  for (const raw of items) {
    const sn = (raw as { snippet?: Record<string, unknown> })?.snippet ?? {};
    const id = (sn.resourceId as { videoId?: string })?.videoId;
    if (typeof id !== 'string' || !/^[\w-]{11}$/.test(id)) continue;
    videos.push({
      id,
      title: decodeEntities(String(sn.title ?? '').trim()),
      description: decodeEntities(String(sn.description ?? '').trim()),
      publishedAt: String(sn.publishedAt ?? ''),
      thumbnail: s3ThumbnailUrl(id),
      watchUrl: `https://www.youtube.com/watch?v=${id}`,
    });
    if (videos.length >= limit) break;
  }
  return videos;
}

/** Primary source: the public RSS feed (free, no quota). [] on any failure. */
async function fetchViaRss(channelId: string): Promise<ChannelVideo[]> {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; tamilagaval/1.0)' },
    });
    if (!res.ok) return [];
    return parseChannelFeed(await res.text(), 50);
  } catch {
    return [];
  }
}

/**
 * Complete source: YouTube Data API `playlistItems.list` on the uploads
 * playlist. Pages through the playlist (50/page, 1 quota unit each) following
 * `nextPageToken` until it has at least `want` videos or runs out — so it isn't
 * subject to the RSS ~15-item cap. Used when RSS looks truncated or flakes.
 * Needs YOUTUBE_API_KEY at runtime (inlined via next.config.ts). [] without a
 * key or on any failure.
 */
async function fetchViaDataApi(channelId: string, want: number): Promise<ChannelVideo[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];
  const playlistId = uploadsPlaylistId(channelId);
  const out: ChannelVideo[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_DATA_API_PAGES; page++) {
    const url =
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50` +
      `&playlistId=${encodeURIComponent(playlistId)}&key=${encodeURIComponent(key)}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    let json: unknown;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) break;
      json = await res.json();
    } catch {
      break;
    }
    out.push(...parseDataApiItems(json, 50));
    pageToken = (json as { nextPageToken?: string })?.nextPageToken;
    if (!pageToken || out.length >= want) break;
  }
  return out;
}

/**
 * Attach ISO-8601 durations to videos (best-effort) via the Data API
 * `videos.list` (one batched call, 1 quota unit). Improves the VideoObject
 * JSON-LD (Google shows duration in video rich results). No-op without a key
 * or on any failure. Mutates `videos` in place.
 */
async function attachVideoDetails(videos: ChannelVideo[]): Promise<void> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key || videos.length === 0) return;
  try {
    const byId = new Map<string, { duration?: string; viewCount?: number }>();
    // videos.list accepts ≤50 ids per call — chunk so we enrich the WHOLE feed,
    // not just the first 50. partitionShorts keys off duration, and an item with
    // unknown duration defaults to long-form, so an un-enriched Short past the
    // 50th item would be mis-placed into the video grid at higher fetch limits.
    //
    // `statistics` rides along with `contentDetails` deliberately: videos.list
    // is 1 quota unit PER REQUEST, not per part, so view counts cost nothing
    // extra. (Contrast captions.list at 50 units — see the quota notes.)
    for (let i = 0; i < videos.length; i += 50) {
      const ids = videos.slice(i, i + 50).map((v) => v.id).join(',');
      const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics&id=${encodeURIComponent(ids)}&key=${encodeURIComponent(key)}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const json = (await res.json()) as {
        items?: {
          id?: string;
          contentDetails?: { duration?: string };
          // The Data API returns statistics as decimal STRINGS, and omits
          // viewCount entirely when a channel hides its counts.
          statistics?: { viewCount?: string };
        }[];
      };
      for (const it of json.items ?? []) {
        if (!it?.id) continue;
        const duration = typeof it.contentDetails?.duration === 'string' ? it.contentDetails.duration : undefined;
        const parsed = Number(it.statistics?.viewCount);
        const viewCount = Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
        byId.set(it.id, { duration, viewCount });
      }
    }
    for (const v of videos) {
      const found = byId.get(v.id);
      if (found?.duration) v.duration = found.duration;
      if (found?.viewCount !== undefined) v.viewCount = found.viewCount;
    }
  } catch {
    /* best-effort — JSON-LD simply omits duration / interactionStatistic */
  }
}

// Test-only export (mirrors _resetFeedCache) so the chunking of the enrichment
// call can be unit-tested without driving the whole RSS/API pipeline.
export { attachVideoDetails as _attachVideoDetails };

/**
 * Fetch the channel's latest videos, resilient to YouTube's flaky RSS feed:
 * RSS first → Data API fallback → last-good in-process cache. Returns [] only
 * when every source fails and nothing was ever cached / no channel configured,
 * so callers always render safely.
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

  // 1) RSS (free). 2) Escalate to the paginated Data API when RSS either failed
  //    (0) or came back full (≥ cap → likely truncated), so the catalogue isn't
  //    silently capped at ~15 as it grows. Keep whichever list is more complete.
  let videos = await fetchViaRss(channelId);
  if ((videos.length === 0 || videos.length >= RSS_FEED_CAP) && process.env.YOUTUBE_API_KEY) {
    const viaApi = await fetchViaDataApi(channelId, limit);
    if (viaApi.length > videos.length) videos = viaApi;
  }

  if (videos.length > 0) {
    // In parallel (and best-effort): mirror new thumbnails to S3 so the
    // self-hosted URLs exist at render, and attach duration + view count for the JSON-LD.
    // The in-process caches keep both near-free on warm instances.
    await Promise.all([ensureThumbnailsMirrored(videos.map((v) => v.id)), attachVideoDetails(videos)]);
    feedCache.set(channelId, { at: now, videos });
    return videos.slice(0, limit);
  }
  // Both sources failed — serve the last good result rather than blanking.
  return cached ? cached.videos.slice(0, limit) : [];
}

/**
 * The single thumbnail URL advertised in structured data.
 *
 * Was an array of four resolutions (mq/hq/sd/maxres). Google only needs one,
 * and at 90 videos the extra three cost ~14k characters — 27% of the /videos
 * JSON-LD block — for no ranking benefit. `maxresdefault` is the variant
 * Google prefers for video rich results.
 *
 * CAVEAT: YouTube only generates `maxresdefault` above a source-resolution
 * threshold, so it can 404 on older or low-res uploads and structured data
 * would then advertise a dead URL. Verified 2026-08-01: all 90 videos on the
 * channel have it. Re-check when older material is uploaded — `hqdefault` is
 * the always-present fallback.
 */
export function primaryThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
}

/**
 * Bound each video's `description` before the array is passed to a client
 * component (VideoGallery / ShortsRow). Those components only render a 2-line
 * excerpt, but the FULL description otherwise gets serialized into the RSC
 * hydration payload — the dominant cost of the /videos page weight. Pure.
 */
export function withTruncatedDescriptions(
  videos: ChannelVideo[],
  max = VIDEO_DESCRIPTION_MAX
): ChannelVideo[] {
  return videos.map((v) => ({ ...v, description: toDescription(v.description, max) }));
}

/**
 * Schema.org ItemList of VideoObjects for the videos page — makes the videos
 * eligible for Google video rich results (more discovery → more subscribers).
 */
export function videosItemListJsonLd(videos: ChannelVideo[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    numberOfItems: videos.length,
    itemListElement: videos.map((video, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'VideoObject',
        name: video.title,
        description: toDescription(video.description || video.title, VIDEO_DESCRIPTION_MAX),
        thumbnailUrl: primaryThumbnailUrl(video.id),
        uploadDate: video.publishedAt,
        contentUrl: video.watchUrl,
        embedUrl: `https://www.youtube.com/embed/${video.id}`,
        // The catalogue is Tamil songs/poems — declaring the language helps
        // Google surface these for Tamil-language and diaspora-region queries.
        inLanguage: 'ta',
        ...(video.duration ? { duration: video.duration } : {}),
        // Matches the Organization shape already used on /content pages.
        // 90 identical copies look wasteful but compress to almost nothing —
        // repeated strings are the best case for gzip.
        publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
        // The single field Google weighs most for video rich results. Omitted
        // rather than zeroed when unknown, so a failed enrichment call never
        // advertises "0 views".
        ...(video.viewCount !== undefined
          ? {
              interactionStatistic: {
                '@type': 'InteractionCounter',
                interactionType: { '@type': 'WatchAction' },
                userInteractionCount: video.viewCount,
              },
            }
          : {}),
      },
    })),
  };
}
