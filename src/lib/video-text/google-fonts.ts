/**
 * The Google fonts the Video Text tool offers (google-fonts.json, rebuilt by
 * scripts/update-google-fonts.ts). Pure: the browser picker, the drawing code
 * and the server's style validation all read this one list.
 *
 * A Google font is stored as `g:<Family>`. In the Tamil slot it must include
 * Tamil, in the English slot English (latin) — so a saved style can never ask
 * for a script the font does not have.
 */
import data from './google-fonts.json';
import type { GoogleFontId } from '@/types/videoText';

export type GoogleCategory = 's' | 'r' | 'd' | 'h' | 'm';
export interface GoogleFont {
  family: string;
  category: GoogleCategory;
  /** The weight drawn: 700, or the font's nearest upright weight when it has no bold. */
  weight: number;
  latin: boolean;
  tamil: boolean;
}

export const GOOGLE_CATEGORY_LABEL: Record<GoogleCategory, string> = {
  s: 'Sans serif', r: 'Serif', d: 'Display', h: 'Handwriting', m: 'Monospace',
};

const PREFIX = 'g:';

export const GOOGLE_FONTS: readonly GoogleFont[] = (data.fonts as Array<[string, string, number, number]>).map(
  ([family, category, weight, scripts]) => ({
    family,
    category: category as GoogleCategory,
    weight,
    latin: (scripts & 1) !== 0,
    tamil: (scripts & 2) !== 0,
  }),
);
const BY_FAMILY = new Map(GOOGLE_FONTS.map((f) => [f.family, f]));

export const googleFontId = (family: string): GoogleFontId => `${PREFIX}${family}`;
export const isGoogleId = (id: unknown): id is GoogleFontId => typeof id === 'string' && id.startsWith(PREFIX);

/** The font a `g:` id names, or undefined when it is not one Google offers for that script. */
export function googleFontFor(id: unknown, script: 'tamil' | 'latin'): GoogleFont | undefined {
  if (!isGoogleId(id)) return undefined;
  const f = BY_FAMILY.get(id.slice(PREFIX.length));
  return f && f[script] ? f : undefined;
}
