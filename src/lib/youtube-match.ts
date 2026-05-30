/**
 * Match YouTube videos to site content records by id-in-URL or title.
 *
 * The admin /admin/youtube page uses this to flag uploads that don't yet have
 * a /content/[id] page on the site. The site DB titles tend to be the short
 * canonical name ("அந்தி மேகமே") while YouTube titles add descriptive tails
 * ("அந்தி மேகமே. . . எங்கே சாய்கின்றாய். . .") + channel suffixes, so plain
 * equality is too strict.
 *
 * Strategy:
 *   1. videoUrl on the content contains the YouTube ID → exact match wins
 *      (this should be the primary path going forward).
 *   2. Otherwise compare normalised titles: strip dotted-ellipsis filler,
 *      common YouTube suffixes ("| TamilAgaval", "(Official Video)"), NFC
 *      Tamil unicode, lowercase, collapse whitespace; then accept a hit if
 *      either side contains the other AND the contained side is at least
 *      4 characters (avoids "a" matching everything).
 *
 * Pure helpers — no DB or network access — so the page-level matcher can
 * remain a thin wrapper and tests stay fast.
 */

/** Bits that frequently appear in YouTube titles but never in DB titles. */
const SUFFIX_STRIPPERS: RegExp[] = [
  /\|\s*tamil\s*agaval.*$/i,
  /\|\s*tamilagaval.*$/i,
  // Any parenthesised tail containing a "decoration" keyword
  // — handles "(Official Video)", "(Lyric Video)", "(Tamil Lyrics Video)", etc.
  /\s*\([^)]*\b(?:official|lyric|lyrics|music|tamil|video|song|audio)\b[^)]*\)\s*$/i,
  /\s*\[[^\]]*\b(?:official|lyric|lyrics|music|tamil|video|song|audio)\b[^\]]*\]\s*$/i,
  /\s+-\s*official\s*$/i,
  /\s+-\s*lyric(s)?\s*video\s*$/i,
];

/** Min length of the contained side before substring-match is allowed. */
const MIN_SUBSTRING_MATCH = 4;

/** Normalise a Tamil/English title for fuzzy comparison. */
export function normalizeTitle(input: string): string {
  if (!input) return '';
  let s = String(input);

  // Canonicalise combining marks (Tamil has multiple unicode forms for
  // some characters — NFC ensures both sides compare with the same bytes).
  try { s = s.normalize('NFC'); } catch { /* old runtimes — ignore */ }

  s = s.toLowerCase();

  // Strip YouTube boilerplate suffixes before anything else, while the
  // structural punctuation is still intact.
  for (const re of SUFFIX_STRIPPERS) s = s.replace(re, '');

  // Collapse the dotted-ellipsis filler ". . ." / "..." that YouTube titles
  // use for rhythmic effect but DB titles don't carry.
  s = s.replace(/(\s*\.\s*){2,}/g, ' ');

  // Remove decorative punctuation, keep letters + digits + COMBINING MARKS
  // (\p{M}) + spaces. Tamil vowel signs (e.g. ெ, ே, ை) and the virama (்)
  // are combining marks, not letters — stripping them mangles every word.
  s = s.replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ');

  // Collapse any whitespace and trim.
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}

/**
 * Decide whether a YouTube video matches a content record. Pure & exported
 * so the page-level matcher (which reads from DynamoDB) can stay a thin loop.
 */
export function videoMatchesContent(
  video: { id: string; title: string },
  content: { title?: unknown; videoUrl?: unknown }
): boolean {
  // 1. videoUrl carries the YouTube ID → definitive match.
  const videoUrl = typeof content.videoUrl === 'string' ? content.videoUrl : '';
  if (videoUrl && video.id && videoUrl.includes(video.id)) return true;

  // 2. Fuzzy title match.
  const a = normalizeTitle(typeof content.title === 'string' ? content.title : '');
  const b = normalizeTitle(video.title);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= MIN_SUBSTRING_MATCH && b.includes(a)) return true;
  if (b.length >= MIN_SUBSTRING_MATCH && a.includes(b)) return true;
  return false;
}
