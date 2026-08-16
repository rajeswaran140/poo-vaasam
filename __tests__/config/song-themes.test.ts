/** @jest-environment node */
/**
 * Song themes — and the one rule that matters:
 *
 * ⚠️ **ABSENCE OF A CLASSIFICATION IS NOT A CLASSIFICATION.**
 *
 * `themeForSong()` used to return `DEFAULT_SONG_THEME = 'love'` for any song
 * not in the curated map, so **missing data became wrong data**. Measured on
 * production 2026-08-16: seven published songs had no theme and every one was
 * filed under `love` — including three mother songs (அன்பெனும் தேரில், அம்மா...!,
 * அம்மா சொன்ன கதை) and an English track (Maple Breeze). The admin `love`
 * filter returned songs nobody had ever called love songs, and `/songs/love`
 * showed 31 while `/songs/father` 404'd for want of a second song.
 *
 * `love` must mean "someone classified this as love", never "nobody has looked
 * at this yet". A rendering fallback still exists for code that has to draw
 * something, but it is a separate, explicitly-named function.
 */

import {
  themeForSong,
  themeForSongWithOverride,
  themeForRendering,
  RENDERING_FALLBACK_THEME,
  SONG_THEME_BY_ID,
  SONG_THEMES,
} from '@/config/song-themes';

const CURATED_ID = Object.keys(SONG_THEME_BY_ID)[0];

describe('an unclassified song is null, not love', () => {
  it('returns null for a song nobody has classified', () => {
    expect(themeForSong('cnt_does_not_exist')).toBeNull();
  });

  it('returns null — not the fallback — even though a fallback exists', () => {
    expect(themeForSong('cnt_does_not_exist')).not.toBe(RENDERING_FALLBACK_THEME);
    expect(themeForSong('cnt_does_not_exist')).not.toBe('love');
  });

  it('still returns the curated theme for a song that HAS been classified', () => {
    expect(themeForSong(CURATED_ID)).toBe(SONG_THEME_BY_ID[CURATED_ID]);
  });
});

describe('themeForSongWithOverride', () => {
  it('lets a valid DB override win over the curated map', () => {
    expect(themeForSongWithOverride(CURATED_ID, 'homeland')).toBe('homeland');
  });

  it('falls back to the curated map when the override is junk', () => {
    expect(themeForSongWithOverride(CURATED_ID, 'not-a-theme')).toBe(SONG_THEME_BY_ID[CURATED_ID]);
  });

  /** The case that produced the bug: no override, no curated entry. */
  it('is null when there is neither an override nor a curated entry', () => {
    expect(themeForSongWithOverride('cnt_unknown', undefined)).toBeNull();
    expect(themeForSongWithOverride('cnt_unknown', '')).toBeNull();
    expect(themeForSongWithOverride('cnt_unknown', 'not-a-theme')).toBeNull();
  });

  it('accepts every real theme as an override', () => {
    for (const t of SONG_THEMES) {
      expect(themeForSongWithOverride('cnt_unknown', t)).toBe(t);
    }
  });
});

/**
 * The fallback still exists — a cover has to be drawn in SOME palette — but it
 * is now something a caller opts into by name, not something that happens
 * silently to every unclassified song.
 */
describe('themeForRendering is a drawing choice, not a claim', () => {
  it('supplies a palette for an unclassified song', () => {
    expect(themeForRendering(null)).toBe(RENDERING_FALLBACK_THEME);
    expect(themeForRendering(undefined)).toBe(RENDERING_FALLBACK_THEME);
  });

  it('never overrides a real classification', () => {
    expect(themeForRendering('mother')).toBe('mother');
    expect(themeForRendering('father')).toBe('father');
  });

  it('is the ONLY route back to a default — the resolvers do not take it', () => {
    const unclassified = themeForSongWithOverride('cnt_unknown', undefined);
    expect(unclassified).toBeNull();
    expect(themeForRendering(unclassified)).toBe(RENDERING_FALLBACK_THEME);
  });
});
