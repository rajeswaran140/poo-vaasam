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
  /** On-site content page id, when the song has one (funnel substrate). */
  contentId?: string;
}

// Top 5 by lifetime views (pulled 2026-07-12). Refresh as the catalogue grows.
export const FEATURED_SONGS: FeaturedSong[] = [
  { videoId: 'GXLu3Y7FghU', title: 'நீ சிரிச்ச நேரம் தான்', romanized: 'Nee Sirichcha Neram Thaan', contentId: 'cnt_1783474963836_iknup2zv0' },
  { videoId: 'eo3Mo--sgPY', title: 'என் மன்னவனே என் தென்னவனே', romanized: 'En Mannavane En Thennavane' },
  { videoId: 'H5NcoS41fA4', title: 'செவ்வந்தி பூவே', romanized: 'Sevvanthi Poove' },
  { videoId: 'lWt5kvapFKs', title: 'உன்னை பார்த்தால் போதாதே', romanized: 'Unnai Paarthaal Podhaadhe' },
  { videoId: 'KtFF0CCnCY4', title: 'என் பொன்மணி என் கண்மணி', romanized: 'En Ponmani En Kanmani' },
];

/** YouTube watch URL for a video (the promotion funnel endpoint). */
export const featuredWatchUrl = (videoId: string): string => `https://www.youtube.com/watch?v=${videoId}`;

/** YouTube thumbnail used as the card cover. */
export const featuredThumbUrl = (videoId: string): string => `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
