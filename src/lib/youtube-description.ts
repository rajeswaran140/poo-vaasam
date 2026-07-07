/**
 * Assemble a ready-to-paste YouTube description from the composer's AI text +
 * Tamilagaval's standard footer (Subscribe / site / playlist links), so a song
 * can be published without hand-adding the boilerplate or cleaning up leaked
 * scaffolding labels ("YouTube Description", "Title:", etc.) on every upload.
 *
 * Pure + deterministic (no I/O) → fully unit-tested and safe on the client.
 *
 * The AI descriptions already end with their own hashtags, so the footer is
 * inserted BEFORE the trailing hashtag block (hashtags stay last, where YouTube
 * surfaces them). Any leading scaffolding label is stripped defensively.
 */

import { SITE } from '@/config/site';

const SUBSCRIBE_URL = `${SITE.youtube.channelUrl.replace(/\/+$/, '')}?sub_confirmation=1`;
const SITE_URL = 'https://tamilagaval.com/?utm_source=youtube&utm_medium=description';

const PLAYLIST = {
  all: 'PLLsCQ9NH4rLSZU0Ycy6I-Xr8DMAbe4vjs',
  latest: 'PLLsCQ9NH4rLQAr8WLqKSZu6JNd-9ns-wU',
  love: 'PLLsCQ9NH4rLRQMADaAhuHN_VBTHpwZ-DW',
  mother: 'PLLsCQ9NH4rLSmoTAihKjyVGXV5coMTs8v',
  heritage: 'PLEXvbEQYvb5A',
  sad: 'PLL_bTIv5Q1GU',
} as const;

const playlistUrl = (id: string) => `https://www.youtube.com/playlist?list=${id}`;

/** Optional theme-specific playlist, picked from the composer's emotion + theme. */
export function pickThemePlaylist(
  emotion = '',
  theme = ''
): { label: string; id: string } | null {
  // Most-specific themes first — "a mother's love" / "homeland love" must map to
  // Mother / Heritage, not get swallowed by the generic "love" branch.
  const s = `${emotion} ${theme}`.toLowerCase();
  if (/mother|family|அன்னை|தாய்|amma/.test(s)) return { label: '👩 தாய் பாசப் பாடல்கள் | Mother & Family', id: PLAYLIST.mother };
  if (/homeland|heritage|nostalg|தாயகம்|thayagam/.test(s)) return { label: '🌾 தாயகம் | Heritage', id: PLAYLIST.heritage };
  if (/sad|grief|heartbreak|separation|துயரம்|சோக/.test(s)) return { label: '💔 சோகக் காதல் பாடல்கள் | Sad Love Songs', id: PLAYLIST.sad };
  if (/love|romantic|காதல்|kadhal/.test(s)) return { label: '❤️ காதல் பாடல்கள் | Love Songs', id: PLAYLIST.love };
  return null;
}

/** Tamilagaval's standard description footer (bilingual links). */
export function buildDescriptionFooter(opts: { emotion?: string; theme?: string } = {}): string {
  const lines = [
    `📺 Subscribe: ${SUBSCRIBE_URL}`,
    `🌐 ${SITE_URL}`,
    '',
    `▶️ அனைத்து பாடல்கள் | All Songs: ${playlistUrl(PLAYLIST.all)}`,
    `⭐ புதிய பாடல்கள் | Latest: ${playlistUrl(PLAYLIST.latest)}`,
  ];
  const theme = pickThemePlaylist(opts.emotion, opts.theme);
  if (theme) lines.push(`${theme.label}: ${playlistUrl(theme.id)}`);
  return lines.join('\n');
}

const LABEL_RE = /^(youtube\s+)?(description|title|tags)\b/i;

/**
 * Strip a leaked leading scaffolding label ("YouTube Description", "Title:",
 * "**YouTube Tags** — copy/paste ready:") that some sources prepend. Only drops
 * a short, label-like leading line (+ any blank lines after it), never real copy.
 */
export function stripScaffoldingLabels(text: string): string {
  const lines = text.split('\n');
  while (lines.length) {
    const raw = lines[0].trim();
    const bare = raw.replace(/[*`_#>]/g, '').trim();
    const isLabel =
      LABEL_RE.test(bare) &&
      bare.length <= 60 &&
      (/[:—–-]/.test(bare) || /^(youtube\s+)?(description|title|tags)\s*$/i.test(bare) || /copy/i.test(bare));
    if (raw === '' || isLabel) {
      lines.shift();
      if (isLabel) while (lines.length && lines[0].trim() === '') lines.shift();
    } else break;
  }
  return lines.join('\n');
}

/** Split a description into [main text, trailing hashtag block]. */
export function splitTrailingHashtags(text: string): [string, string] {
  const lines = text.split('\n');
  const isHashtagLine = (l: string) => {
    const t = l.trim();
    if (t === '') return true;
    const tokens = t.split(/\s+/);
    return tokens.every((w) => w.startsWith('#')) && tokens.some((w) => w.length > 1);
  };
  let i = lines.length;
  while (i > 0 && isHashtagLine(lines[i - 1])) i--;
  const tail = lines.slice(i).join('\n').trim();
  if (!tail || !/#/.test(tail)) return [text, ''];
  return [lines.slice(0, i).join('\n').trimEnd(), tail];
}

/**
 * Assemble the ready-to-paste YouTube description: cleaned AI body + standard
 * footer, with the body's own hashtags kept at the very end.
 */
export function assembleYoutubeDescription(
  body: string,
  opts: { emotion?: string; theme?: string } = {}
): string {
  const clean = stripScaffoldingLabels(body).trim();
  const [main, hashtags] = splitTrailingHashtags(clean);
  const footer = buildDescriptionFooter(opts);
  return [main.trim(), footer, hashtags].filter(Boolean).join('\n\n');
}
