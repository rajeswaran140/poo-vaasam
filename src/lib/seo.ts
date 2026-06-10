/**
 * SEO helpers — canonical base URL and small text utilities.
 */

export const SITE_URL = 'https://tamilagaval.com';
// Brand name in romanised form — SITE_NAME flows into JSON-LD + OG, which are
// crawler-facing. The visible UI keeps "தமிழகவல்" as its own string.
export const SITE_NAME = 'Tamilagaval';

/** Build an absolute URL from a path. */
export function absoluteUrl(path = ''): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Collapse whitespace and truncate text for use as a meta description. */
export function toDescription(text: string, max = 160): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/**
 * Build a Metadata `alternates` block with a self-referencing `hreflang="ta"`
 * and `x-default`. The audience is the global Tamil diaspora (IN, LK, MY, SG,
 * CA, UK) searching the same content; emitting hreflang tells Google one
 * canonical serves every region instead of treating them as competing dupes.
 */
export function alternatesFor(path = '/') {
  const canonical = path.startsWith('/') ? path : `/${path}`;
  const url = absoluteUrl(canonical);
  return {
    canonical,
    languages: {
      ta: url,
      'x-default': url,
    },
  };
}

/**
 * Extract a Satori-compatible font URL from a Google Fonts `css2` response.
 * Satori (the OG-image renderer) parses ttf/otf/woff but NOT woff2, so we only
 * accept those formats; returns null when the CSS has no usable URL (caller
 * then falls back to a Latin-only card rather than rendering tofu).
 */
export function parseGoogleFontUrl(css: string): string | null {
  const match = css.match(/url\((https:\/\/[^)]+\.(?:ttf|otf|woff))\)/i);
  return match ? match[1] : null;
}

/**
 * The verb that fits how a content type is consumed — songs/lyrics are listened
 * to, everything else is read. Used in meta descriptions so a song page doesn't
 * say "read for free".
 */
export function actionVerb(type: string): 'listen' | 'read' {
  return type === 'SONGS' || type === 'LYRICS' ? 'listen' : 'read';
}

/** Romanised content-type labels — crawler/share-card facing (not the UI). */
export const ROMANISED_TYPE_LABEL: Record<string, string> = {
  SONGS: 'Tamil Song',
  POEMS: 'Tamil Poem',
  LYRICS: 'Tamil Lyrics',
  STORIES: 'Tamil Story',
  ESSAYS: 'Tamil Essay',
};

export const DEFAULT_AUTHOR = 'Rajeswaran Thangarajah';

/**
 * Romanised lines for a per-content social share card (Open Graph image).
 *
 * The card is intentionally Latin-only: the OG renderer (Satori) has no Tamil
 * glyphs without an explicitly bundled font, so rendering the Tamil title would
 * produce tofu. We show the romanised type + author on the brand card instead,
 * which is recognisable in WhatsApp/Facebook diaspora shares and never breaks.
 */
export function ogCardLines(content: { type?: string | null; author?: string | null }) {
  return {
    kicker: SITE_NAME.toUpperCase(),
    title: (content.type && ROMANISED_TYPE_LABEL[content.type]) || 'Tamil Poetry',
    subtitle: `by ${content.author || DEFAULT_AUTHOR}`,
    footer: 'Always free · tamilagaval.com',
  };
}
