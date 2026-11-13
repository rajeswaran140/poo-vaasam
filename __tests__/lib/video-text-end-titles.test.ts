import { drawEndTitles, endTitlesAlphaAt, endTitlesAt, endTitlesCutNote, endTitlesSpan, fitEndTitlesToDuration, validateEndTitles, END_LOGO_HEIGHT } from '@/lib/video-text/end-titles';
import { overlaysForSegment } from '@/lib/video-text/render-plan';
import type { TextStyle } from '@/types/videoText';

const STYLE: TextStyle = { sizeScale: 1, lyricPosition: 'lower' };
const FRAME = { width: 1920, height: 1080 };

/** A canvas context that records what is drawn. */
function recorder() {
  const calls: Array<[string, ...unknown[]]> = [];
  const ctx = {
    save: () => calls.push(['save']), restore: () => calls.push(['restore']),
    fillRect: (...a: unknown[]) => calls.push(['fillRect', ...a]),
    drawImage: (...a: unknown[]) => calls.push(['drawImage', ...a]),
    fillText: (...a: unknown[]) => calls.push(['fillText', ...a]),
    strokeText: () => undefined, beginPath: () => undefined, rect: () => undefined, fill: () => undefined,
    measureText: (s: string) => ({ width: s.length * 20 }),
    set fillStyle(v: string) { calls.push(['fillStyle', v]); },
    font: '', textAlign: 'center', textBaseline: 'middle', lineJoin: 'round', lineWidth: 1, strokeStyle: '',
    shadowColor: '', shadowBlur: 0, shadowOffsetY: 0, imageSmoothingQuality: 'high', globalAlpha: 1,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe('validateEndTitles / endTitlesAt', () => {
  it('needs a start inside the video with a second left for the fade', () => {
    expect(validateEndTitles(null, 60)).toBeNull();
    expect(validateEndTitles({ atSec: 50 }, 60)).toBeNull();
    expect(validateEndTitles({ atSec: 59.5 }, 60)).toMatch(/too close to the end/);
    expect(validateEndTitles({ atSec: -1 }, 60)).toMatch(/start time/);
  });
  it('takes the playhead, kept a fade before the end', () => {
    expect(endTitlesAt(50.123, 60)).toEqual({ atSec: 50.12, background: 'black' });
    expect(endTitlesAt(50, 60, 'white')).toEqual({ atSec: 50, background: 'white' });
    expect(endTitlesAt(59.9, 60)).toEqual({ atSec: 59, background: 'black' });
    expect(endTitlesAt(-3, 60)).toEqual({ atSec: 0, background: 'black' });
  });
});

describe('the render layer', () => {
  it('fades in over a second and never fades out inside the video', () => {
    const span = endTitlesSpan({ atSec: 41 }, 45);
    expect(Number.isFinite(span.endSec)).toBe(true); // survives JSON to the chunk workers
    const [o] = overlaysForSegment([span], { startSec: 40, endSec: 45 });
    expect(o).toEqual({ id: '_end', fromSec: 1, toSec: 5, fade: { inAt: 1, outAt: 65, sec: 1 } });
    expect(o.fade!.outAt - o.fade!.sec).toBeGreaterThan(5);
  });
  it('the preview fades in the same way', () => {
    expect(endTitlesAlphaAt({ atSec: 10 }, 9.9)).toBe(0);
    expect(endTitlesAlphaAt({ atSec: 10 }, 10.5)).toBeCloseTo(0.5);
    expect(endTitlesAlphaAt({ atSec: 10 }, 30)).toBe(1);
    expect(endTitlesAlphaAt(null, 30)).toBe(0);
  });
});

describe('drawEndTitles', () => {
  const logo = { width: 400, height: 200 } as unknown as CanvasImageSource & { width: number; height: number };

  it('paints the whole frame black, the logo centred above, the credits under it', () => {
    const { ctx, calls } = recorder();
    drawEndTitles(ctx, FRAME, 'Lyrics: Raj\nMusic: Raj', STYLE, logo);
    const black = calls.findIndex((c) => c[0] === 'fillStyle' && c[1] === '#000000');
    expect(calls[black + 1]).toEqual(['fillRect', 0, 0, 1920, 1080]);
    const img = calls.find((c) => c[0] === 'drawImage')!;
    const [, , x, y, w, h] = img as [string, unknown, number, number, number, number];
    expect(h).toBeCloseTo(1080 * END_LOGO_HEIGHT);
    expect(x + w / 2).toBeCloseTo(960); // centred across
    const texts = calls.filter((c) => c[0] === 'fillText') as Array<[string, string, number, number]>;
    expect(texts.map((t) => t[1])).toEqual(['Lyrics: Raj', 'Music: Raj']);
    for (const t of texts) {
      expect(t[2]).toBeCloseTo(960);
      expect(t[3]).toBeGreaterThan(y + h); // below the logo
    }
  });

  it('on white: a white screen and dark credits, same layout', () => {
    const { ctx, calls } = recorder();
    drawEndTitles(ctx, FRAME, 'Lyrics: Raj', STYLE, logo, 'white');
    const white = calls.findIndex((c) => c[0] === 'fillStyle' && c[1] === '#ffffff');
    expect(calls[white + 1]).toEqual(['fillRect', 0, 0, 1920, 1080]);
    const text = calls.findIndex((c) => c[0] === 'fillText');
    const colours = calls.slice(0, text).filter((c) => c[0] === 'fillStyle').map((c) => c[1]);
    expect(colours[colours.length - 1]).toBe('#1c1c1c');
  });

  it('with no logo the credits sit in the middle; with no credits the logo does', () => {
    const a = recorder();
    drawEndTitles(a.ctx, FRAME, 'Lyrics: Raj', STYLE, null);
    const line = a.calls.find((c) => c[0] === 'fillText') as [string, string, number, number];
    expect(line[3]).toBeCloseTo(540, 0);
    expect(a.calls.some((c) => c[0] === 'drawImage')).toBe(false);

    const b = recorder();
    drawEndTitles(b.ctx, FRAME, '   ', STYLE, logo);
    const [, , , y, , h] = b.calls.find((c) => c[0] === 'drawImage') as [string, unknown, number, number, number, number];
    expect(y + h / 2).toBeCloseTo(540);
    expect(b.calls.some((c) => c[0] === 'fillText')).toBe(false);
  });
});

describe('audit fixes', () => {
  it('Start end titles here never stores a start the server refuses (128.01 s, 64.02 s, 256.01 s videos)', () => {
    for (const d of [128.01, 64.02, 256.01, 60, 246]) {
      const e = endTitlesAt(d, d);
      expect(validateEndTitles(e, d)).toBeNull();
    }
  });
  it('a re-upload keeps end titles that still fit and drops ones past the new end', () => {
    expect(fitEndTitlesToDuration({ atSec: 50, background: 'white' }, 60)).toEqual({ atSec: 50, background: 'white' });
    expect(fitEndTitlesToDuration({ atSec: 50 }, 30)).toBeNull();
    expect(fitEndTitlesToDuration(null, 30)).toBeNull();
  });
  it('says how In and Out change what the export shows', () => {
    const end = { atSec: 50 };
    expect(endTitlesCutNote(end, { inSec: 0, outSec: 60 })).toBeNull();
    expect(endTitlesCutNote(end, { inSec: 0, outSec: 45 })).toMatch(/after Out/);
    expect(endTitlesCutNote(end, { inSec: 0, outSec: 50.5 })).toMatch(/half-faded/);
    expect(endTitlesCutNote(end, { inSec: 52, outSec: 60 })).toMatch(/whole exported part is the end screen/);
  });
});
