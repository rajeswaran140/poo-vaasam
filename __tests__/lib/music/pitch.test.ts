/** @jest-environment node */
/**
 * Pitch, swara, keyboard geometry and scales.
 *
 * The claim under most scrutiny here is that **Sa is not C** — that a swara
 * name is only meaningful relative to a chosen tonic. Several of these tests
 * would pass trivially against a hard-coded Sa=C table, so the ones that matter
 * assert the SAME note gets DIFFERENT swara names under different tonics.
 */

import {
  midiToFrequency,
  noteName,
  midiFor,
  octaveOf,
  pitchClass,
  swaraFor,
  sargamFor,
  isBlackKey,
  buildKeyboard,
  whiteKeyCount,
  scaleNotes,
  isInScale,
  SCALES,
  RAGA_VS_SCALE_NOTE,
} from '@/lib/music/pitch';

const C4 = 60;
const G4 = 67;

describe('frequency and naming', () => {
  it('anchors on A4 = 440 Hz', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 6);
  });

  it('doubles frequency per octave', () => {
    expect(midiToFrequency(81)).toBeCloseTo(880, 6);
    expect(midiToFrequency(57)).toBeCloseTo(220, 6);
  });

  it('puts middle C at MIDI 60 = 261.63 Hz', () => {
    expect(midiToFrequency(C4)).toBeCloseTo(261.626, 2);
    expect(noteName(C4)).toBe('C4');
    expect(octaveOf(C4)).toBe(4);
  });

  it('names sharps by default and flats on request', () => {
    expect(noteName(61)).toBe('C#4');
    expect(noteName(61, true)).toBe('Db4');
  });

  it('round-trips a name back to its MIDI number, accepting either spelling', () => {
    expect(midiFor('C', 4)).toBe(60);
    expect(midiFor('C#', 4)).toBe(61);
    expect(midiFor('Db', 4)).toBe(61);
    // Unicode ♯/♭ from a copy-paste normalise to ASCII.
    expect(midiFor('F♯', 3)).toBe(54);
    expect(midiFor('E♭', 4)).toBe(63);
    expect(midiFor('H', 4)).toBeNull();
  });

  it('handles pitch class below zero without going negative', () => {
    expect(pitchClass(-1)).toBe(11);
  });
});

/**
 * ⚠️ THE CENTRAL RULE. Sa is the tonic, wherever the tonic is. A module that
 * hard-coded Sa=C would pass the first test below and fail every other one.
 */
describe('swara is relative to the tonic, never fixed to a letter', () => {
  it('calls the tonic Sa — with tonic C, C is Sa', () => {
    expect(swaraFor(C4, C4).short).toBe('S');
  });

  it('with tonic G, G is Sa and C is NOT', () => {
    expect(swaraFor(G4, G4).short).toBe('S');
    expect(swaraFor(C4, G4).short).not.toBe('S');
  });

  it('gives the SAME note different swara names under different tonics', () => {
    // Middle C is Sa in C, Pa in F, and Ma1 in G. One pitch, three names.
    expect(swaraFor(C4, C4).short).toBe('S');
    expect(swaraFor(C4, midiFor('F', 4)!).short).toBe('P');
    expect(swaraFor(C4, G4).short).toBe('M1');
  });

  it('is octave-agnostic — the swara depends on the interval, not the register', () => {
    expect(swaraFor(C4 + 12, C4).short).toBe('S');
    expect(swaraFor(C4 - 12, C4).short).toBe('S');
  });

  it('names the perfect fifth Pa from any tonic', () => {
    for (const tonic of [60, 61, 65, 67, 70]) {
      expect(swaraFor(tonic + 7, tonic).short).toBe('P');
    }
  });

  it('records the alternate name where one position carries two', () => {
    // Two semitones above Sa is Ri2 — also called Ga1 in ragas that read it so.
    expect(swaraFor(C4 + 2, C4)).toMatchObject({ short: 'R2', alternate: 'G1' });
    // Sa and Pa are unambiguous and carry no alternate.
    expect(swaraFor(C4, C4).alternate).toBeUndefined();
    expect(swaraFor(C4 + 7, C4).alternate).toBeUndefined();
  });

  it('builds the seven-swara ascent for a scale from its tonic', () => {
    const major = SCALES.find((s) => s.id === 'major')!;
    expect(sargamFor(major.offsets, C4).map((s) => s.short)).toEqual(['S', 'R2', 'G3', 'M1', 'P', 'D2', 'N3']);
    // Same sargam from a different tonic — the NAMES do not move, the pitches do.
    expect(sargamFor(major.offsets, G4).map((s) => s.short)).toEqual(['S', 'R2', 'G3', 'M1', 'P', 'D2', 'N3']);
  });
});

describe('keyboard geometry', () => {
  it('knows the black keys', () => {
    expect(isBlackKey(midiFor('C#', 4)!)).toBe(true);
    expect(isBlackKey(C4)).toBe(false);
    expect(isBlackKey(midiFor('E', 4)!)).toBe(false);
    expect(isBlackKey(midiFor('F', 4)!)).toBe(false);
  });

  it('spans one octave inclusive of the upper tonic', () => {
    const keys = buildKeyboard(C4, 1);
    expect(keys).toHaveLength(13);
    expect(keys[0].name).toBe('C4');
    expect(keys[12].name).toBe('C5');
    expect(whiteKeyCount(keys)).toBe(8);
  });

  /**
   * There is no black key between E–F or B–C, so twelve evenly-spaced keys
   * would render a keyboard that is visibly wrong. Black keys anchor to the
   * white key BEFORE them.
   */
  it('anchors each black key to the white key before it', () => {
    const keys = buildKeyboard(C4, 1);
    const byName = Object.fromEntries(keys.map((k) => [k.name, k]));
    expect(byName['C#4'].whiteIndex).toBe(byName['C4'].whiteIndex);
    expect(byName['D#4'].whiteIndex).toBe(byName['D4'].whiteIndex);
    // E and B have no sharp — F follows E directly.
    expect(byName['F4'].whiteIndex).toBe(byName['E4'].whiteIndex + 1);
  });

  it('white indices increase monotonically', () => {
    const whites = buildKeyboard(C4, 2).filter((k) => !k.black);
    expect(whites.map((k) => k.whiteIndex)).toEqual(whites.map((_, i) => i));
  });
});

describe('scales', () => {
  const major = SCALES.find((s) => s.id === 'major')!;
  const minor = SCALES.find((s) => s.id === 'natural-minor')!;

  it('spells the C major scale', () => {
    expect(scaleNotes(major, C4).map((m) => noteName(m))).toEqual([
      'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5',
    ]);
  });

  it('spells the A natural minor scale with no accidentals', () => {
    const a3 = midiFor('A', 3)!;
    expect(scaleNotes(minor, a3).map((m) => noteName(m))).toEqual([
      'A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4',
    ]);
  });

  it('transposes — G major has an F#', () => {
    expect(scaleNotes(major, G4).map((m) => noteName(m))).toContain('F#5');
  });

  it('tests membership in any octave', () => {
    expect(isInScale(midiFor('E', 2)!, major, C4)).toBe(true);
    expect(isInScale(midiFor('C#', 6)!, major, C4)).toBe(false);
  });

  it('keeps a five-note raga at five notes', () => {
    const mohanam = SCALES.find((s) => s.id === 'mohanam')!;
    expect(mohanam.offsets).toHaveLength(5);
    expect(scaleNotes(mohanam, C4).map((m) => noteName(m))).toEqual(['C4', 'D4', 'E4', 'G4', 'A4', 'C5']);
  });

  /**
   * Shankarabharanam has the same seven positions as the major scale. Shipping
   * that equivalence without the caveat would teach exactly the "raga = scale"
   * error the spec warns against.
   */
  it('ships the raga-is-not-a-scale caveat alongside the shared-pitch ragas', () => {
    const shankarabharanam = SCALES.find((s) => s.id === 'shankarabharanam')!;
    expect(shankarabharanam.offsets).toEqual(major.offsets);
    expect(shankarabharanam.note).toBeTruthy();
    expect(RAGA_VS_SCALE_NOTE).toMatch(/not a scale/i);
  });
});
