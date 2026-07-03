import { isAudioPlaybackEnabled } from '@/config/features';

/**
 * While on-site playback is OFF (the site funnels listeners to YouTube), a song
 * WITHOUT a linked YouTube video can't be watched anywhere from the site — so
 * hide it from the public listings and the /api/songs contract. When playback is
 * turned back on, every song shows again. One rule, both surfaces, no drift.
 */
export function listableSongs<T extends { youtubeVideoId?: string | null }>(songs: T[]): T[] {
  if (isAudioPlaybackEnabled()) return songs;
  return songs.filter((s) => !!s.youtubeVideoId);
}
