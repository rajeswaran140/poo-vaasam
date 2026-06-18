import { normalizeForSearch, matchesSearch } from '@/lib/search-match';

describe('normalizeForSearch', () => {
  it('NFC-normalizes, lowercases, and collapses whitespace', () => {
    expect(normalizeForSearch('  Hello   World  ')).toBe('hello world');
    // NFC composed vs NFD decomposed forms normalize equal.
    expect(normalizeForSearch('é' /* NFC U+00E9 */)).toBe(normalizeForSearch('é' /* NFD */));
  });

  it('handles nullish input', () => {
    expect(normalizeForSearch(undefined as unknown as string)).toBe('');
  });
});

describe('matchesSearch (Tamil-robust)', () => {
  it('matches a Tamil substring regardless of normalization form', () => {
    // "கீ" can be stored composed or decomposed; a typed query must still match.
    const composed = 'கீதம்'.normalize('NFC');
    const decomposed = 'கீதம்'.normalize('NFD');
    expect(matchesSearch(composed, decomposed)).toBe(true);
    expect(matchesSearch(decomposed, composed)).toBe(true);
  });

  it('matches a Tamil word inside a longer title', () => {
    expect(matchesSearch('அம்மா சொன்ன கதை', 'அம்மா')).toBe(true);
    expect(matchesSearch('அம்மா சொன்ன கதை', 'கதை')).toBe(true);
  });

  it('ignores surrounding/extra whitespace in the query', () => {
    expect(matchesSearch('காதல் பாடல்', '  காதல்  ')).toBe(true);
  });

  it('is case-insensitive for Latin and returns false on no match', () => {
    expect(matchesSearch('Tamil Kavithai', 'kavithai')).toBe(true);
    expect(matchesSearch('அம்மா', 'அப்பா')).toBe(false);
  });

  it('an empty query matches everything', () => {
    expect(matchesSearch('anything', '')).toBe(true);
    expect(matchesSearch('anything', '   ')).toBe(true);
  });

  describe('romanised (Latin → Tamil) fallback', () => {
    it('finds Tamil content from a roman query', () => {
      expect(matchesSearch('நீ சிரிச்ச நேரம்', 'nee siricha neram')).toBe(true);
      expect(matchesSearch('நீ சிரிச்ச நேரம்', 'neram')).toBe(true);
      expect(matchesSearch('முத்தமிழின்', 'muthamizhin')).toBe(true);
      expect(matchesSearch('அம்மா சொன்ன கதை', 'amma')).toBe(true);
    });

    it('tolerates voicing/aspiration variation (desam ≈ thesam)', () => {
      expect(matchesSearch('எங்கள் தேசம்', 'thesam')).toBe(true);
      expect(matchesSearch('எங்கள் தேசம்', 'desam')).toBe(true);
    });

    it('does not romanise-match an unrelated roman query', () => {
      expect(matchesSearch('அம்மா', 'thesam')).toBe(false);
    });

    it('a pure-Tamil query keeps exact behaviour (no phonetic widening)', () => {
      // அப்பா must NOT match அம்மா even though both fold near "ama"/"apa".
      expect(matchesSearch('அம்மா', 'அப்பா')).toBe(false);
    });
  });
});
