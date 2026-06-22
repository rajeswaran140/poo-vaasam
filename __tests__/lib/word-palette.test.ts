import { buildPalette, tokenizeLyrics, analyzeDraft, type PaletteWord } from '@/lib/word-palette';

const w = (over: Partial<PaletteWord> & { word: string; usage: string }): PaletteWord => ({
  romanization: undefined, gloss: 'g', register: 'sangam', themes: [], archived: false, ...over,
});

const WORDS: PaletteWord[] = [
  w({ word: 'நிலா', usage: 'fresh', register: 'sangam', themes: ['nature'] }),
  w({ word: 'கடல்', usage: 'neutral', register: 'literary', themes: ['nature'] }),
  w({ word: 'காதல்', usage: 'retire', register: 'modern', themes: ['love'] }),
  w({ word: 'வானம்', usage: 'fresh', register: 'sangam', themes: ['love'] }),
  w({ word: 'பழசு', usage: 'fresh', register: 'village', themes: ['nature'], archived: true }),
];

describe('buildPalette', () => {
  it('offers only fresh, non-archived, non-retired words by default', () => {
    const out = buildPalette(WORDS).map((x) => x.word);
    expect(out).toEqual(['நிலா', 'வானம்']); // not கடல்(neutral), காதல்(retire), பழசு(archived)
  });

  it('includes neutral words when asked', () => {
    const out = buildPalette(WORDS, { includeNeutral: true }).map((x) => x.word);
    expect(out).toEqual(['நிலா', 'கடல்', 'வானம்']);
  });

  it('narrows by register and theme', () => {
    expect(buildPalette(WORDS, { register: 'sangam' }).map((x) => x.word)).toEqual(['நிலா', 'வானம்']);
    expect(buildPalette(WORDS, { theme: 'love' }).map((x) => x.word)).toEqual(['வானம்']);
    expect(buildPalette(WORDS, { theme: 'nature' }).map((x) => x.word)).toEqual(['நிலா']);
  });

  it('never offers retired or archived words even with filters', () => {
    const out = buildPalette(WORDS, { includeNeutral: true, theme: 'love' }).map((x) => x.word);
    expect(out).not.toContain('காதல்'); // retire
    expect(out).toEqual(['வானம்']);
  });
});

describe('tokenizeLyrics', () => {
  it('splits on whitespace and punctuation, NFC-normalising', () => {
    expect(tokenizeLyrics('நிலா, வானம்...\nகடல்!')).toEqual(['நிலா', 'வானம்', 'கடல்']);
  });
  it('handles empty / nullish', () => {
    expect(tokenizeLyrics('')).toEqual([]);
    expect(tokenizeLyrics(undefined as unknown as string)).toEqual([]);
  });
});

describe('analyzeDraft', () => {
  it('flags overused (retire) words present and counts fresh words used', () => {
    const draft = 'காதல் நிலா வானம் கானகம்'; // காதல்=retire, நிலா+வானம்=fresh
    const { overused, freshUsed } = analyzeDraft(draft, WORDS);
    expect(overused.map((x) => x.word)).toEqual(['காதல்']);
    expect(freshUsed.map((x) => x.word).sort()).toEqual(['நிலா', 'வானம்'].sort());
  });

  it('matches whole tokens, not partial substrings, for single words', () => {
    // "நிலாவை" should NOT match the headword "நிலா" (different token).
    const { freshUsed } = analyzeDraft('நிலாவை பார்த்தேன்', WORDS);
    expect(freshUsed.map((x) => x.word)).not.toContain('நிலா');
  });

  it('matches a multi-word headword as a substring', () => {
    const phrase: PaletteWord = w({ word: 'கடல் அலை', usage: 'retire', themes: [] });
    const { overused } = analyzeDraft('அந்த கடல் அலை வந்தது', [phrase]);
    expect(overused.map((x) => x.word)).toEqual(['கடல் அலை']);
  });

  it('ignores archived words', () => {
    const { freshUsed } = analyzeDraft('பழசு', WORDS);
    expect(freshUsed).toHaveLength(0);
  });

  it('returns empties for a blank draft', () => {
    expect(analyzeDraft('', WORDS)).toEqual({ overused: [], freshUsed: [] });
  });
});
