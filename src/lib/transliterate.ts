/**
 * Transliteration helpers (pure, shared by the proxy route + the input field).
 *
 * We can't call Google's Input Tools endpoint from the browser — it returns no
 * CORS header, so the request is blocked (this is why the old react-transliterate
 * input silently stopped suggesting). Instead the server proxies it; these pure
 * helpers build the request URL, parse the response, and find the word under the
 * caret — all unit-testable without a network or the DOM.
 */

/** Build the Google Input Tools request URL for `text` in `lang` (default Tamil). */
export function inputToolsUrl(text: string, lang = 'ta', num = 9): string {
  const params = new URLSearchParams({
    text,
    itc: `${lang}-t-i0-und`,
    num: String(num),
    cp: '0',
    cs: '1',
    ie: 'utf-8',
    oe: 'utf-8',
    app: 'jsapi',
  });
  return `https://inputtools.google.com/request?${params.toString()}`;
}

/**
 * Parse an Input Tools response into the candidate list.
 * Shape: ["SUCCESS",[["amma",["அம்மா","அம்மை",…],[],{…}]]]
 * Returns [] for anything that isn't a SUCCESS with candidates.
 */
export function parseInputToolsCandidates(data: unknown): string[] {
  if (!Array.isArray(data) || data[0] !== 'SUCCESS') return [];
  const groups = data[1];
  if (!Array.isArray(groups) || !Array.isArray(groups[0])) return [];
  const candidates = groups[0][1];
  if (!Array.isArray(candidates)) return [];
  return candidates.filter((c): c is string => typeof c === 'string' && c.length > 0);
}

/**
 * The latin word being typed immediately before the caret — the token we ask
 * Google to transliterate. Returns null when the char before the caret isn't a
 * latin letter (so Tamil text, spaces and punctuation don't trigger lookups).
 * Apostrophes inside a run are kept (e.g. don't-style inputs are rare but safe).
 */
export function activeLatinToken(text: string, caret: number): { token: string; start: number } | null {
  if (caret <= 0 || caret > text.length) return null;
  let start = caret;
  while (start > 0 && /[A-Za-z]/.test(text[start - 1])) start--;
  if (start === caret) return null; // char before caret isn't a latin letter
  return { token: text.slice(start, caret), start };
}

/**
 * Commit a chosen candidate: replace the active token [start, caret) with
 * `candidate`, optionally appending a trailing space (Space-to-commit). Returns
 * the new text and the caret position after the inserted word.
 */
export function commitCandidate(
  text: string,
  start: number,
  caret: number,
  candidate: string,
  trailingSpace = false
): { text: string; caret: number } {
  const suffix = trailingSpace ? candidate + ' ' : candidate;
  const next = text.slice(0, start) + suffix + text.slice(caret);
  return { text: next, caret: start + suffix.length };
}
