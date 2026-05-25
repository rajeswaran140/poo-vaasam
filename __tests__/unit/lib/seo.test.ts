import { absoluteUrl, toDescription, SITE_URL } from '@/lib/seo';

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
