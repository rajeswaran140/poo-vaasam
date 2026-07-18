import { parseEbur128Loudness, pickHookWindow, type LoudnessSample } from '@/lib/hook-window';

describe('parseEbur128Loudness', () => {
  it('extracts t + momentary loudness from ffmpeg ebur128 stderr', () => {
    const stderr = [
      '[Parsed_ebur128_0 @ 0x55f] t: 0.10  TARGET:-23 LUFS    M: -36.4 S:-120.7 I: -36.4 LUFS  LRA:  0.0 LU',
      '[Parsed_ebur128_0 @ 0x55f] t: 0.20  TARGET:-23 LUFS    M: -22.1 S: -30.2 I: -25.0 LUFS  LRA:  1.0 LU',
      'size=N/A time=00:00:03 bitrate=N/A',
    ].join('\n');
    expect(parseEbur128Loudness(stderr)).toEqual([
      { t: 0.1, lufs: -36.4 },
      { t: 0.2, lufs: -22.1 },
    ]);
  });

  it('maps -inf (silence) to a floor and ignores non-data lines', () => {
    const stderr = '[Parsed_ebur128_0 @ 0x1] t: 1.00  TARGET:-23 LUFS    M: -inf S: -inf';
    expect(parseEbur128Loudness(stderr)).toEqual([{ t: 1, lufs: -120 }]);
  });

  it('returns [] when there is nothing to parse', () => {
    expect(parseEbur128Loudness('')).toEqual([]);
    expect(parseEbur128Loudness('ffmpeg version 6.0\nno loudness here')).toEqual([]);
  });
});

describe('pickHookWindow', () => {
  // Quiet intro (0–8s), loud chorus (20–30s), medium body elsewhere.
  const build = (): LoudnessSample[] => {
    const s: LoudnessSample[] = [];
    for (let t = 0; t <= 60; t += 1) {
      let lufs = -20; // body
      if (t < 8) lufs = -40; // quiet intro
      else if (t >= 20 && t < 30) lufs = -10; // loud chorus / hook
      s.push({ t, lufs });
    }
    return s;
  };

  it('picks the loudest sustained window (the chorus)', () => {
    const hook = pickHookWindow(build(), { windowSec: 10, minStartSec: 8, totalSec: 60 });
    expect(hook).not.toBeNull();
    expect(hook!.start).toBe(20);
    expect(hook!.end).toBe(30);
    expect(hook!.avgLufs).toBeGreaterThan(-15);
  });

  it('never starts inside the intro it is told to skip', () => {
    // Make the very start loudest; minStart must still exclude it.
    const s: LoudnessSample[] = [];
    for (let t = 0; t <= 60; t += 1) s.push({ t, lufs: t < 5 ? 0 : -20 });
    const hook = pickHookWindow(s, { windowSec: 10, minStartSec: 8, totalSec: 60 });
    expect(hook!.start).toBeGreaterThanOrEqual(8);
  });

  it('keeps the window inside the track (never runs past the end)', () => {
    const hook = pickHookWindow(build(), { windowSec: 10, minStartSec: 8, totalSec: 60 });
    expect(hook!.end).toBeLessThanOrEqual(60);
  });

  it('falls back to the earliest legal start for a track shorter than intro+window', () => {
    const s: LoudnessSample[] = [{ t: 0, lufs: -20 }, { t: 1, lufs: -18 }, { t: 2, lufs: -19 }];
    const hook = pickHookWindow(s, { windowSec: 10, minStartSec: 8, totalSec: 3 });
    expect(hook).not.toBeNull();
    expect(hook!.start).toBe(0);
    expect(hook!.end).toBeLessThanOrEqual(3);
  });

  it('returns null for empty input or a non-positive window', () => {
    expect(pickHookWindow([], { windowSec: 10 })).toBeNull();
    expect(pickHookWindow(build(), { windowSec: 0 })).toBeNull();
  });

  describe('leadInSec (build into the peak)', () => {
    it('defaults to opening exactly on the peak (leadIn 0, back-compat)', () => {
      const hook = pickHookWindow(build(), { windowSec: 10, minStartSec: 8, totalSec: 60 });
      expect(hook!.start).toBe(20);
    });

    it('shifts the start earlier so the clip rises into the hook', () => {
      // Hook onset is 20; a 4s lead-in should open at 16 with the peak ~4s in.
      const hook = pickHookWindow(build(), { windowSec: 10, minStartSec: 8, totalSec: 60, leadInSec: 4 });
      expect(hook!.start).toBe(16);
      expect(hook!.end).toBe(26);
    });

    it('clamps the lead-in so it never reaches back into the skipped intro', () => {
      // Chorus at 10–20; minStart 8; a 6s lead-in would want start=4 but must clamp to 8.
      const s: LoudnessSample[] = [];
      for (let t = 0; t <= 60; t += 1) {
        let lufs = -20;
        if (t < 8) lufs = -40;
        else if (t >= 10 && t < 20) lufs = -10;
        s.push({ t, lufs });
      }
      const hook = pickHookWindow(s, { windowSec: 10, minStartSec: 8, totalSec: 60, leadInSec: 6 });
      expect(hook!.start).toBe(8);
    });
  });
});
