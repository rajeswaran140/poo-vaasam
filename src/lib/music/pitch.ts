/**
 * Pitch — notes, frequencies, and the swara↔Western relationship.
 *
 * Pure and deterministic: no audio, no I/O. The audio engine turns a frequency
 * into sound; this decides what the frequency IS.
 *
 * ⚠️ THE RULE THIS FILE EXISTS TO ENFORCE: **Sa is not C.**
 *
 * Sa is wherever the singer's tonic (சுருதி) is. It is a RELATIONSHIP — the
 * first degree of whatever key you have chosen — while C is an absolute pitch
 * (261.63 Hz in the fourth octave, always). Teaching "Sa = C, Ri = D, Ga = E"
 * is the single most common way a beginner is misled, because it works exactly
 * until the singer's tonic moves, which for a Tamil vocalist is constantly.
 *
 * So every swara name here is computed from an INTERVAL above a supplied tonic
 * (`swaraFor(midi, tonicMidi)`), and there is deliberately no constant anywhere
 * in this module mapping a swara to a fixed letter. If you find yourself
 * wanting one, the caller has forgotten to ask which tonic is in force.
 */

/** A4 = 440 Hz, twelve-tone equal temperament. MIDI 69 is A4. */
export const A4_MIDI = 69;
export const A4_HZ = 440;

/** MIDI note number → frequency in Hz. */
export function midiToFrequency(midi: number): number {
  return A4_HZ * Math.pow(2, (midi - A4_MIDI) / 12);
}

/**
 * Western note names. Sharps are the display default; the flat spelling of the
 * same key is kept alongside because chord and scale work needs both (a piece
 * in D♭ does not call it C♯), and showing one only makes the other look wrong.
 */
export const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

/** Pitch class (0-11, C=0) of a MIDI note. Negative-safe. */
export function pitchClass(midi: number): PitchClass {
  return (((midi % 12) + 12) % 12) as PitchClass;
}

/** Scientific pitch notation: MIDI 60 → "C4". */
export function noteName(midi: number, flats = false): string {
  const names = flats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;
  return `${names[pitchClass(midi)]}${octaveOf(midi)}`;
}

/** Octave number in scientific pitch notation (C4 = middle C = MIDI 60). */
export function octaveOf(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

/** MIDI number for a note name + octave, e.g. ("C", 4) → 60. Null if unknown. */
export function midiFor(name: string, octave: number): number | null {
  const norm = name.trim().replace('♯', '#').replace('♭', 'b');
  const idx = NOTE_NAMES_SHARP.indexOf(norm as never);
  const flatIdx = NOTE_NAMES_FLAT.indexOf(norm as never);
  const pc = idx >= 0 ? idx : flatIdx;
  if (pc < 0) return null;
  return (octave + 1) * 12 + pc;
}

// ---------------------------------------------------------------------------
// Swara — always relative to a tonic.
// ---------------------------------------------------------------------------

export interface Swara {
  /** Short label, e.g. "S", "R2", "M1". */
  short: string;
  /** Tamil/Sanskrit name as sung, e.g. "ஸ", "ரி". */
  tamil: string;
  /** The alternate name for this same interval, where the tradition has one. */
  alternate?: string;
}

interface SwaraName {
  short: string;
  tamil: string;
}

/**
 * The twelve swarasthānas (positions), by SEMITONES ABOVE THE TONIC.
 *
 * Four positions carry TWO names — the same pitch is called Ri2 or Ga1
 * depending on which raga is in force, because the naming follows the scale's
 * DEGREE rather than the pitch alone. Both are listed; which one applies is
 * decided per-scale by `sargamForScale`.
 */
const SWARASTHANA_NAMES: readonly (readonly SwaraName[])[] = [
  [{ short: 'S', tamil: 'ஸ' }],
  [{ short: 'R1', tamil: 'ரி₁' }],
  [{ short: 'R2', tamil: 'ரி₂' }, { short: 'G1', tamil: 'க₁' }],
  [{ short: 'R3', tamil: 'ரி₃' }, { short: 'G2', tamil: 'க₂' }],
  [{ short: 'G3', tamil: 'க₃' }],
  [{ short: 'M1', tamil: 'ம₁' }],
  [{ short: 'M2', tamil: 'ம₂' }],
  [{ short: 'P', tamil: 'ப' }],
  [{ short: 'D1', tamil: 'த₁' }],
  [{ short: 'D2', tamil: 'த₂' }, { short: 'N1', tamil: 'நி₁' }],
  [{ short: 'D3', tamil: 'த₃' }, { short: 'N2', tamil: 'நி₂' }],
  [{ short: 'N3', tamil: 'நி₃' }],
];

function swaraAt(position: number, choice = 0): Swara {
  const names = SWARASTHANA_NAMES[position];
  const picked = names[choice] ?? names[0];
  const other = names.find((n) => n !== picked);
  return { short: picked.short, tamil: picked.tamil, alternate: other?.short };
}

/**
 * Which swara POSITION a note occupies, GIVEN the tonic. This is the only way
 * this module will name a note in isolation — pass the tonic in force.
 *
 * With tonic C, MIDI 60 is Sa. With tonic G, MIDI 60 is Ma1. Same note, and the
 * difference is the entire point.
 *
 * ⚠️ This names a POSITION, not a scale degree. Ask `sargamForScale` when a
 * scale is in force — see the note there for why the two differ.
 */
export function swaraFor(midi: number, tonicMidi: number): Swara {
  return swaraAt(pitchClass(midi - tonicMidi));
}

/** Letter order a sargam ascends through: S R G M P D N, each used once. */
const LETTER_RANK: Record<string, number> = { S: 0, R: 1, G: 2, M: 3, P: 4, D: 5, N: 6 };

/**
 * The sargam of a SCALE — the "Sa Ri Ga Ma Pa Da Ni" a learner actually sings.
 *
 * ⚠️ WHY THIS IS NOT JUST `swaraFor` PER NOTE. A position's default name is not
 * always its name inside a given scale. Three semitones above Sa is Ri3 in a
 * scale that already reads two semitones as Ri1 — but in Kharaharapriya, where
 * two semitones is Ri2, the same pitch is GA (Ga2). Naming each note in
 * isolation produces "S R2 R3 M1 P D2 D3": two Ri's, two Da's, no Ga and no Ni,
 * which is not a scale anyone can sing.
 *
 * A sargam ascends S→R→G→M→P→D→N using each letter at most once, so the names
 * are chosen as a SEQUENCE: at each degree take the lowest-lettered candidate
 * still greater than the previous one. Where no such assignment exists (not a
 * well-formed scale), fall back to position names rather than inventing one.
 */
export function sargamForScale(scaleOffsets: readonly number[]): Swara[] {
  const solve = (i: number, minRank: number): number[] | null => {
    if (i >= scaleOffsets.length) return [];
    const position = pitchClass(scaleOffsets[i]);
    const candidates = SWARASTHANA_NAMES[position];
    for (let choice = 0; choice < candidates.length; choice++) {
      const rank = LETTER_RANK[candidates[choice].short[0]];
      if (rank < minRank) continue;
      const rest = solve(i + 1, rank + 1);
      if (rest) return [choice, ...rest];
    }
    return null;
  };
  const choices = solve(0, 0);
  return scaleOffsets.map((o, i) => swaraAt(pitchClass(o), choices ? choices[i] : 0));
}

/**
 * The sargam of a scale from a tonic. The NAMES do not depend on the tonic —
 * that is what makes them relative — so this is `sargamForScale` with the tonic
 * accepted for call-site clarity.
 */
export function sargamFor(scaleOffsets: readonly number[], _tonicMidi?: number): Swara[] {
  return sargamForScale(scaleOffsets);
}

// ---------------------------------------------------------------------------
// Keyboard geometry
// ---------------------------------------------------------------------------

/** Pitch classes that are black keys. */
const BLACK = new Set([1, 3, 6, 8, 10]);

export function isBlackKey(midi: number): boolean {
  return BLACK.has(pitchClass(midi));
}

export interface KeyboardKey {
  midi: number;
  name: string;
  black: boolean;
  /** Position index among WHITE keys only — black keys sit between two whites. */
  whiteIndex: number;
}

/**
 * Build a keyboard spanning `octaves` starting at `startMidi`.
 *
 * `whiteIndex` is what the UI positions on: white keys tile left-to-right and
 * black keys are absolutely placed against the white before them, which is the
 * only layout that stays correct at every octave boundary (there is no black
 * key between E–F or B–C, so evenly spacing twelve keys would be wrong).
 */
export function buildKeyboard(startMidi: number, octaves: number): KeyboardKey[] {
  const keys: KeyboardKey[] = [];
  let whiteIndex = 0;
  for (let i = 0; i <= octaves * 12; i++) {
    const midi = startMidi + i;
    const black = isBlackKey(midi);
    // A keyboard starting ON a black note has no white key before it to anchor
    // to; clamp to 0 so it renders at the left edge instead of off-canvas.
    keys.push({ midi, name: noteName(midi), black, whiteIndex: black ? Math.max(0, whiteIndex - 1) : whiteIndex });
    if (!black) whiteIndex++;
  }
  return keys;
}

/** Count of white keys in a keyboard — the width unit the UI lays out against. */
export function whiteKeyCount(keys: readonly KeyboardKey[]): number {
  return keys.filter((k) => !k.black).length;
}

// ---------------------------------------------------------------------------
// Scales
// ---------------------------------------------------------------------------

export interface ScaleDefinition {
  id: string;
  name: string;
  tamil?: string;
  /** Semitones above the tonic, ascending, starting at 0. */
  offsets: readonly number[];
  note?: string;
  /**
   * This entry names a RAGA, so `RAGA_VS_SCALE_NOTE` must be shown beside it.
   * Declared per-scale rather than sniffed from the name: a regex over spellings
   * silently drops the caveat for Kalyani, Hamsadhwani or Revati, and that
   * caveat is the whole point of listing raga names next to scales.
   */
  isRaga?: boolean;
}

/**
 * A small, honest starter set. Major and natural minor are the Western
 * fundamentals the spec asks for; Shankarabharanam and Kharaharapriya are
 * listed because a Tamil songwriter meets those names first — with the caveat
 * that a melakarta is NOT merely a scale (see `RAGA_VS_SCALE_NOTE`).
 */
export const SCALES: readonly ScaleDefinition[] = [
  { id: 'major', name: 'Major', offsets: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'natural-minor', name: 'Natural minor', offsets: [0, 2, 3, 5, 7, 8, 10] },
  {
    id: 'shankarabharanam',
    name: 'Shankarabharanam',
    tamil: 'சங்கராபரணம்',
    offsets: [0, 2, 4, 5, 7, 9, 11],
    isRaga: true,
    note: 'The same seven positions as the major scale. The raga is not the same thing as the scale — see below.',
  },
  {
    id: 'kharaharapriya',
    name: 'Kharaharapriya',
    tamil: 'கரஹரப்ரியா',
    offsets: [0, 2, 3, 5, 7, 9, 10],
    isRaga: true,
    note: 'Shares its positions with the Dorian mode.',
  },
  {
    id: 'mohanam',
    name: 'Mohanam',
    tamil: 'மோகனம்',
    offsets: [0, 2, 4, 7, 9],
    isRaga: true,
    note: 'Five notes — no Ma, no Ni.',
  },
];

/**
 * ⚠️ Shown wherever a raga name appears next to a scale. A raga is not a scale:
 * it carries characteristic phrases, ornaments, and rules about approach and
 * emphasis that a list of pitches cannot express. Two ragas can share every
 * note and remain unmistakably different.
 */
export const RAGA_VS_SCALE_NOTE =
  'A raga is not a scale. It has characteristic phrases, ornaments (gamaka), and rules about how notes are approached and stressed. Two ragas can share the same notes and still be entirely different — the scale is only the raw material.';

/** MIDI notes of a scale from a tonic, ascending, inclusive of the upper Sa. */
export function scaleNotes(scale: ScaleDefinition, tonicMidi: number): number[] {
  return [...scale.offsets.map((o) => tonicMidi + o), tonicMidi + 12];
}

/** Is this note in the scale, in any octave? */
export function isInScale(midi: number, scale: ScaleDefinition, tonicMidi: number): boolean {
  return scale.offsets.includes(pitchClass(midi - tonicMidi));
}
