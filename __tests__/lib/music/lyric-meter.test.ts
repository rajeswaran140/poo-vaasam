/** @jest-environment node */
/**
 * Lyric Meter Lab analysis.
 *
 * Two guarantees dominate: a word is never split, and an inferred meter is
 * never presented as a finding. Both are things the code could plausibly get
 * wrong in a way that looks fine on screen.
 */

import {
  planLine,
  splitPhrases,
  readDensity,
  suggestMeter,
} from '@/lib/music/lyric-meter';
import { syllabify } from '@/lib/tamil-prosody';
import { METERS, meterById } from '@/lib/music/meter';

const LINE = 'மழை பெய்தால் மண் வாசம்';
const m34 = meterById('3/4')!;
const m44 = meterById('4/4')!;
const m68 = meterById('6/8')!;

describe('syllabify', () => {
  it('attaches a closing மெய் to the syllable it closes', () => {
    // மண் is ONE syllable — ம + ண் — because that is what a singer sings.
    const s = syllabify('மண்');
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ text: 'மண்', open: false, vowel: 'short' });
  });

  it('marks a long open vowel as sustainable material', () => {
    const s = syllabify('வாசம்');
    expect(s.map((x) => x.text)).toEqual(['வா', 'சம்']);
    expect(s[0]).toMatchObject({ vowel: 'long', open: true });
    expect(s[1]).toMatchObject({ open: false });
  });

  it('agrees with countSyllables on the whole line', () => {
    const perWord = LINE.split(' ').reduce((n, w) => n + syllabify(w).length, 0);
    expect(perWord).toBe(planLine(LINE).syllableCount);
  });
});

describe('planLine', () => {
  it('breaks the line into words without altering them', () => {
    const plan = planLine(LINE);
    expect(plan.words.map((w) => w.text)).toEqual(['மழை', 'பெய்தால்', 'மண்', 'வாசம்']);
  });

  it('counts syllables per word', () => {
    const plan = planLine(LINE);
    expect(plan.words.map((w) => w.syllableCount)).toEqual([2, 2, 1, 2]);
    expect(plan.syllableCount).toBe(7);
  });

  /** The spec's example: பெய்தால் and வாசம் as sustain candidates. */
  it('identifies words the singer can hold — open long final vowel', () => {
    const plan = planLine('வாசம் வா');
    expect(plan.words.find((w) => w.text === 'வா')!.sustainable).toBe(true);
    // வாசம் ends in a closing மெய், so the note is clipped.
    expect(plan.words.find((w) => w.text === 'வாசம்')!.sustainable).toBe(false);
  });

  it('survives empty and whitespace input', () => {
    expect(planLine('').words).toEqual([]);
    expect(planLine('   ').syllableCount).toBe(0);
  });
});

/** ⚠️ A word must never be split to make a phrase come out even. */
describe('splitPhrases', () => {
  it('splits on a word boundary, keeping every word whole', () => {
    const phrases = splitPhrases(planLine(LINE));
    expect(phrases).toHaveLength(2);
    const rejoined = phrases.flatMap((p) => p.words.map((w) => w.text));
    expect(rejoined).toEqual(['மழை', 'பெய்தால்', 'மண்', 'வாசம்']);
  });

  it('never loses or duplicates a word', () => {
    for (const count of [2, 3, 4]) {
      const phrases = splitPhrases(planLine(LINE), count);
      expect(phrases.flatMap((p) => p.words.map((w) => w.text)).join(' ')).toBe(LINE);
    }
  });

  it('never produces an empty phrase', () => {
    for (const count of [2, 3, 4]) {
      for (const p of splitPhrases(planLine(LINE), count)) {
        expect(p.words.length).toBeGreaterThan(0);
      }
    }
  });

  it('returns a single phrase when there are too few words to divide', () => {
    expect(splitPhrases(planLine('வாசம்'), 2)).toHaveLength(1);
  });

  it('labels phrases A, B, …', () => {
    expect(splitPhrases(planLine(LINE)).map((p) => p.label)).toEqual(['Phrase A', 'Phrase B']);
  });
});

describe('readDensity', () => {
  it('calls a short line at a slow tempo sparse', () => {
    expect(readDensity(planLine('வா'), 60, m44).verdict).toBe('sparse');
  });

  it('warns when a line is too dense to pronounce, and says not to break words', () => {
    const crowded = planLine('மழை பெய்தால் மண் வாசம் மழை பெய்தால் மண் வாசம் மழை பெய்தால்');
    const reading = readDensity(crowded, 200, m44);
    expect(reading.verdict).toBe('rushed');
    expect(reading.message).toMatch(/do not break the words/i);
  });

  it('measures per SECOND, so the same line changes verdict with tempo', () => {
    const plan = planLine(LINE);
    const slow = readDensity(plan, 40, m44);
    const fast = readDensity(plan, 200, m44);
    expect(fast.syllablesPerSecond).toBeGreaterThan(slow.syllablesPerSecond);
  });

  it('does not divide by zero on an empty line', () => {
    expect(readDensity(planLine(''), 90, m44).syllablesPerSecond).toBe(0);
  });
});

/**
 * ⚠️ THE HONESTY RULE. Text carries no rhythm. Every output of `suggestMeter`
 * must be marked as a suggestion, must explain itself, and must name the other
 * meters that fit — a bare "Meter: 6/8" would read as an analysis result.
 */
describe('suggestMeter', () => {
  it('always marks its output as suggested, never as determined', () => {
    const s = suggestMeter(planLine(LINE), METERS)!;
    expect(s.source).toBe('suggested');
  });

  it('never claims high confidence', () => {
    for (const line of ['வா', LINE, 'மழை பெய்தால் மண் வாசம் மணம்']) {
      const s = suggestMeter(planLine(line), METERS);
      if (s) expect(['low', 'medium']).toContain(s.confidence);
    }
  });

  it('always explains itself', () => {
    expect(suggestMeter(planLine(LINE), METERS)!.reasoning.length).toBeGreaterThan(20);
  });

  /**
   * Six syllables divide evenly into BOTH 3/4 and 6/8. Naming one without the
   * other would hide the exact ambiguity the spec warns about.
   */
  it('names the alternatives when more than one meter fits', () => {
    const six = planLine('மழை பெய்தால் மண்ணில்'); // 6 syllables
    expect(six.syllableCount).toBe(6);
    const s = suggestMeter(six, METERS)!;
    expect(s.alternatives.length).toBeGreaterThan(0);
    expect(s.confidence).toBe('low');
    expect(s.reasoning).toMatch(/more than one meter|the tune decides/i);
  });

  it('returns null for an empty line rather than inventing a meter', () => {
    expect(suggestMeter(planLine(''), METERS)).toBeNull();
  });

  it('is deterministic', () => {
    expect(suggestMeter(planLine(LINE), METERS)).toEqual(suggestMeter(planLine(LINE), METERS));
  });

  it('suggests a real meter from the supplied list, never an invented id', () => {
    const s = suggestMeter(planLine(LINE), METERS)!;
    expect(METERS.map((m) => m.id)).toContain(s.meterId);
    expect([m34.id, m44.id, m68.id]).toContain(s.meterId);
  });
});
