/**
 * OG image helpers — guarantee absolute share-image URLs (WhatsApp only renders
 * a rich preview for absolute https images) + attach alt text.
 */

import { absoluteImageUrl, ogImage, shareCardCover } from '@/lib/og-image';
import { SITE_URL } from '@/lib/seo';

describe('absoluteImageUrl', () => {
  it('passes through an already-absolute https URL (no double-prefix)', () => {
    const cdn = 'https://d2cdoh43143xxa.cloudfront.net/images/cover.png';
    expect(absoluteImageUrl(cdn)).toBe(cdn);
  });

  it('passes through protocol-relative and data URIs', () => {
    expect(absoluteImageUrl('//cdn.example.com/a.png')).toBe('//cdn.example.com/a.png');
    expect(absoluteImageUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });

  it('prefixes a site-relative path with SITE_URL', () => {
    expect(absoluteImageUrl('/images/hero.png')).toBe(`${SITE_URL}/images/hero.png`);
    expect(absoluteImageUrl('images/hero.png')).toBe(`${SITE_URL}/images/hero.png`);
  });

  it('trims surrounding whitespace', () => {
    expect(absoluteImageUrl('  /a.png  ')).toBe(`${SITE_URL}/a.png`);
  });
});

describe('ogImage', () => {
  it('returns undefined for empty/nullish input (lets the generated card win)', () => {
    expect(ogImage(undefined)).toBeUndefined();
    expect(ogImage(null)).toBeUndefined();
    expect(ogImage('   ')).toBeUndefined();
  });

  it('emits a single absolute-URL descriptor with alt', () => {
    expect(ogImage('/images/cover.png', 'A song')).toEqual([
      { url: `${SITE_URL}/images/cover.png`, alt: 'A song' },
    ]);
  });

  it('omits alt when not provided', () => {
    expect(ogImage('https://cdn/x.png')).toEqual([{ url: 'https://cdn/x.png' }]);
  });
});

describe('shareCardCover', () => {
  const hero = 'https://d2cdoh43143xxa.cloudfront.net/images/song-covers/hero.png';
  const cover = 'https://d2cdoh43143xxa.cloudfront.net/images/song-covers/cover.png';

  it('prefers the hero art over the featured cover', () => {
    expect(shareCardCover(hero, cover)).toBe(hero);
  });

  it('falls back to the featured cover when there is no hero', () => {
    expect(shareCardCover(undefined, cover)).toBe(cover);
    expect(shareCardCover(null, cover)).toBe(cover);
    expect(shareCardCover('  ', cover)).toBe(cover);
  });

  it('absolutises a site-relative cover', () => {
    expect(shareCardCover(undefined, '/images/c.png')).toBe(`${SITE_URL}/images/c.png`);
  });

  it('returns undefined when neither is present (card stays text-only)', () => {
    expect(shareCardCover(undefined, undefined)).toBeUndefined();
    expect(shareCardCover(null, null)).toBeUndefined();
    expect(shareCardCover('', '   ')).toBeUndefined();
  });
});
