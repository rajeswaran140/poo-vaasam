/**
 * Per-song theme tags for the /songs page filter chips.
 *
 * Lightweight first cut: hand-curated mapping from song ID → theme so listeners
 * can browse by mood without us touching DynamoDB. When a new song is published,
 * add its ID below — anything missing defaults to `love` (matches the current
 * skew of the catalogue, so the chip never lies for unmapped tracks).
 *
 * Replace this with DynamoDB `categoryIds` once the admin form sets them.
 */

export const SONG_THEMES = ['love', 'mother', 'nature', 'tamil'] as const;
export type SongTheme = (typeof SONG_THEMES)[number];

/** Tamil chip labels — kept short so the filter row stays one line on mobile. */
export const SONG_THEME_LABELS: Record<SongTheme, string> = {
  love: 'காதல்',
  mother: 'அன்னை',
  nature: 'இயற்கை',
  tamil: 'தமிழ்',
};

/** Default theme for any song not listed in SONG_THEME_BY_ID. */
export const DEFAULT_SONG_THEME: SongTheme = 'love';

/**
 * Curated assignments — edit this when you publish a new song.
 * Songs not listed here fall back to DEFAULT_SONG_THEME.
 */
export const SONG_THEME_BY_ID: Record<string, SongTheme> = {
  cnt_1780067292588_frlxbwfzh: 'nature',  // இரை தேட சென்றதாய்
  cnt_1780066149991_18z5eyynd: 'mother',  // முத்தமிழின் மூன்றெழுத்தில்
  cnt_1780067292560_ixhyejnr3: 'mother',  // அன்பெனும் தேரில்
  // Everything else → 'love' (என்ன மாயம், தூக்கணாங்குருவி போல, ஒரு நாள் திருநாள்,
  // அக்கம் பக்கம், முடிவில்லா முகத்தினில், அந்தி மேகமே).
};

export function themeForSong(id: string): SongTheme {
  return SONG_THEME_BY_ID[id] ?? DEFAULT_SONG_THEME;
}
