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

import { SITE, isWhatsAppConfigured } from '@/config/site';

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

/**
 * The PERMANENT Tamilagaval credit block — single source of truth for song
 * credits (Raj; updated 2026-07-18 to add the rights line + copyright). Baked
 * into every assembled description so the catalogue never drifts back to legacy
 * wording. Leads with authorship; frames the workflow as "AI-Assisted Music
 * Production" (his lyrics + musical direction + prompt/version/vocal/style
 * decisions), NOT AI as the principal creator.
 *
 * Wording note: "(original, all rights reserved)" is Raj's approved credit — a
 * plain rights assertion, distinct from the still-BANNED bare marketing claim
 * "100% original" (a jurisdiction-specific AI-authorship claim). The copyright
 * line uses the brand name "Raj Thangarajah", never the full "Rajeswaran".
 */
export const CREDIT_BLOCK = [
  '✍️ Lyrics: Raj (original, all rights reserved)',
  '🎵 Music Production & Creative Direction: TamilAgaval.com',
  '🤖 AI-Assisted Music Production',
  '© 2026 TamilAgaval / Raj Thangarajah',
].join('\n');

/**
 * Phrases banned from any published description (legacy credit drift). If the AI
 * body ever emits one, the whole line is dropped before the canonical
 * CREDIT_BLOCK is appended — so the output can never carry the old wording.
 * NOTE: bans the bare "100% original" claim, NOT the approved credit wording
 * "(original, all rights reserved)"; bans the full "Rajeswaran Thangarajah",
 * NOT the brand "Raj Thangarajah" used in the copyright line.
 */
const FORBIDDEN_LINE_RE =
  /music\s+composition:\s*ai-assisted|100%\s*original|rajeswaran\s+thangarajah/i;

/** Drop any body line carrying a forbidden legacy-credit phrase. */
export function stripForbiddenCreditLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !FORBIDDEN_LINE_RE.test(line))
    .join('\n');
}

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

/**
 * The one line that goes ABOVE the fold, before YouTube's "...more" cut.
 *
 * YouTube shows only the first ~150 characters of a description; everything
 * after that is a click away and is, in practice, unread. An ask buried in the
 * footer is invisible — which is why the site currently receives ~18 sessions a
 * month from ~150k views. So the single most valuable ask leads.
 *
 * Returns '' until a real WhatsApp channel URL is configured, so nothing
 * half-finished can reach a published description. The moment
 * SITE.whatsapp.url is filled in, every newly assembled description carries it.
 */
export function buildDescriptionLead(channelUrl?: string): string {
  const url = channelUrl ?? (isWhatsAppConfigured() ? SITE.whatsapp.url : '');
  if (!/whatsapp\.com\/channel\//.test(url)) return '';
  return `📲 புதிய பாடல்கள் WhatsApp-இல் | New songs on WhatsApp: ${url}`;
}

/** Tamilagaval's standard description footer (bilingual links). */
export function buildDescriptionFooter(opts: { emotion?: string; theme?: string } = {}): string {
  const lines = [
    ...(isWhatsAppConfigured()
      ? [`📲 WhatsApp சேனல் | Channel: ${SITE.whatsapp.url}`]
      : []),
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
 * Assemble the ready-to-paste YouTube description: cleaned AI body + permanent
 * credit block + standard footer, with the body's own hashtags kept at the very
 * end. Any legacy-credit line in the body is stripped first so the canonical
 * CREDIT_BLOCK is the only attribution the output can carry.
 */
export function assembleYoutubeDescription(
  body: string,
  opts: { emotion?: string; theme?: string } = {}
): string {
  const clean = stripForbiddenCreditLines(stripScaffoldingLabels(body)).trim();
  const [main, hashtags] = splitTrailingHashtags(clean);
  const footer = buildDescriptionFooter(opts);
  // Lead FIRST — it is the only part guaranteed to be seen before "...more".
  return [buildDescriptionLead(), main.trim(), CREDIT_BLOCK, footer, hashtags]
    .filter(Boolean)
    .join('\n\n');
}
