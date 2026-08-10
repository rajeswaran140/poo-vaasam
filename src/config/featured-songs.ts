/**
 * Featured "most-loved" songs — the curated top-5 promoted on the homepage rail
 * and the /popular page. Editorially chosen (currently the top 5 by lifetime
 * YouTube views), config-driven so refreshing the picks is a one-line change +
 * redeploy — right-sized for 5 songs, no live-ranking pipeline needed.
 *
 * Each card drives to YouTube (watch → subscribe = the funnel goal); a song that
 * also has an on-site /content page links there too. Covers use the video's
 * YouTube thumbnail (i.ytimg.com is allowed by next.config images).
 */

export interface FeaturedSong {
  videoId: string;
  /** Clean Tamil title (not the full emoji-laden YouTube title). */
  title: string;
  romanized: string;
  /**
   * The video's REAL YouTube publish timestamp, ISO 8601.
   *
   * Not decoration: `uploadDate` is a REQUIRED property of VideoObject, so
   * omitting it made all five objects invalid — Search Console reported it as
   * an ERROR on every one (2026-08-10). Read from the Data API, never guessed;
   * a wrong date here would be worse than no markup at all.
   */
  uploadDate: string;
  /** On-site content page id, when the song has one (funnel substrate). */
  contentId?: string;
}

// Top 5 by lifetime views (pulled 2026-07-12). Refresh as the catalogue grows.
// uploadDate values read from the YouTube Data API 2026-08-10.
export const FEATURED_SONGS: FeaturedSong[] = [
  { videoId: 'GXLu3Y7FghU', title: 'நீ சிரிச்ச நேரம் தான்', romanized: 'Nee Sirichcha Neram Thaan', uploadDate: '2026-06-11T01:09:34Z', contentId: 'cnt_1783474963836_iknup2zv0' },
  { videoId: 'eo3Mo--sgPY', title: 'என் மன்னவனே என் தென்னவனே', romanized: 'En Mannavane En Thennavane', uploadDate: '2026-06-26T00:29:43Z' },
  { videoId: 'H5NcoS41fA4', title: 'செவ்வந்தி பூவே', romanized: 'Sevvanthi Poove', uploadDate: '2026-06-16T14:12:22Z' },
  { videoId: 'lWt5kvapFKs', title: 'உன்னை பார்த்தால் போதாதே', romanized: 'Unnai Paarthaal Podhaadhe', uploadDate: '2026-06-29T13:09:58Z' },
  { videoId: 'KtFF0CCnCY4', title: 'என் பொன்மணி என் கண்மணி', romanized: 'En Ponmani En Kanmani', uploadDate: '2026-06-17T16:48:38Z' },
];

/** YouTube watch URL for a video (the promotion funnel endpoint). */
export const featuredWatchUrl = (videoId: string): string => `https://www.youtube.com/watch?v=${videoId}`;

/** YouTube thumbnail used as the card cover. */
export const featuredThumbUrl = (videoId: string): string => `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

/**
 * Schema.org ItemList of the featured songs, for the HOMEPAGE.
 *
 * WHY. The homepage is the site's single most-visited page (125 of 369 genuine
 * pageviews over 28 days, measured 2026-08-02) and it shows five songs with
 * cover art — but it marked up none of them. /videos carries 90 VideoObjects;
 * the page that actually gets traffic carried zero, so the songs Google sees
 * first are the ones on the page nobody lands on.
 *
 * `alternateName` carries the romanisation, which is how the diaspora searches.
 *
 * ⚠️ CORRECTED 2026-08-10. This originally omitted BOTH `description` and
 * `uploadDate`, reasoning that inventing them would be worse than omitting
 * them. Half right. `description` is merely RECOMMENDED, so leaving it out
 * costs a warning — but **`uploadDate` is REQUIRED**, and its absence made all
 * five VideoObjects invalid. Search Console reported 10 issues on `/`: 5×
 * ERROR "Missing field uploadDate" and 5× WARNING "Missing field description".
 * Invalid markup earns nothing, so the page was paying the maintenance cost of
 * structured data with none of the benefit.
 *
 * The fix is REAL dates from the Data API, not placeholders — the original
 * instinct against fabrication was right, it just needed the data fetched.
 *
 * `description` is STILL omitted, deliberately. The obvious source — the first
 * line of each YouTube description — is navigation boilerplate ("New here?
 * Start Here"), not prose about the song, and a description that merely
 * restates the title adds nothing. Song copy is Raj's own words and is never
 * ghostwritten, so this stays a warning until he supplies one line per song.
 *
 * Pure — no I/O, so the shape is unit-testable.
 */
export function featuredSongsItemListJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'மிகவும் விரும்பப்பட்ட பாடல்கள்',
    numberOfItems: FEATURED_SONGS.length,
    itemListElement: FEATURED_SONGS.map((song, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'VideoObject',
        name: song.title,
        alternateName: song.romanized,
        thumbnailUrl: featuredThumbUrl(song.videoId),
        contentUrl: featuredWatchUrl(song.videoId),
        embedUrl: `https://www.youtube.com/embed/${song.videoId}`,
        uploadDate: song.uploadDate,
        inLanguage: 'ta',
      },
    })),
  };
}
