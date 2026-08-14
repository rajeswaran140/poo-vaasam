/** @jest-environment node */
/**
 * WORD FAMILY — opening மலர் should surface மலர்தல், மலர்ச்சி, மலரொளி, மலர்முகம்,
 * மலர்விழி, each marked established or coined.
 *
 * The risk this file guards is over-claiming: prefix matching is a heuristic,
 * not Tamil morphology, so the tests pin down that every member says HOW it was
 * matched and that a poet-recorded link always outranks a guessed one.
 */

import { buildWordFamily, stemOf, type FamilyEntry } from '@/lib/lexicon-family';

const e = (id: string, word: string, o: Partial<FamilyEntry> = {}): FamilyEntry => ({ id, word, ...o });

const MALAR_FAMILY: FamilyEntry[] = [
  e('1', 'மலர்', { gloss: 'flower', lexicalStatus: 'established' }),
  e('2', 'மலர்தல்', { gloss: 'to blossom', wordType: 'verb', lexicalStatus: 'established' }),
  e('3', 'மலர்ச்சி', { gloss: 'blossoming', wordType: 'noun', lexicalStatus: 'established' }),
  e('4', 'மலரொளி', { gloss: 'flower-light', lexicalStatus: 'creative-poetic' }),
  e('5', 'மலர்முகம்', { gloss: 'flower face', lexicalStatus: 'creative-poetic' }),
  e('6', 'மலர்விழி', { gloss: 'flower eyes', lexicalStatus: 'modern-compound' }),
  e('7', 'கடல்', { gloss: 'sea' }),
];

describe('stemOf', () => {
  it('strips one productive suffix', () => {
    expect(stemOf('மலர்தல்')).toBe('மலர்');
    expect(stemOf('மலர்ச்சி')).toBe('மலர்');
  });

  it('leaves a bare stem alone', () => {
    expect(stemOf('மலர்')).toBe('மலர்');
  });

  it('refuses to strip a suffix that would leave too little behind', () => {
    // Stripping 'ம்' from 'நம்' leaves one letter — coincidence, not a stem.
    expect(stemOf('நம்')).toBe('நம்');
  });
});

describe('buildWordFamily', () => {
  const family = buildWordFamily('மலர்', MALAR_FAMILY);

  it('finds the derived forms and compounds, and excludes unrelated words', () => {
    expect(family.members.map((m) => m.word).sort()).toEqual(
      ['மலர்ச்சி', 'மலர்தல்', 'மலர்முகம்', 'மலர்விழி', 'மலரொளி'].sort()
    );
    expect(family.members.map((m) => m.word)).not.toContain('கடல்');
  });

  it('never includes the head word itself', () => {
    expect(family.members.map((m) => m.word)).not.toContain('மலர்');
  });

  /** ⚠️ The distinction Raj asked to see at a glance. */
  it('marks which members are constructions rather than established forms', () => {
    const byWord = Object.fromEntries(family.members.map((m) => [m.word, m.constructed]));
    expect(byWord['மலர்தல்']).toBe(false);
    expect(byWord['மலர்ச்சி']).toBe(false);
    expect(byWord['மலரொளி']).toBe(true);
    expect(byWord['மலர்முகம்']).toBe(true);
    expect(family.constructedCount).toBe(3); // மலரொளி, மலர்முகம், மலர்விழி
  });

  /**
   * ⚠️ SANDHI. மலர் + ஒளி → மலரொளி: the pulli is absorbed, so the compound does
   * not literally start with the headword. Missing these would miss exactly the
   * compounds a lyricist coins.
   */
  it('finds a sandhi compound whose pulli was absorbed into a vowel sign', () => {
    const out = buildWordFamily('மலர்', [e('1', 'மலரொளி', { gloss: 'flower-light' })]);
    expect(out.members.map((m) => m.word)).toEqual(['மலரொளி']);
  });

  it('does NOT treat காரம் as a relative of கார் — a shared opening is not a shared root', () => {
    const out = buildWordFamily('கார்', [
      e('1', 'கார்', { gloss: 'dark cloud' }),
      e('2', 'காரம்', { gloss: 'pungency' }),
    ]);
    expect(out.members).toEqual([]);
  });

  it('says HOW each member was matched, never claiming more than it knows', () => {
    const byWord = Object.fromEntries(family.members.map((m) => [m.word, m.relation]));
    expect(byWord['மலர்தல்']).toBe('derived-form');
    expect(byWord['மலர்விழி']).toBe('compound');
  });

  it('ranks a poet-recorded link above a string-matched one', () => {
    const withLink = buildWordFamily('மலர்', [
      e('1', 'மலர்', { semanticFamily: ['பூ'] }),
      e('2', 'பூ', { gloss: 'flower' }),
      e('3', 'மலர்விழி', { gloss: 'flower eyes' }),
    ]);
    expect(withLink.members[0].word).toBe('பூ');
    expect(withLink.members[0].relation).toBe('listed');
  });

  it('includes a linked word that is not yet an entry, marked missing', () => {
    const out = buildWordFamily('மலர்', [e('1', 'மலர்', { relatedWords: ['பூங்கொடி'] })]);
    expect(out.members).toEqual([
      expect.objectContaining({ word: 'பூங்கொடி', missing: true, relation: 'listed' }),
    ]);
    expect(out.members[0].id).toBeUndefined();
  });

  it('works for a head word that is not in the lexicon at all', () => {
    const out = buildWordFamily('மலர்', MALAR_FAMILY.filter((x) => x.word !== 'மலர்'));
    expect(out.members.length).toBeGreaterThan(0);
    expect(out.head).toBe('மலர்');
  });

  it('returns an empty family rather than throwing on an empty lexicon', () => {
    expect(buildWordFamily('மலர்', []).members).toEqual([]);
  });

  it('is deterministic — order does not depend on input order', () => {
    const a = buildWordFamily('மலர்', MALAR_FAMILY).members.map((m) => m.word);
    const b = buildWordFamily('மலர்', [...MALAR_FAMILY].reverse()).members.map((m) => m.word);
    expect(a).toEqual(b);
  });

  it('matches across a zero-width joiner difference', () => {
    const out = buildWordFamily('மலர்', [e('1', 'மலர்‌தல்', { gloss: 'to blossom' })]);
    expect(out.members[0].relation).toBe('derived-form');
  });
});
