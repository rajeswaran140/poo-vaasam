/**
 * Lexicon search and filtering — pure, deterministic, no I/O and no LLM.
 *
 * Three things this does that a `.includes()` over the word list does not:
 *
 * 1. **Searches every field**, weighted. A query matching the headword ranks
 *    above one matching a gloss, which ranks above one buried in a usage note.
 *    Without weighting, searching `மழை` returns the 40 entries that mention rain
 *    in passing above the word மழை itself.
 *
 * 2. **Follows relations, in both directions.** If சாரல் lists மழை among its
 *    related words, then searching மழை finds சாரல் — even though the string
 *    "மழை" appears nowhere in சாரல்'s own fields. This is what makes the lexicon
 *    a discovery engine rather than an index: the poet asks for rain and gets
 *    drizzle, cloud, wet earth.
 *
 * 3. **Matches Tamil and English against the right fields.** A Tamil query has
 *    no business being lowercased against English glosses, and an ASCII query
 *    should reach glosses, themes and romanisations.
 *
 * ⚠️ Relation expansion is only as good as the DATA. On a lexicon whose
 * relation lists are empty (as this one is until enrichment runs), search
 * degrades to weighted field matching — correct, just less generous. It does
 * not invent semantic links.
 */

import { matchKey, hasTamil } from '@/lib/tamil-normalize';

/**
 * The fields search reads. Structural rather than the full `LexiconWord` so the
 * SAME code runs on the server (over domain objects) and in the admin table
 * (over its own row type) — one search implementation, so the list the API
 * returns and the list the poet filters in the browser can never disagree.
 */
export interface SearchableWord {
  id: string;
  word: string;
  normalizedWord?: string;
  gloss?: string;
  romanization?: string;
  tamilMeaning?: string;
  register?: string;
  registers?: string[];
  usage?: string;
  themes?: string[];
  wordType?: string;
  lexicalStatus?: string;
  confidence?: string;
  moods?: string[];
  synonyms?: string[];
  relatedWords?: string[];
  antonyms?: string[];
  etukai?: string[];
  monai?: string[];
  rhymesWith?: string[];
  semanticFamily?: string[];
  poeticUsage?: string;
  examples?: string[];
  notes?: string;
  archived?: boolean;
}

export interface LexiconFilters {
  register?: string;
  usage?: string;
  theme?: string;
  wordType?: string;
  lexicalStatus?: string;
  confidence?: string;
  mood?: string;
  includeArchived?: boolean;
}

/** Field weights. Headword first, then meaning, then everything else. */
const WEIGHT = {
  word: 100,
  romanization: 60,
  tamilMeaning: 45,
  gloss: 40,
  synonyms: 30,
  relatedWords: 22,
  semanticFamily: 20,
  antonyms: 12,
  etukai: 12,
  monai: 12,
  rhymesWith: 12,
  themes: 18,
  moods: 10,
  register: 8,
  poeticUsage: 14,
  examples: 14,
  notes: 6,
  /** Found only because another entry names this word as a relation. */
  viaRelation: 25,
} as const;

/** Exact match on a field is worth more than a substring hit inside it. */
const EXACT_BONUS = 1.6;

function scoreText(text: string | undefined, needle: string, weight: number): number {
  if (!text) return 0;
  const hay = matchKey(text);
  if (!hay || !hay.includes(needle)) return 0;
  return hay === needle ? weight * EXACT_BONUS : weight;
}

function scoreList(list: readonly string[] | undefined, needle: string, weight: number): number {
  let best = 0;
  for (const item of list ?? []) {
    best = Math.max(best, scoreText(item, needle, weight));
  }
  return best;
}

/**
 * Build the reverse relation index: for each word W, which OTHER entries name W
 * in one of their relation lists. Computed once per search rather than per
 * candidate, so a 1,000-word lexicon stays linear rather than quadratic.
 */
function reverseRelationIndex(words: readonly SearchableWord[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const w of words) {
    const related = [
      ...(w.synonyms ?? []),
      ...(w.relatedWords ?? []),
      ...(w.antonyms ?? []),
      ...(w.semanticFamily ?? []),
      ...(w.etukai ?? []),
      ...(w.monai ?? []),
      ...(w.rhymesWith ?? []),
    ];
    for (const r of related) {
      const key = matchKey(r);
      if (!key) continue;
      const set = index.get(key) ?? new Set<string>();
      set.add(w.id);
      index.set(key, set);
    }
  }
  return index;
}

export interface ScoredWord<T extends SearchableWord = SearchableWord> {
  word: T;
  score: number;
  /** True when the only reason this matched is another entry pointing at it. */
  viaRelation: boolean;
}

/** Every register an entry holds, tolerating the legacy single-value shape. */
function registersOf(w: SearchableWord): string[] {
  return w.registers?.length ? w.registers : w.register ? [w.register] : [];
}

/** Does this entry pass the (non-text) filters? */
export function passesFilters(w: SearchableWord, f: LexiconFilters): boolean {
  if (!f.includeArchived && w.archived) return false;
  // Register matches against the FULL list, so a word filed as
  // [common, literary] appears under both filters rather than only the first.
  if (f.register && !registersOf(w).includes(f.register)) return false;
  if (f.usage && w.usage !== f.usage) return false;
  if (f.theme && !(w.themes ?? []).includes(f.theme)) return false;
  if (f.wordType && w.wordType !== f.wordType) return false;
  if (f.lexicalStatus && w.lexicalStatus !== f.lexicalStatus) return false;
  if (f.confidence && w.confidence !== f.confidence) return false;
  if (f.mood && !(w.moods ?? []).includes(f.mood)) return false;
  return true;
}

/**
 * Score one entry against a normalized needle. Returns 0 for no match.
 * `relationHit` is passed in from the reverse index.
 */
function scoreWord(w: SearchableWord, needle: string, relationHit: boolean): number {
  const tamilQuery = hasTamil(needle);

  let score =
    scoreText(w.word, needle, WEIGHT.word) +
    scoreText(w.tamilMeaning, needle, WEIGHT.tamilMeaning) +
    scoreList(w.synonyms, needle, WEIGHT.synonyms) +
    scoreList(w.relatedWords, needle, WEIGHT.relatedWords) +
    scoreList(w.semanticFamily, needle, WEIGHT.semanticFamily) +
    scoreList(w.antonyms, needle, WEIGHT.antonyms) +
    scoreList(w.etukai, needle, WEIGHT.etukai) +
    scoreList(w.monai, needle, WEIGHT.monai) +
    scoreList(w.rhymesWith, needle, WEIGHT.rhymesWith) +
    scoreText(w.poeticUsage, needle, WEIGHT.poeticUsage) +
    scoreList(w.examples, needle, WEIGHT.examples) +
    // Notes are free text and are frequently written in Tamil, so they are
    // searched for BOTH query kinds — unlike the fields below, which are
    // English by construction.
    scoreText(w.notes, needle, WEIGHT.notes);

  // Fields whose vocabulary is English or a fixed enum (gloss, romanisation,
  // theme/mood/register names). A Tamil query can never legitimately match
  // these, and searching them anyway would score noise.
  if (!tamilQuery) {
    score +=
      scoreText(w.gloss, needle, WEIGHT.gloss) +
      scoreText(w.romanization, needle, WEIGHT.romanization) +
      scoreList(w.themes, needle, WEIGHT.themes) +
      scoreList(w.moods, needle, WEIGHT.moods) +
      scoreList(w.registers, needle, WEIGHT.register);
  }

  if (relationHit) score += WEIGHT.viaRelation;
  return score;
}

/**
 * Search + filter the lexicon. An empty query returns everything that passes
 * the filters, in the caller's existing (alphabetical) order — searching is
 * additive, so clearing the box must not reshuffle the table.
 */
export function searchLexicon<T extends SearchableWord>(
  words: readonly T[],
  query: string,
  filters: LexiconFilters = {}
): T[] {
  const filtered = (words ?? []).filter((w) => passesFilters(w, filters));
  const needle = matchKey(query ?? '');
  if (!needle) return filtered;

  const relIndex = reverseRelationIndex(words ?? []);
  const relatedIds = relIndex.get(needle) ?? new Set<string>();

  const scored: ScoredWord<T>[] = [];
  for (const w of filtered) {
    const relationHit = relatedIds.has(w.id);
    const score = scoreWord(w, needle, relationHit);
    if (score > 0) scored.push({ word: w, score, viaRelation: relationHit && score === WEIGHT.viaRelation });
  }

  // Ties break on the headword, never on input order, so the same query always
  // renders the same table.
  scored.sort((a, b) => b.score - a.score || a.word.word.localeCompare(b.word.word, 'ta'));
  return scored.map((s) => s.word);
}

/** Counts for the header strip: total plus a breakdown per register. */
export interface LexiconCounts {
  total: number;
  archived: number;
  byRegister: Record<string, number>;
  byLexicalStatus: Record<string, number>;
  byUsage: Record<string, number>;
  /** Entries with no theme, no Tamil meaning, or an unreviewed historical claim. */
  needsReview: number;
}

export function lexiconCounts(words: readonly SearchableWord[]): LexiconCounts {
  const byRegister: Record<string, number> = {};
  const byLexicalStatus: Record<string, number> = {};
  const byUsage: Record<string, number> = {};
  let archived = 0;
  let needsReview = 0;

  for (const w of words ?? []) {
    if (w.archived) {
      archived += 1;
      continue;
    }
    // A word counts under EVERY register it holds, so the numbers describe the
    // vocabulary rather than a forced primary choice. They therefore sum to
    // more than `total` — which is the honest shape for a multi-label field.
    for (const r of registersOf(w)) {
      byRegister[r] = (byRegister[r] ?? 0) + 1;
    }
    if (w.lexicalStatus) byLexicalStatus[w.lexicalStatus] = (byLexicalStatus[w.lexicalStatus] ?? 0) + 1;
    if (w.usage) byUsage[w.usage] = (byUsage[w.usage] ?? 0) + 1;
    if (!w.themes?.length || !w.tamilMeaning || !w.confidence) needsReview += 1;
  }

  const live = (words ?? []).filter((w) => !w.archived).length;
  return { total: live, archived, byRegister, byLexicalStatus, byUsage, needsReview };
}
