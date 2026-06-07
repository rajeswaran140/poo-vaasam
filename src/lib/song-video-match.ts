/**
 * song-video-match — link a song to its YouTube upload by title.
 *
 * Song titles are the clean core (e.g. "செவ்விழி ஓவியமே"); the matching YouTube
 * title is usually decorated (dots, emoji, a "| subtitle"). So we normalise
 * both (preserving the Tamil Unicode block) and match on a prefix. Kept pure so
 * the (bug-prone) matching can be exhaustively tested — a wrong youtubeVideoId
 * is a visible error on /songs.
 */

/** Lowercase and strip everything except Latin alphanumerics + the Tamil block. */
export function normalizeTitle(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9஀-௿]/g, '');
}

export interface TitledVideo {
  id: string;
  title: string;
}

/**
 * Find the video that corresponds to a song by title, or null if none matches
 * confidently. Prefers an exact match, then a video whose title begins with the
 * song title (the song is the clean prefix), then the reverse; ties break toward
 * the shorter (more specific) video title.
 */
export function matchVideoByTitle<T extends TitledVideo>(songTitle: string, videos: T[]): T | null {
  const s = normalizeTitle(songTitle);
  if (s.length < 4) return null; // too short to match without false positives

  let best: { v: T; score: number; len: number } | null = null;
  for (const v of videos) {
    const t = normalizeTitle(v.title);
    let score = 0;
    if (t === s) score = 3;
    else if (t.startsWith(s)) score = 2;
    else if (t.length >= 4 && s.startsWith(t)) score = 1;
    if (score === 0) continue;

    if (!best || score > best.score || (score === best.score && t.length < best.len)) {
      best = { v, score, len: t.length };
    }
  }
  return best?.v ?? null;
}
