/**
 * Text matching for the on-page content search, made robust for Tamil.
 *
 * Tamil text typed by a visitor and Tamil stored in the DB can differ in Unicode
 * normalization form (the same glyph as composed NFC vs decomposed NFD code
 * points), so a naive `.includes()` silently fails to match identical-looking
 * strings. We normalize both sides to NFC, lowercase (a no-op for Tamil, helps
 * Latin), and collapse whitespace, so "type Tamil, find Tamil" just works.
 */

export function normalizeForSearch(text: string): string {
  return (text ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Does `haystack` contain `needle` after search normalization? Empty needle matches all. */
export function matchesSearch(haystack: string, needle: string): boolean {
  const q = normalizeForSearch(needle);
  if (!q) return true;
  return normalizeForSearch(haystack).includes(q);
}
