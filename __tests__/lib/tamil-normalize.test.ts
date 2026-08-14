/** @jest-environment node */
/**
 * Tamil normalization. The governing rule is that the poet's spelling is the
 * truth, so these tests are as much about what normalization must NOT do as
 * what it does: destroying a pulli or folding ண/ன/ந would merge genuinely
 * different Tamil words into one entry.
 */

import { matchKey, tamilFormIssue, hasTamil } from '@/lib/tamil-normalize';

const ZWNJ = '‌';
const ZWJ = '‍';
const BOM = '﻿';

describe('matchKey', () => {
  it('makes two spellings differing only by a zero-width joiner compare equal', () => {
    expect(matchKey(`அன்${ZWNJ}பு`)).toBe(matchKey('அன்பு'));
    expect(matchKey(`அன்${ZWJ}பு`)).toBe(matchKey('அன்பு'));
  });

  it('strips a BOM dragged in by a paste', () => {
    expect(matchKey(`${BOM}வைகறை`)).toBe('வைகறை');
  });

  it('trims and collapses whitespace, including non-breaking space', () => {
    expect(matchKey('  மலர்   விழி ')).toBe('மலர் விழி');
    expect(matchKey('மலர் விழி')).toBe('மலர் விழி');
  });

  it('case-folds ASCII so English glosses compare sanely', () => {
    expect(matchKey('Dawn')).toBe('dawn');
  });

  // ⚠️ The destructive normalizations this must never perform.
  it('preserves the pulli — அன்பு and அனபு are different words', () => {
    expect(matchKey('அன்பு')).toContain('்');
    expect(matchKey('அன்பு')).not.toBe(matchKey('அனபு'));
  });

  it('does not fold ண / ன / ந into each other', () => {
    expect(matchKey('மணி')).not.toBe(matchKey('மனி'));
    expect(matchKey('நிலா')).not.toBe(matchKey('னிலா'));
  });

  it('does not fold long and short vowels', () => {
    expect(matchKey('புது')).not.toBe(matchKey('பூது'));
  });

  it('is idempotent', () => {
    const once = matchKey(`  அன்${ZWNJ}பு  `);
    expect(matchKey(once)).toBe(once);
  });

  it('survives null/undefined input', () => {
    expect(matchKey(undefined as unknown as string)).toBe('');
  });
});

describe('tamilFormIssue', () => {
  it('accepts an ordinary Tamil headword', () => {
    expect(tamilFormIssue('வைகறை')).toBeNull();
    expect(tamilFormIssue('மலர்விழி')).toBeNull();
  });

  it('accepts a compound with an internal hyphen and a romanised entry', () => {
    expect(tamilFormIssue('அன்பு-மொழி')).toBeNull();
  });

  it('reports an empty word', () => {
    expect(tamilFormIssue('   ')?.code).toBe('empty');
  });

  it('reports a word with no Tamil letters at all', () => {
    expect(tamilFormIssue('dawn')?.code).toBe('no-tamil');
  });

  it('reports a leading vowel sign — the paste lost its base letter', () => {
    expect(tamilFormIssue('ாக')?.code).toBe('combining-start');
  });

  it('reports another Indic script mixed in', () => {
    expect(tamilFormIssue('अन்பு')?.code).toBe('foreign-script');
  });

  it('reports stray punctuation such as a comma list', () => {
    expect(tamilFormIssue('பொற்கதிர்,இளங்கதிர்')?.code).toBe('stray-punctuation');
  });

  it('does not report a word merely for containing a zero-width joiner', () => {
    expect(tamilFormIssue(`அன்${ZWNJ}பு`)).toBeNull();
  });
});

describe('hasTamil', () => {
  it('distinguishes Tamil from ASCII queries', () => {
    expect(hasTamil('மழை')).toBe(true);
    expect(hasTamil('rain')).toBe(false);
    expect(hasTamil('')).toBe(false);
  });
});
