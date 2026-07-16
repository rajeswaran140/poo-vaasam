/**
 * SEO collection landing pages — one per song theme at /songs/[theme]
 * (e.g. "Tamil Mother Songs"). These target broad category searches that an
 * individual song page can't, and act as internal-linking hubs back to the
 * songs. Original descriptive copy only — NO lyrics.
 *
 * A theme only gets a page once it has at least MIN_SONGS_FOR_COLLECTION
 * playable songs, so we never publish a thin one-song page that hurts SEO.
 * Eligibility is computed from the same SongCatalog source the pages render,
 * so the sitemap, generateStaticParams, and the page can never disagree.
 */

import type { SongTheme } from './song-themes';
import { SONG_THEMES } from './song-themes';

export const MIN_SONGS_FOR_COLLECTION = 2;

export interface SongCollection {
  theme: SongTheme;
  englishTitle: string;
  tamilTitle: string;
  metaDescription: string;
  /** Original intro paragraph shown on the page (no lyrics). */
  intro: string;
}

export const SONG_COLLECTIONS: Record<SongTheme, SongCollection> = {
  mother: {
    theme: 'mother',
    englishTitle: 'Tamil Mother Songs',
    tamilTitle: 'அன்னை பாடல்கள்',
    metaDescription:
      "Original Tamil mother songs — annai paadalgal — heartfelt tributes to a mother's love, written and composed by Rajeswaran Thangarajah. Listen free on Tamilagaval.",
    intro:
      'Original Tamil songs devoted to அன்னை — the love, sacrifice and tenderness of a mother. Each is written and composed by Rajeswaran Thangarajah, drawn from memory, gratitude, and the unbreakable bond between mother and child. Listen free, and watch on YouTube.',
  },
  love: {
    theme: 'love',
    englishTitle: 'Tamil Love Songs',
    tamilTitle: 'காதல் பாடல்கள்',
    metaDescription:
      'Original Tamil love songs — kaadhal paadalgal — tender, melodic love songs written and composed by Rajeswaran Thangarajah. Listen free on Tamilagaval.',
    intro:
      'A collection of original Tamil love songs — காதல் பாடல்கள் — capturing first glances, longing, and the quiet beauty of two hearts. Written and composed by Rajeswaran Thangarajah. Listen free, and watch on YouTube.',
  },
  homeland: {
    theme: 'homeland',
    englishTitle: 'Tamil Homeland Songs',
    tamilTitle: 'தாயக பாடல்கள்',
    metaDescription:
      'Original Tamil homeland songs — thaayaga paadalgal — songs of soil, language and belonging by Rajeswaran Thangarajah. Listen free on Tamilagaval.',
    intro:
      'Original Tamil songs of தாயகம் — homeland, memory and belonging; the scent of the soil and the sweetness of the mother tongue. Written and composed by Rajeswaran Thangarajah. Listen free, and watch on YouTube.',
  },
  nature: {
    theme: 'nature',
    englishTitle: 'Tamil Nature Songs',
    tamilTitle: 'இயற்கை பாடல்கள்',
    metaDescription:
      'Original Tamil nature songs — iyarkai paadalgal — songs inspired by the natural world by Rajeswaran Thangarajah. Listen free on Tamilagaval.',
    intro:
      'Original Tamil songs inspired by இயற்கை — birds, seasons, rivers and the quiet poetry of the natural world. Written and composed by Rajeswaran Thangarajah. Listen free, and watch on YouTube.',
  },
  tamil: {
    theme: 'tamil',
    englishTitle: 'Tamil Language Songs',
    tamilTitle: 'தமிழ் பாடல்கள்',
    metaDescription:
      'Original songs celebrating the Tamil language — thamizh paadalgal — by Rajeswaran Thangarajah. Listen free on Tamilagaval.',
    intro:
      'Original songs in praise of தமிழ் — the beauty, antiquity and music of the Tamil language itself. Written and composed by Rajeswaran Thangarajah. Listen free, and watch on YouTube.',
  },
  father: {
    theme: 'father',
    englishTitle: 'Tamil Father Songs',
    tamilTitle: 'அப்பா பாடல்கள்',
    metaDescription:
      "Original Tamil father songs — appa paadalgal — tributes to a father's strength and love by Rajeswaran Thangarajah. Listen free on Tamilagaval.",
    intro:
      "Original Tamil songs honouring அப்பா — a father's strength, sacrifice and quiet love. Written and composed by Rajeswaran Thangarajah. Listen free, and watch on YouTube.",
  },
  motivation: {
    theme: 'motivation',
    englishTitle: 'Tamil Motivation Songs',
    tamilTitle: 'ஊக்கப் பாடல்கள்',
    metaDescription:
      'Original Tamil motivation songs — ஊக்கப் paadalgal — songs of courage, hope and inner strength by Rajeswaran Thangarajah. Listen free on Tamilagaval.',
    intro:
      'Original Tamil songs of ஊக்கம் — courage, perseverance and the quiet resolve to rise again. Written and composed by Rajeswaran Thangarajah. Listen free, and watch on YouTube.',
  },
};

export function isCollectionTheme(value: string): value is SongTheme {
  return (SONG_THEMES as readonly string[]).includes(value);
}

/**
 * Singular English label for ONE song of a theme, e.g. "Tamil Homeland Song"
 * (derived from the collection's plural title). Used to theme a song page's
 * crawler-facing meta description so the snippet carries the themed keyword
 * (homeland / mother / love …) instead of a generic "Tamil Song".
 */
export function themeSongLabelEn(theme: SongTheme): string {
  return SONG_COLLECTIONS[theme].englishTitle.replace(/Songs$/, 'Song');
}

/**
 * Themes that currently have enough songs to warrant a collection page.
 * `songThemes` = the resolved theme of every published, playable song
 * (PublicSongDTO.theme). Order follows SONG_THEMES for stable output.
 */
export function eligibleCollectionThemes(songThemes: string[]): SongTheme[] {
  const counts = new Map<string, number>();
  for (const t of songThemes) counts.set(t, (counts.get(t) ?? 0) + 1);
  return SONG_THEMES.filter((t) => (counts.get(t) ?? 0) >= MIN_SONGS_FOR_COLLECTION);
}
