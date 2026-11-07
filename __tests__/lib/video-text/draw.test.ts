import {
  SAFE_MARGIN,
  FONT_FAMILY,
  wrapLines,
  layoutBlock,
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
});
