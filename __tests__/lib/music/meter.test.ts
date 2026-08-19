/** @jest-environment node */
/**
 * Rhythm & meter.
 *
 * The centre of gravity here is 3/4 vs 6/8. Both span six eighth-notes, both
 * get called "six", and treating them as the same thing is the specific error
 * this module exists to prevent — so most of these tests are about the two
 * producing genuinely different output rather than differently-labelled output.
 */

import {
  METERS,
  meterById,
  accentPattern,
  accentGlyphs,
  countingSyllables,
  pulsesPerBar,
  pulseSeconds,
  barSeconds,
  barTicks,
  clampBpm,
  MIN_BPM,
  MAX_BPM,
  DEFAULT_BPM,
} from '@/lib/music/meter';

const m34 = meterById('3/4')!;
const m44 = meterById('4/4')!;
const m68 = meterById('6/8')!;

describe('3/4 and 6/8 are not the same meter', () => {
  it('both have six pulses per bar — which is why they get confused', () => {
    expect(pulsesPerBar(m34)).toBe(6);
    expect(pulsesPerBar(m68)).toBe(6);
  });

  it('but 3/4 is THREE beats of two and 6/8 is TWO beats of three', () => {
    expect([m34.feltBeats, m34.pulsesPerBeat]).toEqual([3, 2]);
    expect([m68.feltBeats, m68.pulsesPerBeat]).toEqual([2, 3]);
    expect(m34.division).toBe('simple');
    expect(m68.division).toBe('compound');
  });

  /** ⚠️ The audible difference: where the stresses land. */
  it('stresses every 2nd pulse in 3/4 and every 3rd in 6/8', () => {
    expect(accentPattern(m34)).toEqual(['strong', 'weak', 'medium', 'weak', 'medium', 'weak']);
    expect(accentPattern(m68)).toEqual(['strong', 'weak', 'weak', 'medium', 'weak', 'weak']);
    expect(accentPattern(m34)).not.toEqual(accentPattern(m68));
  });

  it('renders the two different click patterns the spec asks for', () => {
    expect(accentGlyphs(m34).join(' ')).toBe('● ○ ● ○ ● ○');
    expect(accentGlyphs(m68).join(' ')).toBe('● ○ ○ ● ○ ○');
  });

  it('counts differently out loud', () => {
    expect(countingSyllables(m34)).toEqual(['1', 'and', '2', 'and', '3', 'and']);
    expect(countingSyllables(m68)).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  /**
   * ⚠️ BPM counts FELT beats. At the same BPM a 6/8 bar is shorter in pulses-
   * per-beat terms: three pulses per beat means the pulses come faster. Getting
   * this wrong makes a 6/8 metronome sound like a rushed 3/4.
   */
  it('spaces pulses by the felt beat, not by the written note value', () => {
    expect(pulseSeconds(60, m34)).toBeCloseTo(0.5); // 1s beat ÷ 2
    expect(pulseSeconds(60, m68)).toBeCloseTo(1 / 3); // 1s beat ÷ 3
  });

  it('gives a 3/4 bar three beats of time and a 6/8 bar two', () => {
    expect(barSeconds(60, m34)).toBeCloseTo(3);
    expect(barSeconds(60, m68)).toBeCloseTo(2);
  });
});

describe('4/4', () => {
  /**
   * ⚠️ REGRESSION. This once returned 'medium' for beats 2, 3 AND 4, making the
   * bar four identical thuds while the module docstring claimed beat 3 was
   * marked as the half-bar. The test NAME described the intent; the assertion
   * pinned the bug. Beat 3 must stand out from beats 2 and 4.
   */
  it('marks beat 3 as the half-bar, so it is not four equal thuds', () => {
    expect(accentPattern(m44)).toEqual(['strong', 'weak', 'weak', 'weak', 'medium', 'weak', 'weak', 'weak']);
    expect(pulsesPerBar(m44)).toBe(8);
  });

  it('distinguishes beat 3 from beats 2 and 4', () => {
    const p = accentPattern(m44);
    const downbeats = [p[0], p[2], p[4], p[6]];
    expect(downbeats).toEqual(['strong', 'weak', 'medium', 'weak']);
    expect(downbeats[2]).not.toBe(downbeats[1]);
  });

  it('renders as two halves rather than four equal thuds', () => {
    expect(accentGlyphs(m44).join(' ')).toBe('● ○ ○ ○ ● ○ ○ ○');
  });

  it('every meter starts its bar on the strongest accent it has', () => {
    for (const m of [m34, m44, m68]) {
      expect(accentPattern(m)[0]).toBe('strong');
      expect(m.beatAccents).toHaveLength(m.feltBeats);
    }
  });
});

describe('barTicks', () => {
  it('labels each pulse with its beat and subdivision', () => {
    const ticks = barTicks(60, m68);
    expect(ticks).toHaveLength(6);
    expect(ticks.map((t) => `${t.beat}.${t.subdivision}`)).toEqual(['1.1', '1.2', '1.3', '2.1', '2.2', '2.3']);
  });

  it('spaces offsets evenly from the start of the bar', () => {
    const ticks = barTicks(120, m34); // beat 0.5s → pulse 0.25s
    expect(ticks.map((t) => t.offsetSeconds)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25]);
  });

  it('starts every bar on a strong pulse', () => {
    for (const meter of METERS) {
      expect(barTicks(90, meter)[0].accent).toBe('strong');
    }
  });
});

describe('clampBpm', () => {
  it('holds the 40-200 range', () => {
    expect(clampBpm(10)).toBe(MIN_BPM);
    expect(clampBpm(5000)).toBe(MAX_BPM);
    expect(clampBpm(96)).toBe(96);
  });

  it('rounds fractional input', () => {
    expect(clampBpm(90.4)).toBe(90);
    expect(clampBpm(89.6)).toBe(90);
  });

  /**
   * Non-finite input falls to the DEFAULT rather than clamping to the maximum.
   * Infinity is not "very fast" — it is invalid input, and no slider can
   * produce it — so answering 200 would invent an intention the user never had.
   */
  it('treats non-finite input as invalid, not as maximum tempo', () => {
    expect(clampBpm(NaN)).toBe(DEFAULT_BPM);
    expect(clampBpm(Infinity)).toBe(DEFAULT_BPM);
    expect(clampBpm(-Infinity)).toBe(DEFAULT_BPM);
  });

  it('never lets a bad tempo produce a zero or negative pulse interval', () => {
    for (const bpm of [NaN, 0, -50, Infinity]) {
      expect(pulseSeconds(bpm, m44)).toBeGreaterThan(0);
    }
  });
});
