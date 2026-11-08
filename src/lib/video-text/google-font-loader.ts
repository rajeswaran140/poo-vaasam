/**
 * Loads a Google font into the page for the Video Text tool, under a family
 * name of our own, with only the script its slot needs:
 *
 * - Tamil slot → Google's `tamil` faces; English slot → `latin` + `latin-ext`.
 *   A font with both scripts (Hind Madurai…) chosen as the English font must
 *   not draw the Tamil letters too: `English, Tamil` stacks split a line by
 *   script, exactly like the built-in fonts' unicode-range.
 * - U+200C/U+200D (ZWNJ/ZWJ) are taken OUT of the English faces' range: they
 *   belong to Tamil shaping (same rule as fontFaces.ts).
 * - Faces are fetched from fonts.gstatic.com only (CSP: connect-src
 *   fonts.googleapis.com for the CSS, font-src fonts.gstatic.com for files).
 *
 * Browser only. A failed load rejects, and is forgotten so a retry can work;
 * ensureFonts (draw.ts) turns that into "the font did not load".
 */
import type { GoogleFont } from './google-fonts';

export type FontSlot = 'tamil' | 'latin';

const SUBSETS: Record<FontSlot, string[]> = { tamil: ['tamil'], latin: ['latin', 'latin-ext'] };

/** The family name a Google font is registered under for one slot (quoted for CSS / canvas). */
export function googleFamilyName(font: GoogleFont, slot: FontSlot): string {
  const slug = font.family.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `"vt-g-${slot}-${slug}"`;
}

/** Remove U+200C–U+200D from a CSS unicode-range list. */
export function withoutJoiners(range: string): string {
  const LO = 0x200c;
  const HI = 0x200d;
  const out: string[] = [];
  for (const raw of range.split(',')) {
    const part = raw.trim();
    const m = /^U\+([0-9A-F?]+)(?:-([0-9A-F]+))?$/i.exec(part);
    if (!m || m[1].includes('?')) {
      out.push(part);
      continue;
    }
    const a = parseInt(m[1], 16);
    const b = m[2] ? parseInt(m[2], 16) : a;
    if (b < LO || a > HI) {
      out.push(part);
      continue;
    }
    const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');
    const piece = (x: number, y: number) => (x === y ? `U+${hex(x)}` : `U+${hex(x)}-${hex(y)}`);
    if (a < LO) out.push(piece(a, LO - 1));
    if (b > HI) out.push(piece(HI + 1, b));
  }
  return out.join(', ');
}

export interface FaceSpec {
  subset: string;
  url: string;
  unicodeRange: string;
}

/** The @font-face blocks of a css2 response, with the subset comment Google puts before each. */
export function parseCss2(css: string): FaceSpec[] {
  const out: FaceSpec[] = [];
  const re = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    const body = m[2];
    const url = /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)\s'"]+)\)/.exec(body)?.[1];
    const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim();
    if (url && range) out.push({ subset: m[1], url, unicodeRange: range });
  }
  return out;
}

export const css2Url = (font: GoogleFont) =>
  `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.family).replace(/%20/g, '+')}:wght@${font.weight}&display=swap`;

const loading = new Map<string, Promise<string>>();

/** Load the font for a slot (once per page); resolves to the quoted family name to draw with. */
export function loadGoogleFont(font: GoogleFont, slot: FontSlot): Promise<string> {
  const name = googleFamilyName(font, slot);
  const cached = loading.get(name);
  if (cached) return cached;
  const p = (async () => {
    if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) {
      throw new Error('fonts cannot load here');
    }
    const res = await fetch(css2Url(font));
    if (!res.ok) throw new Error(`Google Fonts answered ${res.status}`);
    const faces = parseCss2(await res.text()).filter((f) => SUBSETS[slot].includes(f.subset));
    if (faces.length === 0) throw new Error(`${font.family} has no ${slot === 'tamil' ? 'Tamil' : 'English'} letters`);
    const family = name.slice(1, -1);
    await Promise.all(
      faces.map(async (f) => {
        // Declared for every weight: the canvas asks for the TAMIL font's
        // weight (often 700), and a font with no bold (Lobster) must then
        // draw as designed, not as a smeared synthetic bold.
        const face = new FontFace(family, `url(${f.url}) format('woff2')`, {
          weight: '100 900',
          style: 'normal',
          unicodeRange: slot === 'latin' ? withoutJoiners(f.unicodeRange) : f.unicodeRange,
          display: 'swap',
        });
        await face.load();
        document.fonts.add(face);
      }),
    );
    return name;
  })();
  loading.set(name, p);
  p.catch(() => loading.delete(name));
  return p;
}

const previews = new Map<string, Promise<string>>();

/**
 * A tiny copy of a font with just the letters of its own name (css2 `text=`),
 * for showing search results in their own font. Never used for drawing.
 */
export function loadGoogleFontPreview(font: GoogleFont): Promise<string> {
  const slug = font.family.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const family = `vt-gp-${slug}`;
  const cached = previews.get(family);
  if (cached) return cached;
  const p = (async () => {
    if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) throw new Error('no fonts here');
    const res = await fetch(`${css2Url(font)}&text=${encodeURIComponent(font.family)}`);
    if (!res.ok) throw new Error(`Google Fonts answered ${res.status}`);
    const url = /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)\s'"]+)\)/.exec(await res.text())?.[1];
    if (!url) throw new Error('no font file');
    const face = new FontFace(family, `url(${url})`, { weight: '100 900', display: 'swap' });
    await face.load();
    document.fonts.add(face);
    return `"${family}"`;
  })();
  previews.set(family, p);
  p.catch(() => previews.delete(family));
  return p;
}
