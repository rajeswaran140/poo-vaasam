/**
 * The fonts the Video Text tool offers, one list for the browser (drawing,
 * pickers) and the server (validating a saved style). Pure: no next/font here
 * (that is src/components/admin/video-text/fontFaces.ts, which defines the CSS
 * variables named below).
 *
 * A part draws with `<English font>, <Tamil font>, fallbacks`: the English
 * faces only cover Latin (unicode-range), so Tamil letters fall through to the
 * Tamil font and Latin letters, digits and punctuation take the English one.
 * "Plain" adds no English font, which is how text was drawn before fonts
 * could be chosen.
 */
import type { EnglishFontId, TamilFontId, TextStyle, Track, TrackStyle } from '@/types/videoText';

export interface FontChoice<Id extends string> {
  id: Id;
  label: string;
  hint: string;
  /** CSS variable holding the (hashed) family name; null = no font of its own. */
  cssVar: string | null;
  /** The weight drawn: 700, or 400 for a font with no bold. */
  weight: 400 | 700;
}

export const TAMIL_FONTS: readonly FontChoice<TamilFontId>[] = [
  { id: 'noto-sans-tamil', label: 'Noto Sans Tamil', hint: 'plain', cssVar: '--font-tamil', weight: 700 },
  { id: 'noto-serif-tamil', label: 'Noto Serif Tamil', hint: 'classic', cssVar: '--vt-noto-serif-tamil', weight: 700 },
  { id: 'mukta-malar', label: 'Mukta Malar', hint: 'clean, modern', cssVar: '--vt-mukta-malar', weight: 700 },
  { id: 'arima', label: 'Arima', hint: 'decorative', cssVar: '--vt-arima', weight: 700 },
  { id: 'baloo-thambi-2', label: 'Baloo Thambi 2', hint: 'round, bold', cssVar: '--font-baloo-thambi', weight: 700 },
  { id: 'kavivanar', label: 'Kavivanar', hint: 'handwritten', cssVar: '--font-kavivanar', weight: 400 },
];

export const ENGLISH_FONTS: readonly FontChoice<EnglishFontId>[] = [
  { id: 'plain', label: 'Plain', hint: 'as before', cssVar: null, weight: 700 },
  { id: 'montserrat', label: 'Montserrat', hint: 'clean', cssVar: '--vt-montserrat', weight: 700 },
  { id: 'poppins', label: 'Poppins', hint: 'round, modern', cssVar: '--vt-poppins', weight: 700 },
  { id: 'playfair-display', label: 'Playfair Display', hint: 'elegant', cssVar: '--vt-playfair-display', weight: 700 },
  { id: 'lora', label: 'Lora', hint: 'book style', cssVar: '--vt-lora', weight: 700 },
  { id: 'oswald', label: 'Oswald', hint: 'tall, bold', cssVar: '--vt-oswald', weight: 700 },
  { id: 'dancing-script', label: 'Dancing Script', hint: 'handwritten', cssVar: '--vt-dancing-script', weight: 700 },
];

export const TAMIL_FONT_IDS = TAMIL_FONTS.map((f) => f.id) as [TamilFontId, ...TamilFontId[]];
export const ENGLISH_FONT_IDS = ENGLISH_FONTS.map((f) => f.id) as [EnglishFontId, ...EnglishFontId[]];
export const DEFAULT_TAMIL_FONT: TamilFontId = 'noto-sans-tamil';
export const DEFAULT_ENGLISH_FONT: EnglishFontId = 'plain';
export const TRACK_SIZE_MIN = 0.5;
export const TRACK_SIZE_MAX = 2;

export const tamilFont = (id: TamilFontId | undefined) => TAMIL_FONTS.find((f) => f.id === id) ?? TAMIL_FONTS[0];
export const englishFont = (id: EnglishFontId | undefined) => ENGLISH_FONTS.find((f) => f.id === id) ?? ENGLISH_FONTS[0];

/** A part's effective look: its own settings, else the project's size and the default fonts. */
export function trackStyleOf(track: Track, style: TextStyle): Required<TrackStyle> {
  const own = style.tracks?.[track] ?? {};
  return {
    size: own.size ?? style.sizeScale,
    tamilFont: tamilFont(own.tamilFont).id,
    englishFont: englishFont(own.englishFont).id,
  };
}
