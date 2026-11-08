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
import type { EnglishFontId, TamilFontId, TextColorId, TextStyle, Track, TrackStyle } from '@/types/videoText';
import { googleFontFor, type GoogleFont } from './google-fonts';

export interface FontChoice<Id extends string = string> {
  id: Id;
  label: string;
  hint: string;
  /** CSS variable holding the (hashed) family name; null = no font of its own. */
  cssVar: string | null;
  /** The weight drawn: 700, or the font's own weight when it has no bold. */
  weight: number;
  /** A Google font: loaded from Google when used, under its own family name (google-font-loader.ts). */
  google?: GoogleFont;
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

/** A Google font as a choice: no CSS variable, drawn under the family the loader registers. */
const googleChoice = <Id extends string>(id: Id, g: GoogleFont): FontChoice<Id> => ({
  id, label: g.family, hint: 'Google font', cssVar: null, weight: g.weight, google: g,
});

/** True for a Tamil font the tool can draw: a built-in one, or a Google font that has Tamil. */
export const isTamilFontId = (id: unknown): id is TamilFontId =>
  TAMIL_FONTS.some((f) => f.id === id) || googleFontFor(id, 'tamil') !== undefined;
/** True for an English font the tool can draw: a built-in one, or a Google font that has English letters. */
export const isEnglishFontId = (id: unknown): id is EnglishFontId =>
  ENGLISH_FONTS.some((f) => f.id === id) || googleFontFor(id, 'latin') !== undefined;
export const DEFAULT_TAMIL_FONT: TamilFontId = 'noto-sans-tamil';
export const DEFAULT_ENGLISH_FONT: EnglishFontId = 'plain';
export const TRACK_SIZE_MIN = 0.5;
export const TRACK_SIZE_MAX = 2;

export function tamilFont(id: TamilFontId | undefined): FontChoice<TamilFontId> {
  const g = googleFontFor(id, 'tamil');
  if (g && id) return googleChoice(id, g);
  return TAMIL_FONTS.find((f) => f.id === id) ?? TAMIL_FONTS[0];
}
export function englishFont(id: EnglishFontId | undefined): FontChoice<EnglishFontId> {
  const g = googleFontFor(id, 'latin');
  if (g && id) return googleChoice(id, g);
  return ENGLISH_FONTS.find((f) => f.id === id) ?? ENGLISH_FONTS[0];
}

export const TEXT_COLORS: readonly { id: TextColorId; label: string; css: string }[] = [
  { id: 'white', label: 'White', css: '#ffffff' },
  { id: 'yellow', label: 'Yellow', css: '#ffe14d' },
  { id: 'gold', label: 'Gold', css: '#f2c267' },
  { id: 'cream', label: 'Cream', css: '#fff1d0' },
];
export const TEXT_COLOR_IDS = TEXT_COLORS.map((c) => c.id) as [TextColorId, ...TextColorId[]];
export const textColor = (id: TextColorId | undefined) => TEXT_COLORS.find((c) => c.id === id) ?? TEXT_COLORS[0];

/** Fade in and out over this long (shortened to half a block on very short blocks). */
export const FADE_SEC = 0.3;

/** A part's effective look: its own settings, else the project's size, the default fonts, white, no box, no fade. */
export function trackStyleOf(track: Track, style: TextStyle): Required<TrackStyle> {
  const own = style.tracks?.[track] ?? {};
  return {
    size: own.size ?? style.sizeScale,
    tamilFont: tamilFont(own.tamilFont).id,
    englishFont: englishFont(own.englishFont).id,
    color: textColor(own.color).id,
    box: own.box ?? false,
    fade: own.fade ?? false,
  };
}

/**
 * How visible a block is at time t (0..1): fully, unless its part fades, then
 * a linear ramp over FADE_SEC at each end (at most half the block). The
 * preview draws with this; the render's ffmpeg fade ramps the same way.
 */
export function fadeAlphaAt(block: { startSec: number; endSec: number }, fade: boolean, t: number): number {
  if (t < block.startSec || t >= block.endSec) return 0;
  if (!fade) return 1;
  const d = fadeSecFor(block);
  return Math.max(0, Math.min(1, (t - block.startSec) / d, (block.endSec - t) / d));
}

/** The fade length for a block: FADE_SEC, or half the block when shorter. */
export const fadeSecFor = (block: { startSec: number; endSec: number }) =>
  Math.min(FADE_SEC, (block.endSec - block.startSec) / 2);
