/** @jest-environment jsdom */
import { GOOGLE_FONTS } from '@/lib/video-text/google-fonts';
import { googleFamilyName, loadGoogleFont, parseCss2, withoutJoiners, css2Url } from '@/lib/video-text/google-font-loader';

const font = (family: string) => GOOGLE_FONTS.find((f) => f.family === family)!;

const CSS = `/* tamil */
@font-face {
  font-family: 'Hind Madurai';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/hm/tamil.woff2) format('woff2');
  unicode-range: U+0964-0965, U+0B82-0BFA, U+200C-200D, U+20B9, U+25CC;
}
/* latin-ext */
@font-face {
  font-family: 'Hind Madurai';
  src: url(https://fonts.gstatic.com/s/hm/latin-ext.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+1E00-1E9F;
}
/* latin */
@font-face {
  font-family: 'Hind Madurai';
  src: url(https://fonts.gstatic.com/s/hm/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+2000-206F, U+20AC;
}
/* evil */
@font-face {
  src: url(https://evil.example/x.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}`;

describe('the font list', () => {
  it('has every Google font with Tamil, and a large English list', () => {
    expect(GOOGLE_FONTS.filter((f) => f.tamil).length).toBeGreaterThanOrEqual(15);
    expect(GOOGLE_FONTS.filter((f) => f.latin).length).toBeGreaterThan(1500);
    expect(font('Hind Madurai')).toMatchObject({ tamil: true, latin: true, weight: 700 });
    expect(font('Lobster')).toMatchObject({ tamil: false, latin: true, weight: 400 });
    for (const f of GOOGLE_FONTS) expect(f.family).toMatch(/^[A-Za-z0-9 ]{1,64}$/);
  });
});

describe('parsing and ranges', () => {
  it('reads each face with its subset, and only from fonts.gstatic.com', () => {
    expect(parseCss2(CSS)).toEqual([
      { subset: 'tamil', url: 'https://fonts.gstatic.com/s/hm/tamil.woff2', unicodeRange: 'U+0964-0965, U+0B82-0BFA, U+200C-200D, U+20B9, U+25CC' },
      { subset: 'latin-ext', url: 'https://fonts.gstatic.com/s/hm/latin-ext.woff2', unicodeRange: 'U+0100-02BA, U+1E00-1E9F' },
      { subset: 'latin', url: 'https://fonts.gstatic.com/s/hm/latin.woff2', unicodeRange: 'U+0000-00FF, U+2000-206F, U+20AC' },
    ]);
  });

  it('takes ZWNJ/ZWJ out of an English range (they belong to Tamil shaping)', () => {
    expect(withoutJoiners('U+0000-00FF, U+2000-206F, U+20AC')).toBe('U+0000-00FF, U+2000-200B, U+200E-206F, U+20AC');
    expect(withoutJoiners('U+200C, U+200D, U+0041')).toBe('U+0041');
    expect(withoutJoiners('U+200C-200D')).toBe('');
  });

  it('asks Google for the weight drawn', () => {
    expect(css2Url(font('Hind Madurai'))).toBe('https://fonts.googleapis.com/css2?family=Hind+Madurai:wght@700&display=swap');
    expect(css2Url(font('Lobster'))).toBe('https://fonts.googleapis.com/css2?family=Lobster:wght@400&display=swap');
  });
});

describe('loadGoogleFont', () => {
  const added: Array<{ family: string; src: string; desc: FontFaceDescriptors }> = [];
  let fetchMock: jest.Mock;
  beforeEach(() => {
    added.length = 0;
    fetchMock = jest.fn(async () => ({ ok: true, text: async () => CSS }));
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
    (global as unknown as { FontFace: unknown }).FontFace = class {
      constructor(public family: string, public src: string, public desc: FontFaceDescriptors) {}
      async load() { return this; }
    };
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add: (f: { family: string; src: string; desc: FontFaceDescriptors }) => added.push(f) } });
  });

  it('the English slot gets only the latin faces, without the joiners, under its own name', async () => {
    const f = { ...font('Hind Madurai'), family: 'Hind Madurai' };
    await expect(loadGoogleFont(f, 'latin')).resolves.toBe('"vt-g-latin-hind-madurai"');
    expect(added.map((a) => a.src)).toEqual([
      "url(https://fonts.gstatic.com/s/hm/latin-ext.woff2) format('woff2')",
      "url(https://fonts.gstatic.com/s/hm/latin.woff2) format('woff2')",
    ]);
    expect(added[1].desc.unicodeRange).toBe('U+0000-00FF, U+2000-200B, U+200E-206F, U+20AC');
    expect(added.every((a) => a.family === 'vt-g-latin-hind-madurai' && a.desc.weight === '100 900')).toBe(true);
  });

  it('the Tamil slot gets only the Tamil face; each slot loads once', async () => {
    const f = font('Hind Madurai');
    await loadGoogleFont(f, 'tamil');
    await loadGoogleFont(f, 'tamil');
    expect(added.map((a) => a.src)).toEqual(["url(https://fonts.gstatic.com/s/hm/tamil.woff2) format('woff2')"]);
    expect(added[0].desc.unicodeRange).toContain('U+200C-200D');
    expect(googleFamilyName(f, 'tamil')).toBe('"vt-g-tamil-hind-madurai"');
  });

  it('a failed load rejects, and the next try fetches again', async () => {
    const f = font('Lobster');
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, text: async () => '' });
    await expect(loadGoogleFont(f, 'latin')).rejects.toThrow('503');
    await expect(loadGoogleFont(f, 'latin')).resolves.toBe('"vt-g-latin-lobster"');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a font with no faces for the slot is refused', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => CSS.split('/* latin-ext */')[0] });
    await expect(loadGoogleFont(font('Pavanam'), 'latin')).rejects.toThrow('has no English letters');
  });
});
