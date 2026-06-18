/**
 * Text matching for the on-page content search, made robust for Tamil.
 *
 * Tamil text typed by a visitor and Tamil stored in the DB can differ in Unicode
 * normalization form (the same glyph as composed NFC vs decomposed NFD code
 * points), so a naive `.includes()` silently fails to match identical-looking
 * strings. We normalize both sides to NFC, lowercase (a no-op for Tamil, helps
 * Latin), and collapse whitespace, so "type Tamil, find Tamil" just works.
 *
 * Beyond that, a ROMANISED fallback lets diaspora who can't read the script find
 * songs by typing in Latin ("nee siricha neram" → நீ சிரிச்ச நேரம்). It only
 * kicks in when the query contains Latin letters, so pure-Tamil searches keep
 * their exact behaviour (no phonetic false positives). See tamil-romanize.ts.
 */

import { tamilPhoneticKey, phoneticKey } from '@/lib/tamil-romanize';

export function normalizeForSearch(text: string): string {
  return (text ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** True when the query has any Latin letter (→ try the romanised fallback). */
function hasLatin(text: string): boolean {
  return /[a-z]/i.test(text);
}

/**
 * Does `haystack` contain `needle`? Empty needle matches all. Tries an exact
 * (NFC-normalised) substring match first, then — for Latin queries — a phonetic
 * romanised match so roman input finds Tamil content.
 */
export function matchesSearch(haystack: string, needle: string): boolean {
  const q = normalizeForSearch(needle);
  if (!q) return true;

  if (normalizeForSearch(haystack).includes(q)) return true;

  if (hasLatin(needle)) {
    const nk = phoneticKey(needle);
    if (nk && tamilPhoneticKey(haystack).includes(nk)) return true;
  }

  return false;
}
