import {
  absoluteUrl,
  toDescription,
  SITE_URL,
  alternatesFor,
  breadcrumbJsonLd,
  crawlerAuthor,
  ogCardLines,
  ROMANISED_TYPE_LABEL,
  DEFAULT_AUTHOR,
  parseGoogleFontUrl,
  actionVerb,
} from '@/lib/seo';

describe('absoluteUrl', () => {
  it('prefixes a leading-slash path with the site URL', () => {
    expect(absoluteUrl('/songs')).toBe(`${SITE_URL}/songs`);
  });

  it('adds a missing leading slash', () => {
    expect(absoluteUrl('songs')).toBe(`${SITE_URL}/songs`);
  });

  it('returns the site root for an empty path', () => {
    expect(absoluteUrl()).toBe(`${SITE_URL}/`);
  });
});

describe('toDescription', () => {
  it('collapses whitespace/newlines into single spaces', () => {
    expect(toDescription('hello   world\n\nfoo')).toBe('hello world foo');
  });

  it('returns short text unchanged', () => {
    expect(toDescription('short text', 160)).toBe('short text');
  });

  it('truncates long text and appends an ellipsis within the limit', () => {
    const result = toDescription('a'.repeat(300), 50);
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result.endsWith('…')).toBe(true);
  });

  it('handles empty/undefined input', () => {
    expect(toDescription('')).toBe('');
    expect(toDescription(undefined as unknown as string)).toBe('');
  });
});

describe('alternatesFor', () => {
  it('returns a path canonical plus self-referencing ta + x-default hreflang', () => {
    const alt = alternatesFor('/poems');
    expect(alt.canonical).toBe('/poems');
    expect(alt.languages).toEqual({
      ta: `${SITE_URL}/poems`,
      'x-default': `${SITE_URL}/poems`,
    });
  });

  it('normalises a missing leading slash', () => {
    expect(alternatesFor('songs').canonical).toBe('/songs');
    expect(alternatesFor('songs').languages.ta).toBe(`${SITE_URL}/songs`);
  });

  it('defaults to the site root', () => {
    expect(alternatesFor().canonical).toBe('/');
    expect(alternatesFor().languages['x-default']).toBe(`${SITE_URL}/`);
  });
});

describe('breadcrumbJsonLd', () => {
  it('builds a schema.org BreadcrumbList with absolute item URLs and 1-based positions', () => {
    const ld = breadcrumbJsonLd([
      { name: 'Tamilagaval', path: '/' },
      { name: 'Videos', path: '/videos' },
    ]) as {
      '@context': string;
      '@type': string;
      itemListElement: Array<{ '@type': string; position: number; name: string; item: string }>;
    };

    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('BreadcrumbList');
    expect(ld.itemListElement).toHaveLength(2);

    expect(ld.itemListElement[0]).toEqual({
      '@type': 'ListItem',
      position: 1,
      name: 'Tamilagaval',
      item: `${SITE_URL}/`,
    });
    expect(ld.itemListElement[1]).toEqual({
      '@type': 'ListItem',
      position: 2,
      name: 'Videos',
      item: `${SITE_URL}/videos`,
    });
  });

  it('normalises a path missing its leading slash', () => {
    const ld = breadcrumbJsonLd([{ name: 'Songs', path: 'songs' }]) as {
      itemListElement: Array<{ item: string }>;
    };
    expect(ld.itemListElement[0].item).toBe(`${SITE_URL}/songs`);
  });

  it('returns an empty list for no crumbs (no crash)', () => {
    const ld = breadcrumbJsonLd([]) as { itemListElement: unknown[] };
    expect(ld.itemListElement).toEqual([]);
  });
});

describe('crawlerAuthor', () => {
  it('maps a Tamil-only author to the canonical romanised name', () => {
    expect(crawlerAuthor('இராஜ்')).toBe(DEFAULT_AUTHOR);
  });

  it('keeps an already-romanised (Latin) author as-is', () => {
    expect(crawlerAuthor('Raj')).toBe('Raj');
    expect(crawlerAuthor('Rajeswaran Thangarajah')).toBe('Rajeswaran Thangarajah');
  });

  it('falls back to the default author for empty/whitespace/nullish input', () => {
    expect(crawlerAuthor('')).toBe(DEFAULT_AUTHOR);
    expect(crawlerAuthor('   ')).toBe(DEFAULT_AUTHOR);
    expect(crawlerAuthor(undefined)).toBe(DEFAULT_AUTHOR);
    expect(crawlerAuthor(null)).toBe(DEFAULT_AUTHOR);
  });
});

describe('ogCardLines', () => {
  it('uses the romanised type label and author', () => {
    const lines = ogCardLines({ type: 'SONGS', author: 'Ammaiyar' });
    expect(lines.title).toBe(ROMANISED_TYPE_LABEL.SONGS);
    expect(lines.title).toBe('Tamil Song');
    expect(lines.subtitle).toBe('by Ammaiyar');
    expect(lines.kicker).toBe('TAMILAGAVAL');
  });

  it('falls back to the default author when none is given', () => {
    expect(ogCardLines({ type: 'POEMS' }).subtitle).toBe(`by ${DEFAULT_AUTHOR}`);
  });

  it('falls back to generic label for an unknown/missing type (no tofu, no crash)', () => {
    expect(ogCardLines({}).title).toBe('Tamil Poetry');
    expect(ogCardLines({ type: 'WUT' }).title).toBe('Tamil Poetry');
  });
});

describe('actionVerb', () => {
  it('is "listen" for audio content (songs, lyrics)', () => {
    expect(actionVerb('SONGS')).toBe('listen');
    expect(actionVerb('LYRICS')).toBe('listen');
  });

  it('is "read" for text content and unknown types', () => {
    expect(actionVerb('POEMS')).toBe('read');
    expect(actionVerb('STORIES')).toBe('read');
    expect(actionVerb('ESSAYS')).toBe('read');
    expect(actionVerb('WHATEVER')).toBe('read');
  });
});

describe('parseGoogleFontUrl', () => {
  it('extracts a ttf URL from a Google Fonts css2 response', () => {
    const css = `@font-face{font-family:'Noto Sans Tamil';src:url(https://fonts.gstatic.com/abc/v1/font.ttf) format('truetype');}`;
    expect(parseGoogleFontUrl(css)).toBe('https://fonts.gstatic.com/abc/v1/font.ttf');
  });

  it('accepts otf/woff but rejects woff2 (Satori cannot parse it)', () => {
    expect(parseGoogleFontUrl("src:url(https://x/y.otf) format('opentype')")).toBe('https://x/y.otf');
    expect(parseGoogleFontUrl("src:url(https://x/y.woff) format('woff')")).toBe('https://x/y.woff');
    expect(parseGoogleFontUrl("src:url(https://x/y.woff2) format('woff2')")).toBeNull();
  });

  it('returns null when there is no usable font URL', () => {
    expect(parseGoogleFontUrl('')).toBeNull();
    expect(parseGoogleFontUrl('not a font css')).toBeNull();
  });
});
