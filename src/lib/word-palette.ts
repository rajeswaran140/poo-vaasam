/**
 * Word-palette logic for the Composer writing surface (Lexicon P2).
 *
 * Pure, deterministic, no I/O and NO LLM — the payoff is at the moment of
 * writing: offer `fresh` lexicon words to draw from, and lint the lyrics draft
 * for worn (`overused` / `avoid`) words. Kept separate from the UI so the
 * selection + tokenisation rules are unit-testable.
 */

import { normalizeWord, WORN_USAGES } from '@/types/lexicon';
import { migrateUsage } from '@/lib/lexicon-migrate';

export interface PaletteWord {
  word: string;
  romanization?: string;
  gloss: string;
  register: string;
  usage: string;
  themes: string[];
  archived?: boolean;
}

export interface PaletteFilters {
  register?: string;
  theme?: string;
  /**
   * Widen the palette beyond `fresh` to the un-worn middle (`normal`,
   * `familiar`). Named for what it does rather than for a usage value, since
   * the old single `neutral` value is now two.
   */
  includeNeutral?: boolean;
}

/**
 * Words to OFFER while writing: never archived, never worn; `fresh` by default
 * (optionally the un-worn middle too), narrowed by register/theme.
 *
 * ⚠️ Usage is mapped forward before comparison. A caller holding a row read
 * outside the repository (a fixture, a cached payload written under the old
 * vocabulary) would otherwise carry `retire`, which matches none of the current
 * values — and would be silently OFFERED as a fresh word, the exact inversion
 * of what the flag means.
 */
export function buildPalette<T extends PaletteWord>(words: T[], filters: PaletteFilters = {}): T[] {
  const { register, theme, includeNeutral = false } = filters;
  return words.filter((w) => {
    if (w.archived) return false;
    const usage = migrateUsage(w.usage);
    if (WORN_USAGES.includes(usage)) return false;
    if (!includeNeutral && usage !== 'fresh') return false;
    if (register && w.register !== register) return false;
    if (theme && !w.themes.includes(theme)) return false;
    return true;
  });
}

/** Split text into NFC word tokens (Tamil letters + combining marks, or ASCII). */
export function tokenizeLyrics(text: string): string[] {
  return (text ?? '')
    .normalize('NFC')
    .split(/[^\p{L}\p{M}]+/u)
    .map((t) => t.trim())
    .filter(Boolean);
}

export interface DraftAnalysis<T> {
  /** Distinct worn (`overused` / `avoid`) words present in the draft — swap these. */
  overused: T[];
  /** Distinct `fresh` lexicon words the draft already uses — encouragement. */
  freshUsed: T[];
}

/**
 * Lint a lyrics draft against the lexicon. A single-token headword matches by
 * word boundary; a multi-word headword matches as a normalised substring.
 */
export function analyzeDraft<T extends PaletteWord>(lyrics: string, words: T[]): DraftAnalysis<T> {
  const normText = (lyrics ?? '').normalize('NFC');
  const tokens = new Set(tokenizeLyrics(lyrics).map(normalizeWord));
  const present = (word: string): boolean => {
    const w = normalizeWord(word);
    if (!w) return false;
    return w.includes(' ') ? normText.includes(w) : tokens.has(w);
  };

  const overused: T[] = [];
  const freshUsed: T[] = [];
  for (const w of words) {
    if (w.archived || !present(w.word)) continue;
    const usage = migrateUsage(w.usage);
    if (WORN_USAGES.includes(usage)) overused.push(w);
    else if (usage === 'fresh') freshUsed.push(w);
  }
  return { overused, freshUsed };
}
