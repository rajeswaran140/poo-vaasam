/**
 * Careful Tamil Unicode normalization for MATCHING — never for display.
 *
 * The rule that governs this file: **the author's spelling is the truth.** We
 * derive a match key so duplicates and searches behave, and we store it
 * alongside the original; we never write the derived form back over the word
 * Raj typed. Tamil orthography carries real distinctions (பு vs பூ, ண vs ன vs ந)
 * that an "aggressive" normalizer would happily destroy, so this does the least
 * that makes matching work:
 *
 *   - NFC compose (Tamil vowel signs are combining marks; NFC is the form the
 *     rest of the stack, DynamoDB keys included, already assumes)
 *   - trim and collapse internal whitespace
 *   - strip FORMAT characters that are invisible and carry no Tamil meaning:
 *     ZWSP/ZWNJ/ZWJ, BOM, soft hyphen, bidi marks, variation selectors
 *
 * It does NOT: transliterate, remove the pulli (U+0BCD), fold ligatures, strip
 * vowel signs, or touch letter identity in any way.
 *
 * ⚠️ WHY THIS IS NOT `normalizeWord`. `normalizeWord` (NFC + trim) is baked into
 * the DynamoDB sort key `GSI1SK = <word>#<id>` for every existing row. Widening
 * it to also strip zero-width characters would silently change the key that
 * `findByWord` searches with, and any legacy row containing a ZWNJ would become
 * unfindable. So `normalizeWord` stays frozen as the STORAGE key, and this is
 * the separate MATCH key — stored in its own attribute, used for duplicate
 * detection and search only.
 */

/**
 * Invisible formatting characters. ZWNJ/ZWJ do appear in Tamil text (some input
 * methods and fonts emit them around the pulli and around ligature-forming
 * clusters), but they never change which word it is — so two entries differing
 * only by a ZWNJ are the same headword typed on two different keyboards, which
 * is precisely the duplicate we want to catch.
 */
const INVISIBLE = /[​-‏‪-‮⁠-⁤﻿­︀-️]/g;

/** Whitespace, including the Unicode spaces a paste from a PDF drags in. */
const WHITESPACE = /[\s  - 　]+/g;

/**
 * The match key for a headword: same letters, no invisible noise, single spaces.
 * Case-folded so English glosses and romanisations compare sanely; Tamil has no
 * case, so this is a no-op for Tamil letters.
 */
export function matchKey(word: string): string {
  return (word ?? '')
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(WHITESPACE, ' ')
    .trim()
    .toLowerCase();
}

/** Tamil block, including the Grantha letters Tamil borrows (U+0B82–U+0BFA). */
const TAMIL_LETTER = /[஀-௿]/;

/** A Tamil vowel sign / pulli — legal after a base letter, never at the start. */
const TAMIL_COMBINING_START = /^[ா-்ௗ]/;

/**
 * Characters that are legitimate INSIDE a Tamil headword: Tamil letters and
 * marks, ZWNJ/ZWJ, whitespace, ASCII letters (romanised entries), and the few
 * punctuation marks that appear in real compounds (a hyphen in a coined
 * compound, an apostrophe in a romanisation).
 */
const ALLOWED = /^[஀-௿‌‍\sA-Za-z'’.-]+$/;

/** Other Indic scripts — Devanagari through Malayalam. */
const OTHER_INDIC = /[ऀ-୿ఀ-ൿ]/;

export interface TamilFormIssue {
  code: 'empty' | 'no-tamil' | 'foreign-script' | 'stray-punctuation' | 'combining-start';
  message: string;
}

/**
 * Report what is malformed about a headword, or null when it looks fine.
 *
 * Conservative by design: it reports things that are almost certainly a paste
 * accident (a Devanagari letter, a leading vowel sign with nothing to attach
 * to), not things that are merely unusual. A false positive here nags the poet
 * about his own correct spelling, which is worse than missing one.
 */
export function tamilFormIssue(word: string): TamilFormIssue | null {
  const w = (word ?? '').normalize('NFC').replace(INVISIBLE, '').trim();
  if (!w) return { code: 'empty', message: 'Empty word.' };

  if (!TAMIL_LETTER.test(w)) {
    return { code: 'no-tamil', message: 'No Tamil letters — is this a headword or a gloss?' };
  }

  // A vowel sign or pulli with no base letter before it: the paste lost a char.
  if (TAMIL_COMBINING_START.test(w)) {
    return { code: 'combining-start', message: 'Starts with a vowel sign — a base letter is missing.' };
  }

  if (!ALLOWED.test(w)) {
    // Distinguish "another Indic script got mixed in" from "a stray comma".
    if (OTHER_INDIC.test(w)) {
      return { code: 'foreign-script', message: 'Mixes another Indic script into a Tamil word.' };
    }
    return { code: 'stray-punctuation', message: 'Contains punctuation or symbols that are not part of the word.' };
  }

  return null;
}

/**
 * Does this string contain Tamil letters? Used to route a search query — a
 * Tamil query searches the Tamil fields, an ASCII one also searches glosses.
 */
export function hasTamil(text: string): boolean {
  return TAMIL_LETTER.test(text ?? '');
}
