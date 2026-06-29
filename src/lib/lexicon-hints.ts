/**
 * Format the poet's personal lexicon into compact hint lines for the Lyric
 * Critic prompt, so its wordIdeas are drawn from HIS own vocabulary rather than
 * generic AI synonyms ([[project_poo_vaasam_lexicon]] → Critic).
 *
 * Pure. Excludes archived words and 'retire'-tagged ones (those are flagged as
 * overused — the opposite of a fresh alternative). Orders fresh-first and caps
 * the count so the prompt stays bounded.
 */

import type { LexiconWord } from '@/types/lexicon';

const USAGE_RANK: Record<string, number> = { fresh: 0, neutral: 1, retire: 2 };

/** `word — gloss [register]` lines for the prompt; fresh words first, capped. */
export function lexiconHints(words: LexiconWord[], max = 150): string[] {
  return (words ?? [])
    .filter((w) => !w.archived && w.usage !== 'retire' && w.word)
    .sort((a, b) => (USAGE_RANK[a.usage] ?? 1) - (USAGE_RANK[b.usage] ?? 1))
    .slice(0, max)
    .map((w) => {
      const gloss = w.gloss && w.gloss !== '—' ? ` — ${w.gloss}` : '';
      return `${w.word}${gloss} [${w.register}]`;
    });
}
