import { lexiconWordInputSchema, lexiconWordUpdateSchema, headwordIssue } from '@/types/lexicon';
import { parsePastedWords, lexiconToCsv, GLOSS_PLACEHOLDER, splitWordList } from '@/lib/lexicon-io';

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

/**
 * COMMA-SEPARATED WORD FAMILIES — the parse gap that let a blob through.
 *
 * `parsePastedWords` split on newlines only, so the real paste
 * `பொற்கதிர், இளங்கதிர், செங்கதிர்,கதிரொளி,பொற்சுடர்` (2026-08-14) was ONE line
 * and became ONE 49-character entry. People write word families comma-separated.
 */
describe('a line may carry a whole word family', () => {
  const opts = { register: 'sangam' as const, usage: 'fresh' as const, themes: [] as string[] };

  it('splits the real paste into its five words', () => {
    const r = parsePastedWords('பொற்கதிர், இளங்கதிர், செங்கதிர்,கதிரொளி,பொற்சுடர்', opts);
    expect(r.words.map((w) => w.word)).toEqual([
      'பொற்கதிர்', 'இளங்கதிர்', 'செங்கதிர்', 'கதிரொளி', 'பொற்சுடர்',
    ]);
  });

  it('shares the line gloss across the whole family', () => {
    const r = parsePastedWords('பொற்கதிர், இளங்கதிர் — sun', opts);
    expect(r.words.map((w) => w.gloss)).toEqual(['sun', 'sun']);
  });

  it('does NOT split a comma inside the gloss', () => {
    // The gloss separator is matched first, so only the word side splits.
    const r = parsePastedWords('நிலா — moon, and moonlight', opts);
    expect(r.words).toHaveLength(1);
    expect(r.words[0]).toMatchObject({ word: 'நிலா', gloss: 'moon, and moonlight' });
  });

  it('mixes newlines and commas in one paste', () => {
    const r = parsePastedWords('கடல்\nபொற்கதிர், இளங்கதிர்\nவானம் | sky', opts);
    expect(r.words.map((w) => w.word)).toEqual(['கடல்', 'பொற்கதிர்', 'இளங்கதிர்', 'வானம்']);
  });

  it('still dedupes across the whole paste, not just per line', () => {
    const r = parsePastedWords('கடல், வானம்\nகடல்', opts);
    expect(r.words.map((w) => w.word)).toEqual(['கடல்', 'வானம்']);
    expect(r.skipped).toBe(1);
  });

  it('handles the fullwidth and ideographic commas too', () => {
    expect(parsePastedWords('கடல்，வானம்、நிலா', opts).words).toHaveLength(3);
  });

  it('leaves a single word untouched', () => {
    expect(parsePastedWords('உயிர்த்தமிழே', opts).words.map((w) => w.word)).toEqual(['உயிர்த்தமிழே']);
  });

  it('splitWordList is exported for UI-side previewing', () => {
    expect(splitWordList('a, b ,c')).toEqual(['a', 'b', 'c']);
    expect(splitWordList('  ')).toEqual([]);
  });
});

/**
 * A HEADWORD IS ONE WORD — the guard that was missing.
 *
 * On 2026-08-14 a real entry got in as
 * `பொற்கதிர், இளங்கதிர், செங்கதிர்,கதிரொளி,பொற்சுடர்` with gloss "Sun": five
 * genuine synonyms in one field, accepted because the rule was only
 * `z.string().max(60)`. It reached the Lyric Critic as a single vocabulary
 * item and defeated the uniqueness check, which dedupes on the whole string.
 */
describe('headword must be a single word', () => {
  const base = { gloss: 'Sun', register: 'sangam' as const };

  it.each([
    ['comma + space', 'பொற்கதிர், இளங்கதிர்'],
    ['comma only', 'பொற்கதிர்,இளங்கதிர்'],
    ['semicolon', 'பொற்கதிர்; இளங்கதிர்'],
    ['slash', 'பொற்கதிர்/இளங்கதிர்'],
    ['pipe', 'பொற்கதிர்|இளங்கதிர்'],
    ['fullwidth comma', 'பொற்கதிர்，இளங்கதிர்'],
  ])('rejects a %s list', (_label, word) => {
    const r = lexiconWordInputSchema.safeParse({ ...base, word });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/single word/i);
  });

  it('points the poet at the bulk endpoint rather than just refusing', () => {
    const r = lexiconWordInputSchema.safeParse({ ...base, word: 'a,b' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/bulk/i);
  });

  it('accepts a real single Tamil headword', () => {
    expect(lexiconWordInputSchema.safeParse({ ...base, word: 'பொற்கதிர்' }).success).toBe(true);
  });

  it('accepts a multi-SYLLABLE word and an internal space (not a list)', () => {
    // Tamil compounds and two-part phrases are legitimate headwords.
    expect(lexiconWordInputSchema.safeParse({ ...base, word: 'உயிர்த்தமிழே' }).success).toBe(true);
    expect(lexiconWordInputSchema.safeParse({ ...base, word: 'பொன் மாலை' }).success).toBe(true);
  });

  it('guards UPDATES too — a correction must not smuggle a list back in', () => {
    const r = lexiconWordUpdateSchema.safeParse({ word: 'பொற்கதிர், இளங்கதிர்' });
    expect(r.success).toBe(false);
  });

  it('headwordIssue() explains the problem for UI use', () => {
    expect(headwordIssue('பொற்கதிர், இளங்கதிர்')).toMatch(/single word/i);
    expect(headwordIssue('பொற்கதிர்')).toBeNull();
  });
});
