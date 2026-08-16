/**
 * lyrics-text — bridges the admin form's plain-text textarea and the structured
 * LyricsDTO. Reuses the Lyrics value object's parser, so it inherits marker
 * detection + sanitisation; these tests cover the form-facing contract.
 */

import { lyricsTextToDTO, lyricsDTOToText } from '@/lib/lyrics-text';

describe('lyricsTextToDTO', () => {
  it('returns undefined for blank input (so the API omits lyrics)', () => {
    expect(lyricsTextToDTO('')).toBeUndefined();
    expect(lyricsTextToDTO('   \n  ')).toBeUndefined();
  });

  it('parses labelled, blank-line-separated verses into a DTO', () => {
    const dto = lyricsTextToDTO('பல்லவி\nநீ சிரிச்ச நேரம்\n\nசரணம்\nவரி ஒன்று');
    expect(dto).toEqual({
      sections: [
        { kind: 'pallavi', label: 'பல்லவி', lines: [{ text: 'நீ சிரிச்ச நேரம்' }] },
        { kind: 'charanam', label: 'சரணம்', lines: [{ text: 'வரி ஒன்று' }] },
      ],
    });
  });
});

describe('lyricsDTOToText', () => {
  it('flattens a DTO back to editable text', () => {
    const dto = { sections: [{ kind: 'pallavi' as const, label: 'பல்லவி', lines: [{ text: 'வரி' }] }] };
    expect(lyricsDTOToText(dto)).toBe('பல்லவி\nவரி');
  });

  it('returns "" for null/undefined (legacy rows with no lyrics)', () => {
    expect(lyricsDTOToText(null)).toBe('');
    expect(lyricsDTOToText(undefined)).toBe('');
  });
});

describe('round-trip', () => {
  it('text → DTO → text preserves labelled structure', () => {
    const text = 'பல்லவி\nநீ சிரிச்ச நேரம்\n\nசரணம்\nவரி ஒன்று';
    expect(lyricsDTOToText(lyricsTextToDTO(text))).toBe(text);
  });
});
