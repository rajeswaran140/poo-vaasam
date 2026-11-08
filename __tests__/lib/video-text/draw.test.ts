import {
  SAFE_MARGIN,
  FONT_FAMILY,
  wrapLines,
  layoutBlock,
  placementFor,
  fontStackFor,
  drawBlock,
  resolveFontFamily,
  ensureFonts,
  renderBlockPng,
} from '@/lib/video-text/draw';
import type { TextBlock, TextStyle } from '@/types/videoText';
import * as loader from '@/lib/video-text/google-font-loader';

jest.mock('@/lib/video-text/google-font-loader', () => {
  const actual = jest.requireActual('@/lib/video-text/google-font-loader');
  return { ...actual, loadGoogleFont: jest.fn(actual.loadGoogleFont) };
});
const loadGoogleFont = loader.loadGoogleFont as jest.Mock;

function fakeCtx() {
  return {
    font: '',
    measureText: (s: string) => ({ width: s.length * 10 }),
  } as unknown as CanvasRenderingContext2D;
}

const FRAME = { width: 1920, height: 1080 };
const STYLE: TextStyle = { sizeScale: 1, lyricPosition: 'lower' };
const block = (track: TextBlock['track'], text: string): TextBlock => ({
  id: 'b', track, text, startSec: 0, endSec: 1,
});
const maxW = FRAME.width * (1 - 2 * SAFE_MARGIN);

describe('wrapLines', () => {
  it('wraps 30 chars at width 100 into <= 2 lines when words allow, fits true', () => {
    const r = wrapLines(fakeCtx(), 'aaaa bbbb cccc dddd eeee ffff', 160, 2);
    expect(r.lines.length).toBeLessThanOrEqual(2);
    expect(r.fits).toBe(true);
  });

  it('reports fits=false when it cannot fit in maxLines', () => {
    const r = wrapLines(fakeCtx(), 'aaaa bbbb cccc dddd eeee ffff gggg', 100, 2);
    expect(r.fits).toBe(false);
  });

  it('honours explicit newlines', () => {
    const r = wrapLines(fakeCtx(), 'ab\ncd', 1000, 2);
    expect(r.lines).toEqual(['ab', 'cd']);
  });

  it('never splits a Tamil cluster when breaking an over-long word', () => {
    const word = 'கொக்கொக்கொக்'; // clusters made of consonant + vowel signs
    const clusters = Array.from(new Intl.Segmenter('ta', { granularity: 'grapheme' }).segment(word)).map((s) => s.segment);
    const ctx = {
      font: '',
      measureText: (s: string) => ({ width: Array.from(new Intl.Segmenter('ta', { granularity: 'grapheme' }).segment(s)).length * 10 }),
    } as unknown as CanvasRenderingContext2D;
    const r = wrapLines(ctx, word, 20, 5);
    expect(r.lines.join('')).toBe(word);
    for (const line of r.lines) {
      // every line boundary must be a cluster boundary
      expect(clusters.join('|')).toContain(Array.from(new Intl.Segmenter('ta', { granularity: 'grapheme' }).segment(line)).map((s) => s.segment).join('|'));
    }
    expect(r.lines.length).toBeGreaterThan(1);
  });
});

describe('layoutBlock', () => {
  it('shrinks a 400-char lyric to <= 2 lines inside the safe width', () => {
    const ctx = fakeCtx();
    const l = layoutBlock(ctx, block('lyric', 'x'.repeat(400)), FRAME, STYLE);
    expect(l.lines.length).toBeLessThanOrEqual(2);
    expect(l.fontPx).toBeLessThan(FRAME.height * 0.05);
    for (const line of l.lines) {
      expect(ctx.measureText(line).width).toBeLessThanOrEqual(maxW);
    }
  });

  it('keeps the last lyric baseline inside the bottom safe margin', () => {
    const l = layoutBlock(fakeCtx(), block('lyric', 'hello world'), FRAME, STYLE);
    expect(Math.max(...l.yBaseline)).toBeLessThanOrEqual(FRAME.height * (1 - SAFE_MARGIN));
  });

  it('puts a middle lyric at the vertical centre', () => {
    const l = layoutBlock(fakeCtx(), block('lyric', 'hello'), FRAME, { ...STYLE, lyricPosition: 'middle' });
    expect(Math.abs(l.yBaseline[0] - FRAME.height / 2)).toBeLessThanOrEqual(1);
  });

  it('centres title lines vertically within 1px', () => {
    const l = layoutBlock(fakeCtx(), block('title', 'Line one\nLine two'), FRAME, STYLE);
    expect(l.lines).toHaveLength(2);
    const mid = (l.yBaseline[0] + l.yBaseline[l.yBaseline.length - 1]) / 2;
    expect(Math.abs(mid - FRAME.height / 2)).toBeLessThanOrEqual(1);
  });

  it('lays out 6 credits lines', () => {
    const l = layoutBlock(fakeCtx(), block('credits', 'a\nb\nc\nd\ne\nf'), FRAME, STYLE);
    expect(l.lines).toHaveLength(6);
  });

  it('sizeScale 1.5 gives a larger fontPx than 1', () => {
    const a = layoutBlock(fakeCtx(), block('title', 'Hi'), FRAME, STYLE);
    const b = layoutBlock(fakeCtx(), block('title', 'Hi'), FRAME, { ...STYLE, sizeScale: 1.5 });
    expect(b.fontPx).toBeGreaterThan(a.fontPx);
  });
});

describe('renderBlockPng', () => {
  const order: string[] = [];
  const sizes: Array<[number, number]> = [];
  beforeEach(() => {
    order.length = 0;
    sizes.length = 0;
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load: jest.fn(async (f: string) => { order.push('load:' + f); return []; }), check: () => true },
    });
    class FakeOffscreen {
      constructor(w: number, h: number) { sizes.push([w, h]); }
      getContext() {
        order.push('getContext');
        return {
          font: '', measureText: (s: string) => ({ width: s.length * 10 }),
          fillText: jest.fn(), strokeText: jest.fn(), clearRect: jest.fn(),
          save: jest.fn(), restore: jest.fn(),
        };
      }
      async convertToBlob() { return new Blob(['x'], { type: 'image/png' }); }
    }
    (globalThis as unknown as Record<string, unknown>).OffscreenCanvas = FakeOffscreen;
  });
  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).OffscreenCanvas;
  });

  it('awaits the font, then makes a canvas of exactly frame size', async () => {
    const blob = await renderBlockPng(block('lyric', 'hi'), { width: 1280, height: 720 }, STYLE);
    expect(blob).toBeInstanceOf(Blob);
    expect(sizes).toEqual([[1280, 720]]);
    expect(order[0]).toBe('load:700 32px "Noto Sans Tamil"');
    expect(order.indexOf('getContext')).toBeGreaterThan(0);
    expect(FONT_FAMILY).toContain('Noto Sans Tamil');
  });
});

describe('resolveFontFamily / ensureFonts', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--font-tamil');
  });

  it('uses the --font-tamil variable when set', () => {
    document.documentElement.style.setProperty('--font-tamil', "'__notoSansTamil_abc'");
    expect(resolveFontFamily()).toBe(`'__notoSansTamil_abc', "Noto Sans", sans-serif`);
  });

  it('falls back to FONT_FAMILY when unset', () => {
    expect(resolveFontFamily()).toBe(FONT_FAMILY);
  });

  it('ensureFonts throws when the font check fails after load', async () => {
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load: jest.fn(async () => []), check: () => false },
    });
    await expect(ensureFonts()).rejects.toThrow(
      'The Tamil font did not load — reload the page and try again.',
    );
  });

  it('F7: loads and checks with a Tamil letter, so the Tamil subset (not only Latin) is fetched', async () => {
    const load = jest.fn(async () => []);
    const check = jest.fn(() => true);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load, check } });
    await ensureFonts();
    expect(load).toHaveBeenCalledWith(expect.stringContaining('700 32px'), 'அ');
    expect(check).toHaveBeenCalledWith(expect.stringContaining('700 32px'), 'அ');
  });
});

describe('title and credits placement', () => {
  const inset = (fontPx: number) => FRAME.width * SAFE_MARGIN + fontPx * 0.06;

  it('placementFor: title and credits default to centre; lyrics follow lyricPosition', () => {
    expect(placementFor('title', STYLE)).toEqual({ v: 'middle', h: 'center' });
    expect(placementFor('credits', STYLE)).toEqual({ v: 'middle', h: 'center' });
    expect(placementFor('lyric', STYLE)).toEqual({ v: 'bottom', h: 'center' });
    expect(placementFor('lyric', { ...STYLE, lyricPosition: 'middle' })).toEqual({ v: 'middle', h: 'center' });
  });

  it('a saved project with no placement lays out exactly as before (centred)', () => {
    for (const track of ['title', 'credits'] as const) {
      const l = layoutBlock(fakeCtx(), block(track, 'Line one\nLine two'), FRAME, STYLE);
      expect(l.align).toBe('center');
      expect(l.x).toBe(FRAME.width / 2);
      // Vertically centred, as before placement existed.
      const lh = l.fontPx * 1.25;
      expect(l.yBaseline[0] - lh / 2).toBeCloseTo((FRAME.height - lh * l.lines.length) / 2, 6);
      // Explicit Centre is identical to no placement.
      const key = track === 'title' ? 'titlePlace' : 'creditsPlace';
      expect(layoutBlock(fakeCtx(), block(track, 'Line one\nLine two'), FRAME, { ...STYLE, [key]: { v: 'middle', h: 'center' } })).toEqual(l);
    }
  });

  it('top-left title: first line at the top safe margin, left-aligned at the left margin', () => {
    const style: TextStyle = { ...STYLE, titlePlace: { v: 'top', h: 'left' } };
    const l = layoutBlock(fakeCtx(), block('title', 'Line one\nLine two'), FRAME, style);
    expect(l.align).toBe('left');
    expect(l.x).toBeCloseTo(inset(l.fontPx), 6);
    const lh = l.fontPx * 1.25;
    expect(l.yBaseline[0] - lh / 2).toBeCloseTo(FRAME.height * SAFE_MARGIN, 6);
  });

  it('bottom-right credits: last line ends at the bottom safe margin, right-aligned', () => {
    const style: TextStyle = { ...STYLE, creditsPlace: { v: 'bottom', h: 'right' } };
    const l = layoutBlock(fakeCtx(), block('credits', 'a\nb\nc'), FRAME, style);
    expect(l.align).toBe('right');
    expect(l.x).toBeCloseTo(FRAME.width - inset(l.fontPx), 6);
    const lh = l.fontPx * 1.25;
    expect(l.yBaseline.at(-1)! + lh / 2).toBeCloseTo(FRAME.height * (1 - SAFE_MARGIN), 6);
  });

  it('a full-width left-aligned line, stroke included, stays inside the right safe margin', () => {
    const ctx = fakeCtx();
    const style: TextStyle = { ...STYLE, titlePlace: { v: 'middle', h: 'left' } };
    const l = layoutBlock(ctx, block('title', 'x'.repeat(400)), FRAME, style);
    for (const line of l.lines) {
      const right = l.x + ctx.measureText(line).width + l.fontPx * 0.06;
      expect(right).toBeLessThanOrEqual(FRAME.width * (1 - SAFE_MARGIN) + 1e-6);
    }
  });

  it('title placement never moves the lyrics or the credits', () => {
    const style: TextStyle = { ...STYLE, titlePlace: { v: 'top', h: 'right' } };
    const lyricBefore = layoutBlock(fakeCtx(), block('lyric', 'hello'), FRAME, STYLE);
    expect(layoutBlock(fakeCtx(), block('lyric', 'hello'), FRAME, style)).toEqual(lyricBefore);
    const creditsBefore = layoutBlock(fakeCtx(), block('credits', 'c'), FRAME, STYLE);
    expect(layoutBlock(fakeCtx(), block('credits', 'c'), FRAME, style)).toEqual(creditsBefore);
  });

  it('vertical frame (1080×1920): bottom-left stays inside both margins', () => {
    const tall = { width: 1080, height: 1920 };
    const style: TextStyle = { ...STYLE, creditsPlace: { v: 'bottom', h: 'left' } };
    const l = layoutBlock(fakeCtx(), block('credits', 'Music\nWords'), tall, style);
    expect(l.x).toBeCloseTo(tall.width * SAFE_MARGIN + l.fontPx * 0.06, 6);
    expect(l.yBaseline.at(-1)! + (l.fontPx * 1.25) / 2).toBeCloseTo(tall.height * (1 - SAFE_MARGIN), 6);
  });
});

describe('per-part size and fonts', () => {
  const VARS: Record<string, string> = {
    '--font-tamil': "'__noto_sans_tamil'",
    '--vt-arima': "'__arima'",
    '--font-kavivanar': "'__kavivanar'",
    '--vt-playfair-display': "'__playfair'",
    '--vt-montserrat': "'__montserrat'",
  };
  let wrap: HTMLDivElement;
  beforeEach(() => {
    wrap = document.createElement('div');
    wrap.setAttribute('data-vt-fonts', '');
    for (const [k, v] of Object.entries(VARS)) wrap.style.setProperty(k, v);
    document.body.appendChild(wrap);
  });
  afterEach(() => wrap.remove());
  const withTracks = (tracks: TextStyle['tracks']): TextStyle => ({ ...STYLE, tracks });

  it('a project saved before fonts existed draws with the old stack and size', () => {
    expect(fontStackFor('title', STYLE)).toEqual({ stack: `'__noto_sans_tamil', "Noto Sans", sans-serif`, weight: 700 });
    const before = layoutBlock(fakeCtx(), block('title', 'Hi'), FRAME, STYLE);
    expect(before.fontPx).toBeCloseTo(FRAME.height * 0.075, 6);
  });

  it('English font first, then the Tamil font, for each part on its own', () => {
    const st = withTracks({ title: { tamilFont: 'arima', englishFont: 'playfair-display' } });
    expect(fontStackFor('title', st).stack).toBe(`'__playfair', '__arima', "Noto Sans", sans-serif`);
    // Other parts keep the default.
    expect(fontStackFor('lyric', st).stack).toBe(`'__noto_sans_tamil', "Noto Sans", sans-serif`);
  });

  it('Kavivanar (no bold) draws at weight 400', () => {
    const st = withTracks({ credits: { tamilFont: 'kavivanar' } });
    expect(fontStackFor('credits', st)).toEqual({ stack: `'__kavivanar', "Noto Sans", sans-serif`, weight: 400 });
  });

  it('each part has its own size; the old project-wide size is the fallback', () => {
    const st: TextStyle = { ...STYLE, sizeScale: 0.9, tracks: { title: { size: 2 }, credits: { size: 0.5 } } };
    expect(layoutBlock(fakeCtx(), block('title', 'Hi'), FRAME, st).fontPx).toBeCloseTo(FRAME.height * 0.075 * 2, 6);
    expect(layoutBlock(fakeCtx(), block('credits', 'Hi'), FRAME, st).fontPx).toBeCloseTo(FRAME.height * 0.04 * 0.5, 6);
    expect(layoutBlock(fakeCtx(), block('lyric', 'Hi'), FRAME, st).fontPx).toBeCloseTo(FRAME.height * 0.05 * 0.9, 6);
  });

  it('the canvas is drawn with the part\'s own font string (what the PNG and preview both use)', () => {
    const fonts: string[] = [];
    const ctx = {
      ...fakeCtx(),
      save() {}, restore() {}, strokeText() {}, fillText() {},
      set font(f: string) { fonts.push(f); }, get font() { return fonts.at(-1) ?? ''; },
    } as unknown as CanvasRenderingContext2D;
    drawBlock(ctx, block('title', 'Hi'), FRAME, withTracks({ title: { tamilFont: 'arima', englishFont: 'montserrat', size: 1.5 } }));
    expect(fonts.at(-1)).toBe(`700 ${FRAME.height * 0.075 * 1.5}px '__montserrat', '__arima', "Noto Sans", sans-serif`);
  });

  it('ensureFonts loads each chosen family on its own, with a Tamil or Latin sample', async () => {
    const load = jest.fn(async () => []);
    const check = jest.fn(() => true);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load, check } });
    await ensureFonts(withTracks({ title: { tamilFont: 'arima', englishFont: 'playfair-display' }, credits: { tamilFont: 'kavivanar' } }));
    const calls = load.mock.calls.map((c) => (c as unknown as [string, string]).join(' | '));
    expect(calls).toEqual(expect.arrayContaining([
      "700 32px '__arima' | அ",
      "700 32px '__playfair' | Ag",
      "400 32px '__kavivanar' | அ",
      "700 32px '__noto_sans_tamil' | அ",
    ]));
    expect(calls).toHaveLength(4); // each family once
  });

  it('a chosen font that failed to load stops Make video with its name', async () => {
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load: jest.fn(async () => []), check: (f: string) => !f.includes('__playfair') },
    });
    await expect(ensureFonts(withTracks({ lyric: { englishFont: 'playfair-display' } }))).rejects.toThrow(
      'The English font (Playfair Display) did not load — reload the page and try again.',
    );
  });

  it('a chosen font not defined on the page is an error, never a silent fallback', async () => {
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load: jest.fn(async () => []), check: () => true } });
    await expect(ensureFonts(withTracks({ title: { tamilFont: 'mukta-malar' } }))).rejects.toThrow(
      'The Tamil font (Mukta Malar) did not load — reload the page and try again.',
    );
  });
});

it('ensureFonts checks only the real face, not next/font\'s Arial-based fallback (missing on Linux/Android)', async () => {
  document.documentElement.style.setProperty('--font-tamil', "'notoSansTamil', 'notoSansTamil Fallback'");
  const load = jest.fn(async () => []);
  // The browser reports false for any list that includes the errored fallback face.
  const check = jest.fn((f: string) => !f.includes('Fallback'));
  Object.defineProperty(document, 'fonts', { configurable: true, value: { load, check } });
  await expect(ensureFonts()).resolves.toBeUndefined();
  expect(check).toHaveBeenCalledWith("700 32px 'notoSansTamil'", 'அ');
  document.documentElement.style.removeProperty('--font-tamil');
});

describe('colour, box and fade alpha', () => {
  const rec = () => {
    const calls: string[] = [];
    let fill = '';
    const ctx = {
      ...fakeCtx(),
      save() {}, restore() {}, strokeText() {},
      fillText: (t: string) => calls.push(`text:${t}:${fill}`),
      beginPath() {}, fill: () => calls.push(`fill:${fill}`),
      roundRect: (x: number, y: number, w: number, h: number) => calls.push(`box:${Math.round(x)},${Math.round(y)},${Math.round(w)},${Math.round(h)}`),
      rect() {},
      set fillStyle(v: string) { fill = v; }, get fillStyle() { return fill; },
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D & { globalAlpha: number };
    return { ctx, calls };
  };

  it('draws in the part\'s colour; white when none is set (old projects)', () => {
    const a = rec();
    drawBlock(a.ctx, block('title', 'Hi'), FRAME, STYLE);
    expect(a.calls).toEqual(['text:Hi:#ffffff']);
    const b = rec();
    drawBlock(b.ctx, block('title', 'Hi'), FRAME, { ...STYLE, tracks: { title: { color: 'gold' } } });
    expect(b.calls).toEqual(['text:Hi:#f2c267']);
  });

  it('draws the dim box behind the lines first, around the measured text, inside the frame', () => {
    const r = rec();
    drawBlock(r.ctx, block('lyric', 'hello'), FRAME, { ...STYLE, tracks: { lyric: { box: true } } });
    expect(r.calls[1]).toBe('fill:rgba(0,0,0,0.5)');
    expect(r.calls[2]).toMatch(/^text:hello:/);
    const [x, y, w, h] = r.calls[0].replace('box:', '').split(',').map(Number);
    const l = layoutBlock(fakeCtx(), block('lyric', 'hello'), FRAME, STYLE);
    // 5 chars × 10 px wide (fake), centred, plus stroke and 0.4 em padding each side.
    expect(w).toBeCloseTo(50 + l.fontPx * 0.12 + 2 * 0.4 * l.fontPx, -1);
    expect(x + w / 2).toBeCloseTo(FRAME.width / 2, -1);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y + h).toBeLessThanOrEqual(FRAME.height);
  });

  it('no box unless asked', () => {
    const r = rec();
    drawBlock(r.ctx, block('lyric', 'hello'), FRAME, STYLE);
    expect(r.calls.some((c) => c.startsWith('box:'))).toBe(false);
  });

  it('always draws fully opaque (fades are applied to the finished image, not per stroke)', () => {
    const r = rec();
    drawBlock(r.ctx, block('title', 'Hi'), FRAME, STYLE);
    expect((r.ctx as unknown as { globalAlpha: number }).globalAlpha).toBe(1);
  });
});

describe('Google fonts in the drawing', () => {
  const st = (tracks: TextStyle['tracks']): TextStyle => ({ ...STYLE, tracks });
  it('a Google font draws under its own family, English before Tamil, at the Tamil font\'s weight', () => {
    const out = fontStackFor('title', st({ title: { tamilFont: 'g:Pavanam', englishFont: 'g:Lobster' } }));
    expect(out).toEqual({ stack: '"vt-g-latin-lobster", "vt-g-tamil-pavanam", "Noto Sans", sans-serif', weight: 400 });
  });

  it('ensureFonts loads the Google font first, then checks that face', async () => {
    const spy = loadGoogleFont.mockResolvedValueOnce('"vt-g-latin-lobster"');
    const check = jest.fn(() => true);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load: jest.fn(async () => []), check } });
    document.documentElement.style.setProperty('--font-tamil', "'__noto'");
    await ensureFonts(st({ lyric: { englishFont: 'g:Lobster' } }));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ family: 'Lobster' }), 'latin');
    expect(check).toHaveBeenCalledWith('400 32px "vt-g-latin-lobster"', 'Ag');
    document.documentElement.style.removeProperty('--font-tamil');
  });

  it('a Google font that will not load stops Make video with its name', async () => {
    loadGoogleFont.mockRejectedValueOnce(new Error('offline'));
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load: jest.fn(async () => []), check: () => true } });
    await expect(ensureFonts(st({ credits: { tamilFont: 'g:Pavanam' } }))).rejects.toThrow(
      'The Tamil font (Pavanam) did not load from Google Fonts — check the connection and try again.',
    );
  });
});

describe('size as % of the video height, and moving by hand', () => {
  const withTrack = (track: TextBlock['track'], own: Record<string, unknown>): TextStyle => ({ ...STYLE, tracks: { [track]: own } });
  it('heightPct is the letter size as a share of the video height, 1% to 100%', () => {
    expect(layoutBlock(fakeCtx(), block('lyric', 'Hi'), FRAME, withTrack('lyric', { heightPct: 1 })).fontPx).toBeCloseTo(10.8, 6);
    expect(layoutBlock(fakeCtx(), block('title', 'Hi'), FRAME, withTrack('title', { heightPct: 100 })).fontPx).toBeCloseTo(1080, 6);
  });
  it('an older save (size multiplier) draws exactly as before', () => {
    expect(layoutBlock(fakeCtx(), block('title', 'Hi'), FRAME, withTrack('title', { size: 1.05 })).fontPx).toBeCloseTo(1080 * 0.075 * 1.05, 9);
    expect(layoutBlock(fakeCtx(), block('lyric', 'Hi'), FRAME, STYLE).fontPx).toBeCloseTo(54, 9);
  });
  it('heightPct wins over an older size multiplier', () => {
    expect(layoutBlock(fakeCtx(), block('lyric', 'Hi'), FRAME, withTrack('lyric', { size: 2, heightPct: 3 })).fontPx).toBeCloseTo(32.4, 6);
  });
  it('an offset moves the text from its alignment by a share of the frame, nothing else changes', () => {
    const aligned = layoutBlock(fakeCtx(), block('credits', 'a\nb'), FRAME, STYLE);
    const moved = layoutBlock(fakeCtx(), block('credits', 'a\nb'), FRAME, withTrack('credits', { offset: { x: 0.1, y: -0.25 } }));
    expect(moved.x).toBeCloseTo(aligned.x + 192, 6);
    expect(moved.yBaseline.map((y, i) => y - aligned.yBaseline[i])).toEqual([-270, -270]);
    expect({ ...moved, x: 0, yBaseline: [] }).toEqual({ ...aligned, x: 0, yBaseline: [] });
  });
  it('an offset of 0,0 is exactly the alignment', () => {
    const aligned = layoutBlock(fakeCtx(), block('lyric', 'hello'), FRAME, STYLE);
    expect(layoutBlock(fakeCtx(), block('lyric', 'hello'), FRAME, withTrack('lyric', { offset: { x: 0, y: 0 } }))).toEqual(aligned);
  });
});
