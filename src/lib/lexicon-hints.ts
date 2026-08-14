/**
 * Format the poet's personal lexicon into compact hint lines for the Lyric
 * Critic prompt, so its wordIdeas are drawn from HIS own vocabulary rather than
 * generic AI synonyms ([[project_poo_vaasam_lexicon]] → Critic).
 *
 * Pure. Excludes archived words and worn ones ('overused' / 'avoid' — the
 * opposite of a fresh alternative). Orders fresh-first and caps the count so
 * the prompt stays bounded.
 */

import { WORN_USAGES, type LexiconWord } from '@/types/lexicon';
import { migrateUsage } from '@/lib/lexicon-migrate';

/** Fresh first. Legacy values already mapped forward on read; 2 = unknown. */
const USAGE_RANK: Record<string, number> = { fresh: 0, normal: 2, familiar: 3 };

/**
 * `word — gloss [register]` lines for the prompt; fresh words first, capped.
 *
 * A word the poet marked as a CONSTRUCTION rather than an attested headword is
 * labelled as such, so the critic recommends it as a coinage instead of citing
 * it as established Tamil — the same honesty the detail panel shows him.
 */
export function lexiconHints(words: LexiconWord[], max = 150): string[] {
  return (words ?? [])
    .filter((w) => !w.archived && !WORN_USAGES.includes(migrateUsage(w.usage)) && w.word)
    .sort((a, b) => (USAGE_RANK[migrateUsage(a.usage)] ?? 2) - (USAGE_RANK[migrateUsage(b.usage)] ?? 2))
    .slice(0, max)
    .map((w) => {
      const gloss = w.gloss && w.gloss !== '—' ? ` — ${w.gloss}` : '';
      const registers = w.registers?.length ? w.registers.join('/') : w.register;
      const coined = w.lexicalStatus === 'creative-poetic' ? ', coined' : '';
      return `${w.word}${gloss} [${registers}${coined}]`;
    });
}
