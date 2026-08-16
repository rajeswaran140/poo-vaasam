/** @jest-environment node */
/**
 * ⚠️ The mistake this prevents: `Lyrics.fromPlainText` treats every non-blank
 * line as sung, so an arrangement sheet fed to the caption builder puts
 * "[Intro]" and "(solo violin & nadaswaram over tambura drone, plaintive)" on
 * screen during the song. நீ சிரிச்ச நேரம் has 53,380 views.
 */

import {
  parseProductionSheet,
  looksLikeProductionSheet,
  sectionKindFor,
} from '@/lib/production-sheet';

/** The real shape of cnt_1783474963836_iknup2zv0's stored body. */
const SHEET = `[Intro]
(solo violin & nadaswaram over tambura drone, plaintive)

[Chorus - Female]
நீ சிரிச்ச நேரம்தான்...
என் நாளோட விடியலே...

[Verse 1]
நீ சொன்ன பேச்செல்லாம்...

[Outro]
(violin reprise, fade on tambura drone)`;

describe('annotations never become captions', () => {
  const r = parseProductionSheet(SHEET);
  const allLines = r.lyrics.sections.flatMap((s) => s.lines.map((l) => l.text));

  it('keeps only sung Tamil lines', () => {
    expect(allLines).toEqual([
      'நீ சிரிச்ச நேரம்தான்...',
      'என் நாளோட விடியலே...',
      'நீ சொன்ன பேச்செல்லாம்...',
    ]);
  });

  it('lets no bracketed header through as a line', () => {
    expect(allLines.some((l) => l.startsWith('['))).toBe(false);
  });

  it('lets no arrangement direction through as a line', () => {
    expect(allLines.some((l) => l.startsWith('('))).toBe(false);
    expect(allLines.join(' ')).not.toMatch(/violin|nadaswaram|tambura/);
  });

  /** Dropping is fine; dropping SILENTLY is what hid 37 songs. */
  it('reports every discarded direction', () => {
    expect(r.dropped).toEqual([
      '(solo violin & nadaswaram over tambura drone, plaintive)',
      '(violin reprise, fade on tambura drone)',
    ]);
  });
});

describe('section structure', () => {
  it('maps headers onto Tamil section kinds', () => {
    expect(sectionKindFor('Chorus - Female')).toBe('pallavi');
    expect(sectionKindFor('Verse 1')).toBe('charanam');
    expect(sectionKindFor('Intro')).toBe('intro');
    expect(sectionKindFor('Pre-Chorus')).toBe('anupallavi');
    expect(sectionKindFor('பல்லவி')).toBe('pallavi');
    expect(sectionKindFor('சரணம்')).toBe('charanam');
  });

  /** No counterpart in Tamil song form — say `other` rather than invent one. */
  it('does not force an unfamiliar section into a Tamil form', () => {
    expect(sectionKindFor('Bridge')).toBe('other');
    expect(sectionKindFor('Instrumental Break')).toBe('other');
  });

  /**
   * A purely instrumental section has no words. Emitting it would leave dead
   * structure in the caption track.
   */
  it('drops sections that contain no sung lines at all', () => {
    const r = parseProductionSheet(SHEET);
    expect(r.lyrics.sections.map((s) => s.kind)).toEqual(['pallavi', 'charanam']);
  });

  it('keeps a sung line that appears before any header', () => {
    const r = parseProductionSheet('முதல் வரி\n\n[Chorus]\nஇரண்டாம் வரி');
    expect(r.lyrics.sections[0].kind).toBe('other');
    expect(r.lyrics.sections[0].lines[0].text).toBe('முதல் வரி');
  });
});

describe('detecting which bodies need converting', () => {
  it('recognises an arrangement sheet', () => {
    expect(looksLikeProductionSheet(SHEET)).toBe(true);
  });

  it('leaves a plain lyric sheet alone', () => {
    expect(looksLikeProductionSheet('நீ சிரிச்ச நேரம்தான்\nஎன் நாளோட விடியலே')).toBe(false);
  });

  it('treats an empty body as not a sheet', () => {
    expect(looksLikeProductionSheet('')).toBe(false);
    expect(parseProductionSheet('').lyrics.sections).toEqual([]);
  });
});
