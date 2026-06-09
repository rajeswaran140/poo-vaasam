import {
  absoluteUrl,
  toDescription,
  SITE_URL,
  alternatesFor,
  ogCardLines,
  ROMANISED_TYPE_LABEL,
  DEFAULT_AUTHOR,
  parseGoogleFontUrl,
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
