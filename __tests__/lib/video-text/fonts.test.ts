import {
  isEnglishFontId, isTamilFontId, tamilFont, englishFont, fadeAlphaAt, fadeSecFor, trackStyleOf, FADE_SEC } from '@/lib/video-text/fonts';

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

describe('Google fonts', () => {
  it('a Tamil slot takes only Google fonts that have Tamil; an English slot only ones with English letters', () => {
    expect(isTamilFontId('g:Pavanam')).toBe(true);
    expect(isTamilFontId('g:Hind Madurai')).toBe(true);
    expect(isTamilFontId('g:Lobster')).toBe(false); // no Tamil letters
    expect(isEnglishFontId('g:Lobster')).toBe(true);
    expect(isEnglishFontId('g:No Such Font')).toBe(false);
    expect(isTamilFontId('arima')).toBe(true); // built-in ones still work
    expect(isEnglishFontId('comic-sans')).toBe(false);
  });

  it('a Google choice carries the font, its own weight, and no CSS variable', () => {
    expect(tamilFont('g:Pavanam')).toMatchObject({ id: 'g:Pavanam', label: 'Pavanam', cssVar: null, weight: 400, google: { family: 'Pavanam', tamil: true } });
    expect(englishFont('g:Hind Madurai')).toMatchObject({ weight: 700, google: { family: 'Hind Madurai' } });
    // An unknown or wrong-script id falls back to the default, as before.
    expect(tamilFont('g:Lobster').id).toBe('noto-sans-tamil');
    expect(englishFont('g:Nope').id).toBe('plain');
  });

  it('trackStyleOf keeps a Google font id as saved', () => {
    const st = trackStyleOf('title', { sizeScale: 1, lyricPosition: 'lower', tracks: { title: { tamilFont: 'g:Pavanam', englishFont: 'g:Lobster' } } });
    expect(st).toMatchObject({ tamilFont: 'g:Pavanam', englishFont: 'g:Lobster' });
  });
});
