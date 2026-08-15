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
  analyzeLyric,
  overrideKey,
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
  it('bands a short line at a slow tempo as low', () => {
    expect(readDensity(planLine('வா'), 60, m44).band).toBe('low');
  });

  /**
   * ⚠️ NOT A VERDICT. The old wording said "rushed", which reads as a finding
   * about the line. The tool cannot see the rests, sustains or instrumental
   * gaps that a melody puts around the words, so it estimates and says so.
   */
  it('hedges a crowded line as an ESTIMATE rather than declaring it rushed', () => {
    const crowded = planLine('மழை பெய்தால் மண் வாசம் மழை பெய்தால் மண் வாசம் மழை பெய்தால்');
    const reading = readDensity(crowded, 200, m44);
    expect(reading.band).toBe('very-high');
    expect(reading.label).toMatch(/^Estimated vocal density/);
    expect(reading.label).not.toMatch(/rushed/i);
    // It names the reasons it might be wrong.
    expect(reading.message).toMatch(/rests, sustains and instrumental gaps/i);
    expect(reading.message).toMatch(/never break the words/i);
  });

  it('measures per SECOND, so the same line changes band with tempo', () => {
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

/**
 * ⚠️ A STANZA IS NOT ONE PHRASE. Measuring a four-line verse as one continuous
 * run reported "30 syllables · 11.3/sec · rushed" for a lyric that sings fine,
 * because it ignored every rest and instrumental response between the lines.
 */
describe('analyzeLyric measures per LINE', () => {
  const STANZA = 'பூபாளம் பாடும் நேரமே\nபுதுக்கோலம் பூணும் வானமே';

  it('splits the lyric into lines and measures each separately', () => {
    const a = analyzeLyric(STANZA, 90, m44);
    expect(a.totalLines).toBe(2);
    expect(a.lines.map((l) => l.plan.syllableCount)).toEqual(a.syllablesPerLine);
    for (const l of a.lines) expect(l.density.syllablesPerSecond).toBeGreaterThan(0);
  });

  it('gives each line a LOWER density than the stanza measured as one run', () => {
    const a = analyzeLyric(STANZA, 90, m44);
    const asOneRun = readDensity(planLine(STANZA.replace('\n', ' ')), 90, m44);
    for (const l of a.lines) {
      expect(l.density.syllablesPerSecond).toBeLessThan(asOneRun.syllablesPerSecond);
    }
  });

  it('summarises the stanza with counts and carries NO stanza-level density', () => {
    const a = analyzeLyric(STANZA, 90, m44);
    expect(a.totalSyllables).toBe(a.syllablesPerLine.reduce((x, y) => x + y, 0));
    expect(a).not.toHaveProperty('density');
  });

  it('ignores blank lines — they are stanza breaks, not lyric lines', () => {
    expect(analyzeLyric('மழை\n\n\nவாசம்', 90, m44).totalLines).toBe(2);
  });

  it('flags an even-length stanza, which IS a real metrical signal', () => {
    // Both lines 4 syllables. (மண் வாசம் is 3, not 4 — மண் is one closed
    // syllable — which is exactly the kind of thing this tool exists to show.)
    expect(analyzeLyric('மழை வாசம்\nமழை வாசம்', 90, m44).evenLines).toBe(true);
    expect(analyzeLyric('மழை வாசம்\nமண் வாசம்', 90, m44).evenLines).toBe(false);
  });

  /** Raj's own couplet: 8 and 9 — close, but not the same line length. */
  it('reports the real per-line spread of a live couplet', () => {
    const a = analyzeLyric('பூபாளம் பாடும் நேரமே\nபுதுக்கோலம் பூணும் வானமே', 90, m44);
    expect(a.syllablesPerLine).toEqual([8, 9]);
    expect(a.totalSyllables).toBe(17);
    expect(a.evenLines).toBe(false);
  });

  it('returns nothing for an empty lyric rather than a zero-syllable line', () => {
    expect(analyzeLyric('   \n  ', 90, m44).totalLines).toBe(0);
  });
});

/** ⚠️ Orthographic parsing is not sung syllabification. */
describe('manual musical phrasing overrides the parser', () => {
  it('uses the manual count for the word, and reports both', () => {
    const plan = planLine('பூமியில்', 0, { [overrideKey(0, 0)]: 2 });
    const w = plan.words[0];
    expect(w.automaticSyllableCount).toBe(3);
    expect(w.syllableCount).toBe(2);
    expect(w.overridden).toBe(true);
  });

  it('feeds the manual count into the line total and therefore the density', () => {
    const withOverride = analyzeLyric('பூமியில்', 90, m44, { [overrideKey(0, 0)]: 6 });
    const without = analyzeLyric('பூமியில்', 90, m44);
    expect(withOverride.totalSyllables).toBe(6);
    expect(withOverride.lines[0].density.syllablesPerSecond).toBeGreaterThan(
      without.lines[0].density.syllablesPerSecond
    );
  });

  it('NEVER alters the word text — it is an annotation, not an edit', () => {
    const plan = planLine('பூமியில்', 0, { [overrideKey(0, 0)]: 2 });
    expect(plan.words[0].text).toBe('பூமியில்');
    expect(plan.text).toBe('பூமியில்');
  });

  it('leaves other words alone', () => {
    const plan = planLine('மழை வாசம்', 0, { [overrideKey(0, 1)]: 5 });
    expect(plan.words[0].overridden).toBe(false);
    expect(plan.words[1].syllableCount).toBe(5);
  });

  it('keys overrides per LINE, so line 2 word 1 is not line 1 word 1', () => {
    const a = analyzeLyric('மழை\nவாசம்', 90, m44, { [overrideKey(1, 0)]: 7 });
    expect(a.lines[0].plan.words[0].overridden).toBe(false);
    expect(a.lines[1].plan.words[0].syllableCount).toBe(7);
  });

  it('ignores a nonsensical override rather than producing a zero-syllable word', () => {
    expect(planLine('மழை', 0, { [overrideKey(0, 0)]: 0 }).words[0].syllableCount).toBe(2);
  });
});

/**
 * ⚠️ 3/4 vs 6/8 differ by ACCENT GROUPING, which text cannot express. When both
 * fit, naming one as "suggested" is misleading — say the count cannot decide.
 */
describe('suggestMeter admits when the count cannot decide', () => {
  it('reports undecidable when the fitting meters group differently', () => {
    const six = planLine('மழை பெய்தால் மண்ணில்'); // 6 syllables → 3/4 AND 6/8
    const s = suggestMeter(six, METERS)!;
    expect(s.undecidable).toBeTruthy();
    expect(s.undecidable).toMatch(/accent grouping/i);
    expect(s.undecidable).toMatch(/every second pulse|every third pulse/i);
    expect(s.confidence).toBe('low');
  });

  it('does NOT mark undecidable when only one meter fits', () => {
    const s = suggestMeter(planLine('மழை பெய்தால் மண் வாசம்'), METERS)!; // 7
    expect(s.undecidable).toBeUndefined();
  });
});
