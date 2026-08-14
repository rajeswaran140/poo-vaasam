/** @jest-environment node */
/**
 * Search, filters and counts.
 *
 * The interesting cases are the ones a substring match gets wrong: ranking the
 * headword above the forty entries that mention it in passing, and finding a
 * word through a relation that shares none of the query's letters.
 */

import { searchLexicon, passesFilters, lexiconCounts, type SearchableWord } from '@/lib/lexicon-search';

const w = (o: Partial<SearchableWord> & { id: string; word: string }): SearchableWord => ({
  gloss: '',
  themes: [],
  registers: ['literary'],
  register: 'literary',
  usage: 'fresh',
  archived: false,
  ...o,
});

describe('ranking', () => {
  it('puts the headword above an entry that merely mentions it', () => {
    const out = searchLexicon(
      [
        w({ id: 'mention', word: 'சாரல்', gloss: 'drizzle', poeticUsage: 'மழை நேரத்தில் பயன்படும்' }),
        w({ id: 'head', word: 'மழை', gloss: 'rain' }),
      ],
      'மழை'
    );
    expect(out[0].id).toBe('head');
  });

  it('scores an exact field match above a substring one', () => {
    const out = searchLexicon(
      [
        w({ id: 'partial', word: 'மழைத்துளி', gloss: 'raindrop' }),
        w({ id: 'exact', word: 'மழை', gloss: 'rain' }),
      ],
      'மழை'
    );
    expect(out[0].id).toBe('exact');
  });

  it('breaks ties by headword, never by input order', () => {
    const rows = [w({ id: 'b', word: 'ஆ', gloss: 'rain' }), w({ id: 'a', word: 'அ', gloss: 'rain' })];
    expect(searchLexicon(rows, 'rain').map((r) => r.id)).toEqual(
      searchLexicon([...rows].reverse(), 'rain').map((r) => r.id)
    );
  });
});

/**
 * ⚠️ THE DISCOVERY BEHAVIOUR. "மழை" must reach சாரல் even though சாரல் does not
 * contain those letters — because சாரல் lists மழை as a related word. Without
 * this the lexicon is an index; with it, it is a discovery engine.
 */
describe('relation expansion', () => {
  const lexicon = [
    w({ id: 'saral', word: 'சாரல்', gloss: 'drizzle', relatedWords: ['மழை'] }),
    w({ id: 'kadal', word: 'கடல்', gloss: 'sea' }),
  ];

  it('finds a word through another entry naming it', () => {
    expect(searchLexicon(lexicon, 'மழை').map((r) => r.id)).toEqual(['saral']);
  });

  it('does not drag in unrelated entries', () => {
    expect(searchLexicon(lexicon, 'மழை').map((r) => r.id)).not.toContain('kadal');
  });

  it('works through synonyms and the semantic family too', () => {
    const rows = [
      w({ id: 'a', word: 'எழில்', gloss: 'beauty', synonyms: ['அழகு'] }),
      w({ id: 'b', word: 'பொலிவு', gloss: 'radiance', semanticFamily: ['அழகு'] }),
    ];
    expect(searchLexicon(rows, 'அழகு').map((r) => r.id).sort()).toEqual(['a', 'b']);
  });
});

describe('Tamil vs English queries', () => {
  it('an English query reaches glosses and themes', () => {
    const rows = [w({ id: '1', word: 'அன்பு', gloss: 'love, affection' }), w({ id: '2', word: 'கடல்', gloss: 'sea' })];
    expect(searchLexicon(rows, 'love').map((r) => r.id)).toEqual(['1']);
  });

  it('finds several Tamil words for one English concept', () => {
    const rows = [
      w({ id: '1', word: 'அன்பு', gloss: 'love' }),
      w({ id: '2', word: 'காதல்', gloss: 'romantic love' }),
      w({ id: '3', word: 'நேசம்', gloss: 'love, fondness' }),
      w({ id: '4', word: 'கடல்', gloss: 'sea' }),
    ];
    expect(searchLexicon(rows, 'love').map((r) => r.id).sort()).toEqual(['1', '2', '3']);
  });

  it('an English query can find a word by its register or theme name', () => {
    const rows = [
      w({ id: '1', word: 'அகத்திணை', gloss: 'interior genre', registers: ['sangam'] }),
      w({ id: '2', word: 'கடல்', gloss: 'sea', registers: ['common'] }),
    ];
    expect(searchLexicon(rows, 'sangam').map((r) => r.id)).toEqual(['1']);
  });

  it('searches Tamil notes for a Tamil query — notes are not an English field', () => {
    const rows = [w({ id: '1', word: 'கடல்', gloss: 'sea', notes: 'மழைக்காலத்தில் பயன்படும்' })];
    expect(searchLexicon(rows, 'மழை')).toHaveLength(1);
  });

  it('matches a zero-width-joiner spelling of the same word', () => {
    const rows = [w({ id: '1', word: 'அன்‌பு', gloss: 'love' })];
    expect(searchLexicon(rows, 'அன்பு')).toHaveLength(1);
  });
});

describe('filters', () => {
  it('matches a register against the FULL list, not just the primary', () => {
    const row = w({ id: '1', word: 'அன்பு', registers: ['common', 'literary'], register: 'common' });
    expect(passesFilters(row, { register: 'literary' })).toBe(true);
    expect(passesFilters(row, { register: 'common' })).toBe(true);
    expect(passesFilters(row, { register: 'sangam' })).toBe(false);
  });

  it('hides archived entries unless asked', () => {
    const row = w({ id: '1', word: 'x', archived: true });
    expect(passesFilters(row, {})).toBe(false);
    expect(passesFilters(row, { includeArchived: true })).toBe(true);
  });

  it('filters by the new axes', () => {
    const row = w({ id: '1', word: 'x', wordType: 'poetic-compound', lexicalStatus: 'creative-poetic', confidence: 'experimental' });
    expect(passesFilters(row, { wordType: 'poetic-compound' })).toBe(true);
    expect(passesFilters(row, { lexicalStatus: 'established' })).toBe(false);
    expect(passesFilters(row, { confidence: 'experimental' })).toBe(true);
  });

  it('an empty query returns the filtered list in its original order', () => {
    const rows = [w({ id: 'b', word: 'ஆ' }), w({ id: 'a', word: 'அ' })];
    expect(searchLexicon(rows, '').map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('counts', () => {
  it('counts a word under every register it holds', () => {
    const counts = lexiconCounts([
      w({ id: '1', word: 'அன்பு', registers: ['common', 'literary'] }),
      w({ id: '2', word: 'அகத்திணை', registers: ['sangam'] }),
    ]);
    expect(counts.total).toBe(2);
    expect(counts.byRegister).toEqual({ common: 1, literary: 1, sangam: 1 });
  });

  it('excludes archived entries from the total and counts them separately', () => {
    const counts = lexiconCounts([w({ id: '1', word: 'x', archived: true })]);
    expect(counts.total).toBe(0);
    expect(counts.archived).toBe(1);
  });

  it('counts entries needing review — no theme, no Tamil meaning, or no confidence', () => {
    const counts = lexiconCounts([
      w({ id: '1', word: 'done', themes: ['love'], tamilMeaning: 'ஒரு பொருள்', confidence: 'high' }),
      w({ id: '2', word: 'bare' }),
    ]);
    expect(counts.needsReview).toBe(1);
  });
});
