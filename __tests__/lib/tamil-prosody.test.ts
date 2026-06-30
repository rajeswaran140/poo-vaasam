/** @jest-environment node */
/**
 * tamil-prosody — syllable/எழுத்து counting, grapheme segmentation, and
 * மோனை/எதுகை/இயைபு grouping, checked against hand-verified Tamil words.
 */

import {
  toGraphemes, countSyllables, countLetters, analyzeLine, analyzeProsody,
} from '@/lib/tamil-prosody';

describe('countSyllables (pronounced vowels)', () => {
  it.each([
    ['தமிழ்', 2],   // ta-mizh
    ['காதல்', 2],   // kaa-thal
    ['மலர்', 2],    // ma-lar
    ['அழகு', 3],    // a-zha-gu
    ['வணக்கம்', 3], // va-ṇak-kam
    ['ஆம்', 1],     // aam
    ['ஸ்ரீ', 1],    // sree (cluster = one syllable)
  ])('%s → %i syllables', (word, n) => {
    expect(countSyllables(word)).toBe(n);
  });
});

describe('countLetters (எழுத்து)', () => {
  it.each([
    ['தமிழ்', 3],    // த, மி, ழ்
    ['காதல்', 3],    // கா, த, ல்
    ['வணக்கம்', 5],  // வ, ண, க், க, ம்
    ['அழகு', 3],     // அ, ழ, கு
  ])('%s → %i letters', (word, n) => {
    expect(countLetters(word)).toBe(n);
  });
});

describe('toGraphemes', () => {
  it('segments consonant clusters and combining marks into single letters', () => {
    expect(toGraphemes('தமிழ்')).toEqual(['த', 'மி', 'ழ்']);
    expect(toGraphemes('வணக்கம்')).toEqual(['வ', 'ண', 'க்', 'க', 'ம்']);
    expect(toGraphemes('அழகு')).toEqual(['அ', 'ழ', 'கு']);
  });
});

describe('analyzeLine — rhyme keys', () => {
  it('extracts மோனை (first), எதுகை (second), இயைபு (last)', () => {
    const l = analyzeLine('காதல்', 0);
    expect(l.monai).toBe('க');
    expect(l.etukai).toBe('த');
    expect(l.iyaipu).toBe('ல்');
    expect(l.syllables).toBe(2);
  });

  it('folds long vowels to their family for மோனை (மா/மு alliterate; ஆ≈அ)', () => {
    expect(analyzeLine('மாலை', 0).monai).toBe(analyzeLine('முல்லை', 1).monai); // both ம
    expect(analyzeLine('ஆசை', 0).monai).toBe(analyzeLine('அன்பு', 1).monai);   // both அ
  });
});

describe('analyzeProsody', () => {
  const report = analyzeProsody('மாதம்\nமலர்\nகாதல்\nஅழகு');

  it('counts lyric lines and finds the dominant syllable length + outliers', () => {
    expect(report.lyricLineCount).toBe(4);
    expect(report.dominantSyllables).toEqual({ count: 2, lines: 3 }); // 3 lines of 2; அழகு is 3
    expect(report.syllableOutliers).toEqual([3]);
  });

  it('groups மோனை (lines 0,1 share ம) and எதுகை (lines 0,2 share த)', () => {
    expect(report.monai).toEqual([{ key: 'ம', lineIndexes: [0, 1] }]);
    expect(report.etukai).toEqual([{ key: 'த', lineIndexes: [0, 2] }]);
  });

  it('detects இயைபு end-rhyme', () => {
    const r = analyzeProsody('வந்தான்\nசென்றான்');
    expect(r.iyaipu).toEqual([{ key: 'ன்', lineIndexes: [0, 1] }]);
  });

  it('skips section headings and blank lines', () => {
    const r = analyzeProsody('பல்லவி\nகாதல்\n\nமாதம்');
    expect(r.lyricLineCount).toBe(2); // heading + blank excluded
    expect(r.lines[0].isHeading).toBe(true);
    expect(r.monai.every((g) => !g.lineIndexes.includes(0))).toBe(true); // heading never grouped
  });

  it('handles empty input without crashing', () => {
    const r = analyzeProsody('   ');
    expect(r.lyricLineCount).toBe(0);
    expect(r.dominantSyllables).toBeNull();
    expect(r.monai).toEqual([]);
  });
});
