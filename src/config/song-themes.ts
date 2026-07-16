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

export const SONG_THEMES = ['love', 'mother', 'father', 'nature', 'tamil', 'homeland', 'motivation'] as const;
export type SongTheme = (typeof SONG_THEMES)[number];

/** Tamil chip labels — kept short so the filter row stays one line on mobile. */
export const SONG_THEME_LABELS: Record<SongTheme, string> = {
  love: 'காதல்',
  mother: 'அன்னை',
  father: 'அப்பா',
  nature: 'இயற்கை',
  tamil: 'தமிழ்',
  homeland: 'தாயகம்',
  motivation: 'ஊக்கம்',
};

/** Default theme for any song not listed in SONG_THEME_BY_ID. */
export const DEFAULT_SONG_THEME: SongTheme = 'love';

/**
 * Curated assignments — edit this when you publish a new song.
 * Songs not listed here fall back to DEFAULT_SONG_THEME.
 */
export const SONG_THEME_BY_ID: Record<string, SongTheme> = {
  cnt_1780067292588_frlxbwfzh: 'nature',    // இரை தேட சென்றதாய்
  cnt_1780066149991_18z5eyynd: 'mother',    // முத்தமிழின் மூன்றெழுத்தில்
  cnt_1780067292560_ixhyejnr3: 'mother',    // அன்பெனும் தேரில்
  cnt_1780419293978_31gt0nq13: 'mother',    // அரிதான பெரும் பாசம் (யூடியூப்: c61mxpSgAAA)
  cnt_1780855949386_2y4i1y64d: 'mother',    // கண்ணோடு நீர் அள்ளி (யூடியூப்: DozdKmt0cLY)
  cnt_1780856529972_6vrbl2icr: 'mother',    // செவ்விழி ஓவியமே (யூடியூப்: h1WgaJW9khI) — தாய் மகள் பாசப் பாடல்
  cnt_1780856975823_fmfd5xgpf: 'mother',    // அம்மா சொன்ன கதை (site-only — no YouTube video yet)
  cnt_1780193983131_fjtgmrgm3: 'homeland',  // என் தேசமே என் சுவாசமே
  // Everything else → 'love' (என்ன மாயம், தூக்கணாங்குருவி போல, ஒரு நாள் திருநாள்,
  // அக்கம் பக்கம், முடிவில்லா முகத்தினில், அந்தி மேகமே, பொன்வானம் சாயுதே).
};

export function themeForSong(id: string): SongTheme {
  return SONG_THEME_BY_ID[id] ?? DEFAULT_SONG_THEME;
}

/**
 * Same as themeForSong, but lets a per-song DB override win over the hand
 * curated config map. Use this when you've loaded a song record and have
 * its theme override string (admin /admin/songs writes this field via
 * /api/admin/songs/[id]/theme).
 */
export function themeForSongWithOverride(
  id: string,
  override: unknown
): SongTheme {
  if (typeof override === 'string' && (SONG_THEMES as readonly string[]).includes(override)) {
    return override as SongTheme;
  }
  return themeForSong(id);
}
