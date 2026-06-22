import { parsePastedWords, lexiconToCsv, GLOSS_PLACEHOLDER } from '@/lib/lexicon-io';

const OPTS = { register: 'sangam' as const, usage: 'fresh' as const, themes: ['love'] };

describe('parsePastedWords', () => {
  it('parses one bare word per line and applies panel register/usage/themes', () => {
    const { words, skipped } = parsePastedWords('நிலா\nகடல்', OPTS);
    expect(skipped).toBe(0);
    expect(words).toHaveLength(2);
    expect(words[0]).toEqual({ word: 'நிலா', gloss: GLOSS_PLACEHOLDER, register: 'sangam', usage: 'fresh', themes: ['love'] });
    expect(words[1].word).toBe('கடல்');
  });

  it('splits "word — gloss" on dash, en-dash, pipe, equals, colon, and tab', () => {
    const text = 'நிலா — moon\nகடல் – sea\nவானம் | sky\nமழை = rain\nபூ : flower\nகாற்று\tbreeze';
    const { words } = parsePastedWords(text, OPTS);
    expect(words.map((w) => [w.word, w.gloss])).toEqual([
      ['நிலா', 'moon'],
      ['கடல்', 'sea'],
      ['வானம்', 'sky'],
      ['மழை', 'rain'],
      ['பூ', 'flower'],
      ['காற்று', 'breeze'],
    ]);
  });

  it('does NOT split a hyphenated romanization without surrounding spaces', () => {
    const { words } = parsePastedWords('vil-akku', OPTS);
    expect(words[0].word).toBe('vil-akku');
    expect(words[0].gloss).toBe(GLOSS_PLACEHOLDER);
  });

  it('defaults a missing gloss to the placeholder', () => {
    const { words } = parsePastedWords('நிலா', OPTS);
    expect(words[0].gloss).toBe(GLOSS_PLACEHOLDER);
  });

  it('skips blank lines, dedupes within the paste (NFC), and counts skips', () => {
    const { words, skipped } = parsePastedWords('நிலா\n\n  \nநிலா — moon', OPTS);
    expect(words).toHaveLength(1); // second நிலா is a dupe
    expect(skipped).toBe(1);
  });

  it('skips over-long words (>60 chars)', () => {
    const long = 'அ'.repeat(61);
    const { words, skipped } = parsePastedWords(long, OPTS);
    expect(words).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('handles empty / nullish input', () => {
    expect(parsePastedWords('', OPTS)).toEqual({ words: [], skipped: 0 });
    expect(parsePastedWords(undefined as unknown as string, OPTS)).toEqual({ words: [], skipped: 0 });
  });
});

describe('lexiconToCsv', () => {
  const rows = [
    { word: 'நிலா', romanization: 'nila', gloss: 'moon', register: 'sangam', usage: 'fresh', themes: ['love', 'nature'] },
    { word: 'கடல்', gloss: 'sea', register: 'literary', usage: 'neutral', themes: [] },
  ];

  it('emits a header and one quoted row per word', () => {
    const csv = lexiconToCsv(rows);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('word,romanization,gloss,register,usage,themes');
    expect(lines[1]).toBe('"நிலா","nila","moon","sangam","fresh","love nature"');
    expect(lines[2]).toBe('"கடல்","","sea","literary","neutral",""');
  });

  it('escapes embedded double-quotes (RFC 4180)', () => {
    const csv = lexiconToCsv([{ word: 'x', gloss: 'a "quoted" word', register: 'modern', usage: 'fresh', themes: [] }]);
    expect(csv).toContain('"a ""quoted"" word"');
  });

  it('handles an empty list (header only)', () => {
    expect(lexiconToCsv([])).toBe('word,romanization,gloss,register,usage,themes');
  });
});
