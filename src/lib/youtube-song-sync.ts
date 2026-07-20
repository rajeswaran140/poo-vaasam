/**
 * Pure helpers for the "Sync songs from YouTube" admin action.
 *
 * The sync READS the channel and creates on-site song pages for uploads that
 * don't have one yet. It is strictly read-only on YouTube (never posts/edits the
 * channel) and creates NO S3 objects — a synced page points `featuredImage`
 * straight at YouTube's thumbnail CDN (i.ytimg.com).
 */
import type { ChannelVideo } from '@/lib/youtube-feed';
import { partitionShorts } from '@/lib/youtube-shorts';

/**
 * Neutral, lyrics-free page body — identical to the Publish Song flow's stub, so
 * synced pages read the same as hand-published ones and never expose lyrics.
 */
export function songStubBody(title: string): string {
  return `${title} — ஒலி வடிவப் பாடல். முழு வீடியோ YouTube-ல்.`;
}

/**
 * Direct YouTube thumbnail URLs (no S3), best → always-safe fallback.
 * `maxresdefault` is high-res but can 404 for some videos; `hqdefault` always
 * exists. The endpoint HEAD-checks maxres and falls back to hq.
 */
export function ytThumbnailCandidates(videoId: string): [maxres: string, hq: string] {
  return [
    `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  ];
}

export interface MissingSong {
  /** 11-char YouTube video id. */
  id: string;
  title: string;
  watchUrl: string;
}

/**
 * Long-form channel songs that don't yet have an on-site page. Pure:
 *  - excludes Shorts (by duration, via partitionShorts),
 *  - excludes any video already covered by an existing record,
 *  - drops items with no id.
 */
export function missingSongVideos(
  channelVideos: ChannelVideo[],
  existingVideoIds: Iterable<string>
): MissingSong[] {
  const have = new Set(existingVideoIds);
  const { videos } = partitionShorts(channelVideos); // long-form only
  return videos
    .filter((v) => v.id && !have.has(v.id))
    .map((v) => ({ id: v.id, title: v.title, watchUrl: v.watchUrl }));
}
