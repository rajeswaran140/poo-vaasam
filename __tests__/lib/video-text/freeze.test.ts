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

describe('audit fixes', () => {
  it('snaps the printed NTSC rates to the real ones', () => {
    const { exactFps } = jest.requireActual('@/lib/video-text/freeze');
    expect(exactFps(23.98)).toBeCloseTo(24000 / 1001, 9);
    expect(exactFps(29.97)).toBeCloseTo(30000 / 1001, 9);
    expect(exactFps(59.94)).toBeCloseTo(60000 / 1001, 9);
    expect(exactFps(25)).toBe(25);
    expect(exactFps(24)).toBe(24);
    expect(exactFps(0)).toBe(25);
  });
  it('at 23.98 fps the frame showing late in a song is counted on the real grid', () => {
    // At 119.98 s the real grid (24000/1001) shows frame 2876 (starts 119.953 s);
    // a 23.98 grid would say 2877 — the next frame, not the one on screen.
    expect(frameAt(119.98, 23.98)).toBe(2876);
    expect(freezeAt(119.98, 300, 23.98)).toEqual({ atSec: 119.953 });
  });
  it('a stored start rounded down to the ms still names its own frame (round, not floor)', () => {
    const { frameOfStart } = jest.requireActual('@/lib/video-text/freeze');
    expect(frameOfStart(0.033, 30)).toBe(1);
    expect(frameOfStart(14.967, 30)).toBe(449);
    expect(frameOfStart(119.995, 23.98)).toBe(2877);
    for (const fps of [24, 30, 60, 29.97, 23.98]) {
      for (let k = 0; k < 2000; k += 7) expect(frameOfStart(freezeAt(seekTimeFor(k, fps), 1e6, fps).atSec, fps)).toBe(k);
    }
  });
  it('freezing the last frame never stores a start equal to the video length', () => {
    for (const [d, fps] of [[2.87, 29.97], [1.46, 23.98]] as const) {
      const f = freezeAt(d, d, fps);
      expect(validateFreeze(f, d)).toBeNull();
    }
  });
});
