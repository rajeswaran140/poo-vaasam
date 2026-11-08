import { cutLength, cutRange, fitCutToDuration, markIn, markOut, snapToFrame, validateCut } from '@/lib/video-text/cut';

const D = 60;

describe('snapToFrame', () => {
  it('snaps to the nearest frame start, to 1 ms', () => {
    expect(snapToFrame(13.37, 30)).toBe(13.367);
    expect(snapToFrame(13.37, 10)).toBe(13.4);
    expect(snapToFrame(-2, 25)).toBe(0);
  });
});

describe('markIn / markOut (Premiere rules)', () => {
  it('In alone runs to the end; Out alone starts at 0', () => {
    expect(markIn(null, 10, D, 25)).toEqual({ inSec: 10, outSec: 60 });
    expect(markOut(null, 40, D, 25)).toEqual({ inSec: 0, outSec: 40 });
  });
  it('both marks make the cut, snapped to frames', () => {
    expect(markOut(markIn(null, 10.01, D, 25), 40.03, D, 25)).toEqual({ inSec: 10, outSec: 40.04 });
  });
  it('an In past the Out sends Out back to the end; an Out before the In sends In back to 0', () => {
    expect(markIn({ inSec: 10, outSec: 20 }, 25, D, 25)).toEqual({ inSec: 25, outSec: 60 });
    expect(markOut({ inSec: 30, outSec: 40 }, 20, D, 25)).toEqual({ inSec: 0, outSec: 20 });
  });
  it('marks less than a second apart count as crossing', () => {
    expect(markIn({ inSec: 10, outSec: 20 }, 19.6, D, 25)).toEqual({ inSec: 19.6, outSec: 60 });
  });
  it('In at 0 with Out at the end is no cut', () => {
    expect(markIn({ inSec: 10, outSec: 60 }, 0, D, 25)).toBeNull();
    expect(markOut({ inSec: 0, outSec: 30 }, 60, D, 25)).toBeNull();
    // Within half a frame of the end is the end.
    expect(markOut({ inSec: 5, outSec: 30 }, 59.99, D, 25)).toEqual({ inSec: 5, outSec: 60 });
  });
  it('In cannot go past one second before the end; Out cannot go before one second', () => {
    expect(markIn(null, 59.8, D, 25)).toEqual({ inSec: 59, outSec: 60 });
    expect(markOut(null, 0.2, D, 25)).toEqual({ inSec: 0, outSec: 1 });
  });
});

describe('cutRange / cutLength', () => {
  it('no cut is the whole video', () => {
    expect(cutRange(null, D)).toEqual({ inSec: 0, outSec: 60 });
    expect(cutLength(undefined, D)).toBe(60);
    expect(cutLength({ inSec: 12.5, outSec: 42.5 }, D)).toBe(30);
  });
});

describe('validateCut', () => {
  it('accepts no cut and a cut inside the video', () => {
    expect(validateCut(null, D)).toBeNull();
    expect(validateCut({ inSec: 0, outSec: 60 }, D)).toBeNull();
  });
  it('refuses marks outside the video or under a second apart', () => {
    expect(validateCut({ inSec: 0, outSec: 61 }, D)).toMatch(/outside the video/);
    expect(validateCut({ inSec: -1, outSec: 10 }, D)).toMatch(/outside the video/);
    expect(validateCut({ inSec: Number.NaN, outSec: 10 }, D)).toMatch(/outside the video/);
    expect(validateCut({ inSec: 10, outSec: 10.5 }, D)).toMatch(/at least 1 second/);
  });
});

describe('fitCutToDuration (a re-upload)', () => {
  it('keeps marks that fit, runs an Out past the new end to it, drops an In past it', () => {
    expect(fitCutToDuration({ inSec: 5, outSec: 20 }, 30, 25)).toEqual({ inSec: 5, outSec: 20 });
    expect(fitCutToDuration({ inSec: 5, outSec: 40 }, 30, 25)).toEqual({ inSec: 5, outSec: 30 });
    expect(fitCutToDuration({ inSec: 29.5, outSec: 40 }, 30, 25)).toBeNull();
    expect(fitCutToDuration({ inSec: 0, outSec: 40 }, 30, 25)).toBeNull();
    expect(fitCutToDuration(null, 30, 25)).toBeNull();
  });
});
