/** @jest-environment node */
/**
 * loudness-match — the gain math behind a fair A/B. If this is wrong the
 * comparison lies (louder-sounds-better), so it is worth pinning precisely.
 */

import { dbToGain, matchGains, formatClock } from '@/lib/loudness-match';

describe('dbToGain', () => {
  it('0 dB is unity', () => expect(dbToGain(0)).toBeCloseTo(1, 6));
  it('-6 dB ~halves amplitude', () => expect(dbToGain(-6)).toBeCloseTo(0.501, 3));
  it('-20 dB is a tenth', () => expect(dbToGain(-20)).toBeCloseTo(0.1, 6));
});

describe('matchGains', () => {
  it('pulls both toward the quieter track — neither gain exceeds 1', () => {
    // master (-14) louder than source (-17.9): the master must be turned DOWN,
    // the source left at unity. Boosting the source instead could clip.
    const g = matchGains(-17.9, -14)!;
    expect(g.referenceLufs).toBe(-17.9);
    expect(g.source).toBeCloseTo(1, 6);
    expect(g.master).toBeCloseTo(dbToGain(-17.9 - -14), 6); // ~0.64
    expect(g.master).toBeLessThan(1);
  });

  it('is symmetric when the source is the louder one', () => {
    const g = matchGains(-12, -16)!;
    expect(g.referenceLufs).toBe(-16);
    expect(g.master).toBeCloseTo(1, 6);
    expect(g.source).toBeLessThan(1);
  });

  it('equal loudness leaves both at unity', () => {
    const g = matchGains(-14, -14)!;
    expect(g.source).toBeCloseTo(1, 6);
    expect(g.master).toBeCloseTo(1, 6);
  });

  it('never boosts above unity for any pair', () => {
    for (const [b, a] of [[-30, -14], [-14, -30], [-8, -23], [-16, -16]] as const) {
      const g = matchGains(b, a)!;
      expect(g.source).toBeLessThanOrEqual(1 + 1e-9);
      expect(g.master).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('returns null when a measurement is missing — matching then unavailable', () => {
    expect(matchGains(null, -14)).toBeNull();
    expect(matchGains(-14, null)).toBeNull();
    expect(matchGains(NaN, -14)).toBeNull();
    expect(matchGains(-14, Infinity)).toBeNull();
  });
});

describe('formatClock', () => {
  it('formats mm:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(9)).toBe('0:09');
    expect(formatClock(75)).toBe('1:15');
    expect(formatClock(419.36)).toBe('6:59');
  });
  it('clamps junk to 0:00', () => {
    expect(formatClock(-5)).toBe('0:00');
    expect(formatClock(NaN)).toBe('0:00');
    expect(formatClock(Infinity)).toBe('0:00');
  });
});
