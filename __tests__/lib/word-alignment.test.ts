import { alignLinesToWords, wordSimilarity } from '@/lib/word-alignment';

const w = (start: number, word: string, end = start + 0.5) => ({ start, end, word });

describe('wordSimilarity', () => {
  it('treats sound-alike Tamil letters as the same word', () => {
    expect(wordSimilarity('வானம்', 'வாணம்')).toBe(1); // ன / ண
    expect(wordSimilarity('கனவுகளே', 'கணவுகளே')).toBe(1);
    expect(wordSimilarity('மலரும்', 'மலறும்')).toBe(1); // ர / ற
    expect(wordSimilarity('காற்றும்', 'காத்ரும்')).toBeGreaterThanOrEqual(0.6);
    expect(wordSimilarity('கார்த்திகை', 'நம்பிக்கை')).toBeLessThan(0.4);
  });
});

describe('alignLinesToWords', () => {
  it('starts each line at its own first word, across a music break', () => {
    // Measured shape (பூவும் காற்றும், 2026-11-13): the verse after the break
    // was heard at 95.5 s; the old line-to-chunk matcher put it at 75.6 s.
    const lines = ['தினம் உலா வரும் படகே', 'கார்த்திகை மழையிலே', 'கீர்த்தனம் பாடுது மனமே'];
    const heard = [
      w(74.5, 'தினமுளா'), w(75.2, 'வரும்'), w(75.7, 'படகே.'),
      w(95.5, 'கார்த்திகை'), w(96.7, 'மழலே'),
      w(97.7, 'கீர்த்தனும்'), w(98.7, 'பாடுது'), w(99.3, 'மனமே,'),
    ];
    const out = alignLinesToWords(lines, heard);
    expect(out.map((l) => l.startMs)).toEqual([74_500, 95_500, 97_700]);
    expect(out.every((l) => l.anchored)).toBe(true);
    expect(out.map((l) => l.text)).toEqual(lines); // his text, never the heard words
    expect(out[0].lastWordEndSec).toBeCloseTo(76.2, 1);
  });

  it('uses the slot of a misheard first word for the line start', () => {
    const out = alignLinesToWords(['பூவும் காற்றும் சேர்ந்த வாசம்'], [w(20.3, 'உங்கும்'), w(21.7, 'காட்டும்'), w(22.3, 'சேர்ந்த'), w(22.9, 'வாசம்')]);
    expect(out[0].startMs).toBe(20_300);
  });

  it('marks a line nobody sang as not heard and places it between its neighbours', () => {
    const out = alignLinesToWords(['ஒன்று இரண்டு', 'மூன்று நான்கு', 'ஐந்து ஆறு'], [w(10, 'ஒன்று'), w(11, 'இரண்டு'), w(30, 'ஐந்து'), w(31, 'ஆறு')]);
    expect(out.map((l) => l.anchored)).toEqual([true, false, true]);
    expect(out[1].startMs).toBeGreaterThan(10_000);
    expect(out[1].startMs).toBeLessThan(30_000);
    for (let i = 1; i < out.length; i++) expect(out[i].startMs).toBeGreaterThan(out[i - 1].startMs);
  });

  it('copes with nothing heard', () => {
    const out = alignLinesToWords(['ஒன்று', 'இரண்டு'], []);
    expect(out.map((l) => l.anchored)).toEqual([false, false]);
    expect(out[1].startMs).toBeGreaterThan(out[0].startMs);
  });
});
