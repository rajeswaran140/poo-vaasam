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
 * Clean, on-site title from a YouTube video title. Raj's uploads follow
 * "Tamil hook | Romanized | English descriptor" (bilingual packaging for the
 * algorithm) — the on-site page wants just the Tamil hook, minus emoji, so
 * synced pages read like the hand-made ones (e.g. "செவ்விழி ஓவியமே"). Falls
 * back to the raw title if cleaning would empty it.
 */
export function cleanSongTitle(rawTitle: string): string {
  const firstSegment = rawTitle.split(/[|｜]/)[0] ?? rawTitle;
  const cleaned = firstSegment
    // Strip emoji / pictographs / symbols / variation selectors (Tamil is
    // U+0B80–U+0BFF, well outside these ranges, so it's never touched).
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE00}-\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || rawTitle.trim();
}

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
    .map((v) => ({ id: v.id, title: cleanSongTitle(v.title), watchUrl: v.watchUrl }));
}
