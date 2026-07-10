/**
 * Related-song selection — powers the "இதே போன்ற பாடல்கள்" section on a song's
 * /content page. Same-theme songs first (most recent), then filled with other
 * recent songs, excluding the current song.
 *
 * Keeps visitors exploring the catalogue on-site (the acquisition loop) and adds
 * song→song internal links (SEO). Pure — the caller injects the id→href mapper
 * so this module has no Next/config dependency and is trivially testable.
 */

export interface RelatedSongInput {
  id: string;
  title: string;
  artist?: string;
  /** Resolved browse theme (love | mother | nature | tamil | homeland). */
  theme: string;
  coverUrl?: string;
  /** ISO-8601 — used only to order "most recent first". */
  publishedAt?: string;
}

export interface RelatedSongItem {
  title: string;
  artist?: string;
  href: string;
  coverUrl?: string;
}

export function pickRelatedSongs(
  currentId: string,
  currentTheme: string,
  all: RelatedSongInput[],
  toHref: (id: string) => string,
  limit = 6,
): RelatedSongItem[] {
  const others = all.filter((s) => s.id !== currentId);
  const byRecent = (a: RelatedSongInput, b: RelatedSongInput) =>
    (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '');
  const sameTheme = others.filter((s) => s.theme === currentTheme).sort(byRecent);
  const rest = others.filter((s) => s.theme !== currentTheme).sort(byRecent);
  return [...sameTheme, ...rest]
    .slice(0, Math.max(0, limit))
    .map((s) => ({ title: s.title, artist: s.artist, href: toHref(s.id), coverUrl: s.coverUrl }));
}
