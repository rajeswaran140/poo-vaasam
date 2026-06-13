/** @jest-environment node */
/**
 * Tests for the SEO song-collection config + eligibility helper.
 */

import {
  eligibleCollectionThemes,
  isCollectionTheme,
  SONG_COLLECTIONS,
  MIN_SONGS_FOR_COLLECTION,
  themeSongLabelEn,
} from '@/config/song-collections';
import { SONG_THEMES } from '@/config/song-themes';

describe('themeSongLabelEn', () => {
  it('gives a singular themed song label per theme (homeland → "Tamil Homeland Song")', () => {
    expect(themeSongLabelEn('homeland')).toBe('Tamil Homeland Song');
    expect(themeSongLabelEn('mother')).toBe('Tamil Mother Song');
    expect(themeSongLabelEn('love')).toBe('Tamil Love Song');
  });

  it('singularises every theme label (no trailing "Songs")', () => {
    for (const theme of SONG_THEMES) {
      const label = themeSongLabelEn(theme);
      expect(label.endsWith('Song')).toBe(true);
      expect(label.endsWith('Songs')).toBe(false);
    }
  });
});

describe('song-collections', () => {
  it('has a complete, lyrics-free collection entry for every theme', () => {
    for (const t of SONG_THEMES) {
      const c = SONG_COLLECTIONS[t];
      expect(c).toBeDefined();
      expect(c.englishTitle).toMatch(/Tamil/);
      expect(c.tamilTitle.length).toBeGreaterThan(0);
      expect(c.metaDescription.length).toBeGreaterThan(20);
      // descriptive copy, never the actual lyrics
      expect(c.intro).not.toMatch(/lyrics|வரிகள்/i);
    }
  });

  it('isCollectionTheme accepts valid themes and rejects anything else', () => {
    expect(isCollectionTheme('mother')).toBe(true);
    expect(isCollectionTheme('love')).toBe(true);
    expect(isCollectionTheme('nonsense')).toBe(false);
    expect(isCollectionTheme('')).toBe(false);
  });

  it('eligibleCollectionThemes returns only themes meeting the threshold, in SONG_THEMES order', () => {
    // mother×2, love×3, homeland×1
    const eligible = eligibleCollectionThemes(['mother', 'mother', 'love', 'love', 'love', 'homeland']);
    expect(eligible).toContain('mother');
    expect(eligible).toContain('love');
    expect(eligible).not.toContain('homeland'); // only one song
    // ordering follows SONG_THEMES (love precedes mother there)
    expect(eligible.indexOf('love')).toBeLessThan(eligible.indexOf('mother'));
  });

  it('returns [] when nothing meets the threshold', () => {
    expect(eligibleCollectionThemes(['mother', 'love', 'homeland'])).toEqual([]); // each just one
    expect(eligibleCollectionThemes([])).toEqual([]);
  });

  it('never publishes a thin one-song page (threshold >= 2)', () => {
    expect(MIN_SONGS_FOR_COLLECTION).toBeGreaterThanOrEqual(2);
  });
});
