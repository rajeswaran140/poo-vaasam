import {
  inspectSingability,
  lexiconCandidates,
  wordAt,
  DEFAULT_CANDIDATE_LIMIT,
} from '@/lib/lyric-word-inspect';
import type { LexiconWord } from '@/types/lexicon';

const word = (o: Partial<LexiconWord> & { word: string }): LexiconWord => ({
  id: o.word,
  romanization: undefined,
  gloss: 'gloss',
  register: 'modern',
  usage: 'neutral',
  themes: [],
  usageCount: 0,
  archived: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...o,
});

describe('inspectSingability', () => {
  it('counts syllables and reports an open long-vowel ending as sustaining', () => {
    const r = inspectSingability('கண்ணே');
    expect(r.syllables).toBeGreaterThan(0);
    expect(r.endsOpen).toBe(true);
    expect(r.note).toMatch(/sustain/i);
  });

  it('explains the CONSEQUENCE of a closed ending, not just the fact', () => {
    const r = inspectSingability('கண்ணில்');
    expect(r.endsOpen).toBe(false);
    expect(r.note).toMatch(/clip/i);
  });

  it('is quiet and safe on empty input', () => {
    const r = inspectSingability('');
    expect(r.syllables).toBe(0);
    expect(r.note).toBe('');
  });

  it('trims surrounding whitespace before analysing', () => {
    expect(inspectSingability('  கண்ணே  ').word).toBe('கண்ணே');
  });
});

describe('lexiconCandidates', () => {
  const lex = [
    word({ word: 'மணியே', themes: ['love'], usage: 'fresh' }),
    word({ word: 'நிலவே', themes: ['love'] }),
    word({ word: 'ஆறு', themes: ['nature'] }),
    word({ word: 'கண்ணே', themes: ['love'] }), // the selected word itself
    word({ word: 'பழையது', themes: ['love'], usage: 'retire' }),
    word({ word: 'மறைந்தது', themes: ['love'], archived: true }),
  ];

  it('never returns the selected word back', () => {
    const out = lexiconCandidates('கண்ணே', lex, { theme: 'love' });
    expect(out.map((c) => c.word)).not.toContain('கண்ணே');
  });

  it('excludes retired and archived words', () => {
    const out = lexiconCandidates('கண்ணே', lex, { theme: 'love' }).map((c) => c.word);
    expect(out).not.toContain('பழையது');
    expect(out).not.toContain('மறைந்தது');
  });

  it('ranks a same-syllable swap first, because it does not disturb the line', () => {
    const out = lexiconCandidates('கண்ணே', lex, { theme: 'love' });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].keepsMeter).toBe(true);
  });

  it('explains why each candidate surfaced', () => {
    for (const c of lexiconCandidates('கண்ணே', lex, { theme: 'love', register: 'modern' })) {
      expect(c.because.trim()).not.toBe('');
    }
  });

  it('drops candidates that share nothing at all rather than padding the list', () => {
    const unrelated = [word({ word: 'வானவில்லேயோ', themes: ['nature'], register: 'sangam' })];
    // No theme match, no register match, different syllable count → score 0.
    expect(lexiconCandidates('கண்', unrelated, { theme: 'love', register: 'modern' })).toEqual([]);
  });

  it('honours the limit', () => {
    const many = Array.from({ length: 40 }, (_, i) => word({ word: `சொல்${i}`, themes: ['love'] }));
    expect(lexiconCandidates('கண்ணே', many, { theme: 'love' }).length).toBeLessThanOrEqual(
      DEFAULT_CANDIDATE_LIMIT
    );
    expect(lexiconCandidates('கண்ணே', many, { theme: 'love', limit: 3 }).length).toBeLessThanOrEqual(3);
  });

  it('returns nothing for an empty selection or empty lexicon', () => {
    expect(lexiconCandidates('', lex)).toEqual([]);
    expect(lexiconCandidates('கண்ணே', [])).toEqual([]);
  });

  it('matches the selected word by NFC so a differently-composed form is still excluded', () => {
    const composed = 'கண்ணே'.normalize('NFD');
    const out = lexiconCandidates(composed, lex, { theme: 'love' }).map((c) => c.word);
    expect(out).not.toContain('கண்ணே');
  });
});

describe('wordAt', () => {
  it('returns the word under the caret', () => {
    const t = 'கண்ணே மணியே நிலவே';
    expect(wordAt(t, 0)).toBe('கண்ணே');
    expect(wordAt(t, 8)).toBe('மணியே');
  });

  it('does not split a Tamil word mid-grapheme', () => {
    // A \w-based boundary would cut between the base letter and its vowel sign.
    const t = 'கண்ணே';
    expect(wordAt(t, 3)).toBe('கண்ணே');
  });

  it('stops at punctuation and line breaks', () => {
    expect(wordAt('கண்ணே, மணியே', 2)).toBe('கண்ணே');
    expect(wordAt('கண்ணே\nமணியே', 8)).toBe('மணியே');
  });

  it('is safe at the boundaries and on empty text', () => {
    expect(wordAt('', 0)).toBe('');
    expect(wordAt('கண்ணே', 999)).toBe('கண்ணே');
    expect(wordAt('கண்ணே', -5)).toBe('கண்ணே');
  });
});
