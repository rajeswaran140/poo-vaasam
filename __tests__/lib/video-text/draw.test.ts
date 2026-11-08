import {
  SAFE_MARGIN,
  FONT_FAMILY,
  wrapLines,
  layoutBlock,
  placementFor,
  resolveFontFamily,
  ensureFonts,
  renderBlockPng,
} from '@/lib/video-text/draw';
import type { TextBlock, TextStyle } from '@/types/videoText';

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
    expect(order[0]).toBe('load:700 32px ' + FONT_FAMILY);
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
    const l = layoutBlock(fakeCtx(), block('title', 'Hi'), FRAME, STYLE);
    expect(l.align).toBe('center');
    expect(l.x).toBe(FRAME.width / 2);
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
