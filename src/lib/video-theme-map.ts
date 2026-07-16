/**
 * Best-effort videoId → theme map from the catalogue (Content), shared by the
 * outlier and resonance routes so the by-theme rollups group by a real theme.
 * Never throws — a DB hiccup yields an empty map (rollup falls back to
 * "(untagged)"). Theme resolution = DB override → curated map → "love" default.
 */

import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentType } from '@/types/content';
import { themeForSongWithOverride } from '@/config/song-themes';
import { indexThemesByVideo } from '@/lib/youtube-outliers';

const MAX_SONGS = 500;

export async function loadVideoThemeMap(): Promise<Map<string, string>> {
  try {
    const repo = new ContentRepository();
    const { items } = await repo.findByType(ContentType.SONGS, { limit: MAX_SONGS });
    return indexThemesByVideo(
      items.map((c) => ({
        youtubeVideoId: c.youtubeVideoId,
        theme: themeForSongWithOverride(c.id, c.theme),
      }))
    );
  } catch {
    return new Map();
  }
}
