import { buildFreezeFrameArgs, fitFreezeToDuration, frameAt, freezeAt, lastFrame, seekTimeFor, validateFreeze } from '@/lib/video-text/freeze';

describe('frames', () => {
  it('the frame showing at a time is floored, not rounded', () => {
    expect(frameAt(14.999, 25)).toBe(374); // still the last frame of a 15 s loop
    expect(frameAt(15, 25)).toBe(375); // the loop's first frame again
    expect(frameAt(14.96, 25)).toBe(374);
    expect(frameAt(1 / 30 * 7, 30)).toBe(7); // float noise on an exact frame start
  });
  it('seeks to the middle of a frame so it shows that frame', () => {
    expect(frameAt(seekTimeFor(374, 25), 25)).toBe(374);
    expect(frameAt(seekTimeFor(9, 29.97), 29.97)).toBe(9);
  });
  it('knows the last frame', () => {
    expect(lastFrame(15, 25)).toBe(374);
    expect(lastFrame(10.02, 25)).toBe(250);
  });
});

describe('freezeAt / validate / fit', () => {
  it('freezes on the frame showing at the playhead, never past the last frame', () => {
    expect(freezeAt(14.98, 60, 25)).toEqual({ atSec: 14.96 });
    expect(freezeAt(99, 60, 25)).toEqual({ atSec: 59.96 });
    expect(freezeAt(0, 60, 25)).toEqual({ atSec: 0 });
  });
  it('validates against the stored length', () => {
    expect(validateFreeze(null, 60)).toBeNull();
    expect(validateFreeze({ atSec: 59.96 }, 60)).toBeNull();
    expect(validateFreeze({ atSec: 60 }, 60)).toMatch(/outside the video/);
    expect(validateFreeze({ atSec: -1 }, 60)).toMatch(/outside the video/);
    expect(validateFreeze({ atSec: NaN }, 60)).toMatch(/outside the video/);
  });
  it('a re-upload keeps a freeze that fits (on the new frames), drops one that does not', () => {
    expect(fitFreezeToDuration({ atSec: 14.96 }, 60, 25)).toEqual({ atSec: 14.96 });
    expect(fitFreezeToDuration({ atSec: 14.96 }, 60, 30)).toEqual({ atSec: 14.967 });
    expect(fitFreezeToDuration({ atSec: 70 }, 60, 25)).toBeNull();
    expect(fitFreezeToDuration(null, 60, 25)).toBeNull();
  });
});

it('extracts the frame with an accurate seek half a frame early', () => {
  const a = buildFreezeFrameArgs('/s.mp4', '/f.png', 14.96, 25);
  expect(a.slice(a.indexOf('-ss'), a.indexOf('-ss') + 4)).toEqual(['-ss', '14.940000', '-i', '/s.mp4']);
  expect(a).toEqual(expect.arrayContaining(['-frames:v', '1', '/f.png']));
  expect(buildFreezeFrameArgs('/s.mp4', '/f.png', 0, 25)).toContain('0.000000');
});
