/**
 * Tamil → Latin romanisation + phonetic key. Drives the romanised search that
 * lets diaspora find songs by typing in Latin script.
 */

import { romanizeTamil, phoneticKey, tamilPhoneticKey } from '@/lib/tamil-romanize';

describe('romanizeTamil', () => {
  it('romanises independent vowels with common long-vowel conventions', () => {
    expect(romanizeTamil('அ')).toBe('a');
    expect(romanizeTamil('ஆ')).toBe('aa');
    expect(romanizeTamil('ஈ')).toBe('ee');
    expect(romanizeTamil('ஊ')).toBe('oo');
  });

  it('adds the inherent "a" to a bare consonant', () => {
    expect(romanizeTamil('க')).toBe('ka');
    expect(romanizeTamil('ம')).toBe('ma');
  });

  it('applies a vowel sign instead of the inherent "a"', () => {
    expect(romanizeTamil('கா')).toBe('kaa'); // க + ா
    expect(romanizeTamil('கி')).toBe('ki'); // க + ி
    expect(romanizeTamil('நீ')).toBe('nee'); // ந + ீ
  });

  it('drops the inherent vowel on a pulli (pure consonant)', () => {
    expect(romanizeTamil('க்')).toBe('k'); // க + ்
    expect(romanizeTamil('நேரம்')).toBe('neram'); // ந ே ர ம ்
  });

  it('romanises a full word', () => {
    expect(romanizeTamil('முத்தமிழின்')).toBe('muththamizhin');
  });

  it('passes non-Tamil through untouched', () => {
    expect(romanizeTamil('Tamil 2026!')).toBe('Tamil 2026!');
    expect(romanizeTamil('')).toBe('');
  });
});

describe('phoneticKey', () => {
  it('folds aspiration, voicing and sibilants, drops non-letters, collapses repeats', () => {
    expect(phoneticKey('th')).toBe('t');
    expect(phoneticKey('dh')).toBe('t');
    expect(phoneticKey('ch')).toBe('c');
    expect(phoneticKey('sh')).toBe('c');
    expect(phoneticKey('g')).toBe('k');
    expect(phoneticKey('d')).toBe('t');
    expect(phoneticKey('b')).toBe('p');
    expect(phoneticKey('neeram')).toBe('neram'); // collapse ee
    expect(phoneticKey('a b-c!')).toBe('apc'); // strip non-letters (b→p), join
  });

  it('keeps ழ (zh) distinct from l / r', () => {
    expect(phoneticKey('zh')).toBe('z');
  });
});

describe('tamilPhoneticKey — roman query meets Tamil content', () => {
  // Each pair: a Tamil string and the various ways a diaspora user might type it.
  const cases: [string, string[]][] = [
    ['நீ சிரிச்ச நேரம்', ['nee siricha neram', 'neram', 'siricha']],
    ['முத்தமிழின்', ['muthamizhin', 'mutthamizin']],
    ['எங்கள் தேசம்', ['thesam', 'desam']], // voiced + unvoiced spellings both hit
    ['அம்மா', ['amma', 'ammaa']],
  ];

  it.each(cases)('"%s" is found by its roman spellings', (tamil, queries) => {
    const key = tamilPhoneticKey(tamil);
    for (const q of queries) {
      expect(key.includes(phoneticKey(q))).toBe(true);
    }
  });

  it('does not match an unrelated query', () => {
    expect(tamilPhoneticKey('அம்மா').includes(phoneticKey('thesam'))).toBe(false);
  });
});
