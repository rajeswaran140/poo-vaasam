import { fadeAlphaAt, fadeSecFor, trackStyleOf, FADE_SEC } from '@/lib/video-text/fonts';

describe('fadeAlphaAt (the preview ramp the render matches)', () => {
  const b = { startSec: 10, endSec: 13 };
  it('is 1 throughout a block that does not fade, 0 outside it (half-open)', () => {
    expect(fadeAlphaAt(b, false, 10)).toBe(1);
    expect(fadeAlphaAt(b, false, 12.99)).toBe(1);
    expect(fadeAlphaAt(b, false, 13)).toBe(0);
    expect(fadeAlphaAt(b, false, 9.99)).toBe(0);
  });
  it('ramps linearly over FADE_SEC at each end', () => {
    expect(FADE_SEC).toBe(0.3);
    expect(fadeAlphaAt(b, true, 10)).toBe(0);
    expect(fadeAlphaAt(b, true, 10.15)).toBeCloseTo(0.5, 6);
    expect(fadeAlphaAt(b, true, 11)).toBe(1);
    expect(fadeAlphaAt(b, true, 12.85)).toBeCloseTo(0.5, 6);
  });
  it('a block shorter than two fades fades over half its length', () => {
    const short = { startSec: 1, endSec: 1.5 };
    expect(fadeSecFor(short)).toBe(0.25);
    expect(fadeAlphaAt(short, true, 1.25)).toBeCloseTo(1, 6);
  });
});

describe('trackStyleOf defaults', () => {
  it('old projects: white, no box, no fade', () => {
    expect(trackStyleOf('lyric', { sizeScale: 1, lyricPosition: 'lower' })).toMatchObject({ color: 'white', box: false, fade: false });
  });
});
