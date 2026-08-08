/**
 * Word inspector — select a word in a draft, see what it does and what else
 * you own that could go there.
 *
 * WHY BOTH HALVES IN ONE PLACE. Asked whether he reaches for an alternative
 * because a word "doesn't sing" (meter, a vowel that won't hold) or because it
 * "isn't the right word" (meaning, register, freshness), Raj hasn't split the
 * two — and in practice a poet feels them together. Guessing one and building
 * only that would have been the wrong bet, so this answers both from data
 * already on hand:
 *
 *   SINGABILITY  from tamil-prosody — syllables, open/closed ending, gamaka.
 *                Pure, instant, no network. This is the half that predicts what
 *                SUNO's vocalist will do to the word before a credit is spent.
 *   CANDIDATES   from the Lexicon — HIS OWN vocabulary, matched on shared
 *                themes and register. Not a thesaurus and emphatically not a
 *                model: an experienced poet knows the words, so the useful move
 *                is surfacing his own atlas at the moment of choosing.
 *
 * NEVER REWRITES. It reports and it offers; insertion is always the poet's
 * click. No candidate is ever presented as "better" — only as same-register,
 * same-theme, and how it would sing differently.
 */

import { countSyllables, analyzeGamaka } from '@/lib/tamil-prosody';
import type { LexiconWord } from '@/types/lexicon';

export interface WordSingability {
  word: string;
  syllables: number;
  /** Ends in a vowel — a note can be held here. */
  endsOpen: boolean;
  /** 0-100, weighted toward an open long-vowel ending. */
  gamakaScore: number;
  /** Plain-language read; empty when there is nothing notable to say. */
  note: string;
}

/**
 * What this word does to a line, in words rather than numbers.
 *
 * The note is deliberately about CONSEQUENCE, not grade. "Ends closed" means
 * nothing to a poet mid-line; "a held note lands on a consonant and gets
 * clipped" is the thing he can act on.
 */
export function inspectSingability(word: string): WordSingability {
  const w = (word ?? '').trim();
  const syllables = countSyllables(w);
  const g = analyzeGamaka(w);
  let note = '';
  if (w && !g.endsOpen) {
    note = 'Ends closed — a held note or gamaka lands on a consonant here and gets clipped short.';
  } else if (w && g.endsOpen && g.finalVowel === 'long') {
    note = 'Ends on a long vowel — sustains well, good place for the voice to open out.';
  } else if (w && g.endsOpen) {
    note = 'Ends open — holds, though a long vowel (ஆ, ஈ, ஊ, ஏ, ஓ) would carry further.';
  }
  return { word: w, syllables, endsOpen: g.endsOpen, gamakaScore: g.gamakaScore, note };
}

export interface WordCandidate {
  word: string;
  romanization?: string;
  gloss: string;
  register: string;
  themes: string[];
  syllables: number;
  endsOpen: boolean;
  /** Same syllable count as the selected word — swaps without touching meter. */
  keepsMeter: boolean;
  /** Why it surfaced: the themes/register it shares. */
  because: string;
}

export interface InspectOptions {
  /** Theme of the draft, when known — narrows candidates hard. */
  theme?: string;
  /** Register the draft is written in. */
  register?: string;
  limit?: number;
}

export const DEFAULT_CANDIDATE_LIMIT = 8;

/**
 * Candidates from the poet's own Lexicon.
 *
 * Ranking, most important first:
 *  1. keepsMeter — a same-syllable swap does not disturb the line, so it is the
 *     only kind that can be tried without re-reading the whole verse.
 *  2. theme overlap, then register match.
 *  3. `usage: 'fresh'` ahead of neutral — the lexicon marks words he wants to
 *     use more; `retire` and archived are excluded outright, because the whole
 *     point of marking a word retired is not to be offered it again.
 *
 * The selected word itself is never returned.
 */
export function lexiconCandidates(
  selected: string,
  lexicon: LexiconWord[],
  options: InspectOptions = {}
): WordCandidate[] {
  const sel = (selected ?? '').trim();
  if (!sel) return [];
  const selSyllables = countSyllables(sel);
  const { theme, register, limit = DEFAULT_CANDIDATE_LIMIT } = options;
  const selNorm = sel.normalize('NFC');

  const scored = lexicon
    .filter((w) => !w.archived && w.usage !== 'retire')
    .filter((w) => w.word.normalize('NFC') !== selNorm)
    .map((w) => {
      const syllables = countSyllables(w.word);
      const keepsMeter = syllables === selSyllables;
      const themeHit = theme ? w.themes.includes(theme) : false;
      const registerHit = register ? w.register === register : false;
      const score =
        (keepsMeter ? 8 : 0) +
        (themeHit ? 4 : 0) +
        (registerHit ? 2 : 0) +
        (w.usage === 'fresh' ? 1 : 0);
      const reasons: string[] = [];
      if (keepsMeter) reasons.push(`${syllables} syllables, same as ${sel}`);
      if (themeHit) reasons.push(`${theme} theme`);
      if (registerHit) reasons.push(`${register} register`);
      if (w.usage === 'fresh') reasons.push('marked fresh');
      return {
        score,
        candidate: {
          word: w.word,
          romanization: w.romanization,
          gloss: w.gloss,
          register: w.register,
          themes: w.themes,
          syllables,
          endsOpen: analyzeGamaka(w.word).endsOpen,
          keepsMeter,
          because: reasons.join(' · ') || 'from your lexicon',
        } as WordCandidate,
      };
    })
    // A candidate sharing nothing at all is noise — it is just a word he owns.
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.candidate.word.localeCompare(b.candidate.word));

  return scored.slice(0, limit).map((x) => x.candidate);
}

/**
 * Pull the word under a cursor/selection out of a draft.
 *
 * Splits on whitespace and the punctuation that surrounds Tamil words rather
 * than on a character class — Tamil combines base letters with vowel signs and
 * a naive \w boundary cuts a word in half mid-grapheme.
 */
export function wordAt(text: string, caret: number): string {
  if (!text) return '';
  const i = Math.max(0, Math.min(caret, text.length));
  const isBoundary = (ch: string) => /[\s.,!?;:"'()\[\]{}—–…]/.test(ch);
  let start = i;
  while (start > 0 && !isBoundary(text[start - 1])) start--;
  let end = i;
  while (end < text.length && !isBoundary(text[end])) end++;
  return text.slice(start, end).trim();
}
