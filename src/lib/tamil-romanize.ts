/**
 * Tamil → Latin romanisation + a phonetic search key, for diaspora who SPEAK
 * Tamil but can't read the script and search in roman ("nee siricha neram").
 *
 * Two layers:
 *  1. romanizeTamil() — a phonetic transliteration of the Tamil Unicode block
 *     using the conventions Tamils actually type (long ஈ→"ee", ஊ→"oo", ச→"ch").
 *  2. phoneticKey() — a lossy canonical hash applied to BOTH a romanisation and a
 *     user's roman query, so the two meet in the same reduced space despite the
 *     real ambiguities of ad-hoc romanisation: voiced/unvoiced plosives
 *     (k/g, t/d, p/b), sibilants (s/ch/sh/j), aspiration (th→t), and
 *     vowel-length / gemination ("neeram"≈"neram"). Precision drops, recall
 *     soars — the right trade for a small, hand-curated catalogue.
 *
 * Pure functions, no I/O — fully unit-testable and reusable by search, lyric
 * romanisation, and slug/alias generation.
 */

// Independent vowels (உயிர்).
const VOWELS: Record<string, string> = {
  'அ': 'a', // அ
  'ஆ': 'aa', // ஆ
  'இ': 'i', // இ
  'ஈ': 'ee', // ஈ
  'உ': 'u', // உ
  'ஊ': 'oo', // ஊ
  'எ': 'e', // எ
  'ஏ': 'e', // ஏ
  'ஐ': 'ai', // ஐ
  'ஒ': 'o', // ஒ
  'ஓ': 'o', // ஓ
  'ஔ': 'au', // ஔ
};

// Dependent vowel signs (மாத்திரை) — replace a consonant's inherent 'a'.
const SIGNS: Record<string, string> = {
  'ா': 'aa', // ா
  'ி': 'i', // ி
  'ீ': 'ee', // ீ
  'ு': 'u', // ு
  'ூ': 'oo', // ூ
  'ெ': 'e', // ெ
  'ே': 'e', // ே
  'ை': 'ai', // ை
  'ொ': 'o', // ொ
  'ோ': 'o', // ோ
  'ௌ': 'au', // ௌ
};

// Consonants (மெய்) — base sound; the inherent 'a' is added by the algorithm.
const CONSONANTS: Record<string, string> = {
  'க': 'k', // க
  'ங': 'ng', // ங
  'ச': 'ch', // ச
  'ஜ': 'j', // ஜ
  'ஞ': 'nj', // ஞ
  'ட': 't', // ட
  'ண': 'n', // ண
  'த': 'th', // த
  'ந': 'n', // ந
  'ப': 'p', // ப
  'ம': 'm', // ம
  'ய': 'y', // ய
  'ர': 'r', // ர
  'ல': 'l', // ல
  'வ': 'v', // வ
  'ழ': 'zh', // ழ
  'ள': 'l', // ள
  'ற': 'r', // ற
  'ன': 'n', // ன
  'ஶ': 'sh', // ஶ
  'ஷ': 'sh', // ஷ
  'ஸ': 's', // ஸ
  'ஹ': 'h', // ஹ
};

const PULLI = '்'; // ் virama — strips the inherent vowel
const AYTHAM = 'ஃ'; // ஃ

/** Phonetic transliteration of Tamil text to Latin; non-Tamil passes through. */
export function romanizeTamil(text: string): string {
  const chars = Array.from(text ?? '');
  let out = '';

  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const cons = CONSONANTS[c];

    if (cons) {
      out += cons;
      const next = chars[i + 1];
      if (next === PULLI) {
        i++; // pure consonant — no vowel
      } else if (next && SIGNS[next]) {
        out += SIGNS[next];
        i++;
      } else {
        out += 'a'; // inherent vowel
      }
      continue;
    }

    if (VOWELS[c]) {
      out += VOWELS[c];
    } else if (c === AYTHAM) {
      out += 'h';
    } else if (c === PULLI) {
      // stray pulli (no preceding consonant) — ignore
    } else {
      out += c; // latin, digits, spaces, punctuation
    }
  }

  return out;
}

// Multi-letter sound classes folded first (order matters: longest first).
const DIGRAPHS: [RegExp, string][] = [
  [/zh/g, 'z'], // ழ stays distinct from l/r
  [/ch/g, 'c'],
  [/sh/g, 'c'],
  [/th/g, 't'],
  [/dh/g, 't'],
  [/ph/g, 'p'],
  [/gh/g, 'k'],
  [/kh/g, 'k'],
  [/ng/g, 'n'],
  [/nj/g, 'n'],
];

// Single-letter folds into canonical sound classes.
const FOLDS: Record<string, string> = {
  g: 'k',
  d: 't',
  b: 'p',
  j: 'c',
  s: 'c',
  w: 'v',
  q: 'k',
  x: 'k',
};

/**
 * Reduce a Latin string (a romanisation OR a user query) to a canonical phonetic
 * key. Folds plosive voicing, sibilants and aspiration, drops residual 'h',
 * strips non-letters, and collapses repeated letters (vowel length / gemination).
 */
export function phoneticKey(latin: string): string {
  let s = (latin ?? '').toLowerCase();
  for (const [re, rep] of DIGRAPHS) s = s.replace(re, rep);
  s = s.replace(/[a-z]/g, (ch) => FOLDS[ch] ?? ch);
  s = s.replace(/h/g, '');
  s = s.replace(/[^a-z]/g, '');
  s = s.replace(/(.)\1+/g, '$1'); // collapse runs of the same letter
  return s;
}

/** Convenience: the phonetic key of a (possibly Tamil) string. */
export function tamilPhoneticKey(text: string): string {
  return phoneticKey(romanizeTamil(text));
}
