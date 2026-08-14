/**
 * WORD FAMILY — open மலர் and see மலர்தல், மலர்ச்சி, மலரொளி, மலர்முகம், மலர்விழி,
 * with each one clearly marked as an established form or a creative compound.
 *
 * This is what turns the lexicon from a searchable dictionary into a
 * composition tool: a lyricist does not want "the word", he wants the shape of
 * the word he can fit into the line — the verb, the abstract noun, the compound
 * that carries the image.
 *
 * Pure and deterministic. No LLM, no I/O: the family is computed from the
 * entries already stored, so it is instant, offline, and cannot invent a
 * relative that does not exist in his own lexicon. (The AI's job is to PROPOSE
 * new members via enrichment; this one's job is to organise what is there.)
 *
 * ⚠️ MORPHOLOGY IS ADVISORY, NOT AUTHORITATIVE. Tamil derivation is far richer
 * than prefix matching, and a shared opening does not prove a shared root:
 * கார் (dark cloud) and காரம் (pungency) are unrelated. So every derived member
 * is labelled with HOW it was matched, and the `relation` field never claims
 * more than "shares a stem". A member the poet explicitly listed in a relation
 * field always outranks one found by string matching.
 */

import { CONSTRUCTED_STATUSES } from '@/types/lexicon';
import { matchKey } from '@/lib/tamil-normalize';

/**
 * The minimum an entry must expose to take part in a family. Structural rather
 * than the full `LexiconWord` so the client can pass its own row type (and the
 * tests a literal) without constructing Dates and empty arrays it never uses.
 */
export interface FamilyEntry {
  id: string;
  word: string;
  gloss?: string;
  wordType?: string;
  lexicalStatus?: string;
  registers?: string[];
  synonyms?: string[];
  relatedWords?: string[];
  semanticFamily?: string[];
}

/**
 * Productive Tamil suffixes, longest first so `த்தல்` wins over `தல்`.
 *
 * Not a complete morphology — a curated set of the endings that actually
 * generate the compound families a lyricist builds: verbal nouns (மலர்தல்),
 * abstract nouns (மலர்ச்சி), and the agentive/adjectival endings.
 */
const SUFFIXES = ['த்தல்', 'ச்சி', 'தல்', 'ப்பு', 'வு', 'மை', 'ம்', 'ல்'] as const;

/** The shortest stem we will trust. Below this, matches are coincidence. */
const MIN_STEM = 3;

/** Pulli (virama) — marks a bare consonant. */
const PULLI = '்';

/** The dependent vowel signs. A base letter carrying one of these took a vowel. */
const VOWEL_SIGN = /[ா-ௌ]/;

/**
 * Match a SANDHI compound: மலர் + ஒளி → மலரொளி.
 *
 * When a word ending in a bare consonant (pulli) is compounded with one
 * starting in a vowel, the pulli is replaced by that vowel's sign, so the
 * result does NOT literally start with the headword — `மலரொளி` does not begin
 * with `மலர்`. Plain prefix matching therefore misses exactly the compounds a
 * lyricist coins most.
 *
 * ⚠️ THE OBVIOUS FIX IS WRONG. Simply dropping the pulli and prefix-matching
 * `மலர` would also match `காரம்` from `கார்` — the false positive this file's
 * header warns about. So the character immediately after the base must be a
 * VOWEL SIGN, which is what sandhi produces: `மலர|ொளி` qualifies, `கார|ம்`
 * does not.
 */
function isSandhiCompound(headKey: string, key: string): boolean {
  if (!headKey.endsWith(PULLI)) return false;
  const base = headKey.slice(0, -1);
  if (base.length < MIN_STEM || !key.startsWith(base) || key.length <= base.length) return false;
  return VOWEL_SIGN.test(key[base.length]);
}

/**
 * Reduce a word to its probable stem by stripping ONE productive suffix.
 * `மலர்தல்` → `மலர்`, `மலர்ச்சி` → `மலர்`, `மலர்` → `மலர்` (unchanged).
 */
export function stemOf(word: string): string {
  const key = matchKey(word);
  for (const suffix of SUFFIXES) {
    if (key.length - suffix.length >= MIN_STEM && key.endsWith(suffix)) {
      return key.slice(0, -suffix.length);
    }
  }
  return key;
}

export type FamilyRelation =
  | 'listed'
  | 'derived-form'
  | 'compound'
  | 'shares-stem';

export interface FamilyMember {
  /** Present when the relative is itself an entry in the lexicon. */
  id?: string;
  word: string;
  gloss?: string;
  wordType?: string;
  lexicalStatus?: string;
  registers?: string[];
  /** How this member was connected to the head — see the file header. */
  relation: FamilyRelation;
  /** True when it is a coinage rather than an attested headword. */
  constructed: boolean;
  /** True when it is not yet in the lexicon (it came from a relation list). */
  missing: boolean;
}

export interface WordFamily {
  head: string;
  stem: string;
  members: FamilyMember[];
  /** Members the poet has recorded as coinages rather than attested words. */
  constructedCount: number;
}

const RELATION_RANK: Record<FamilyRelation, number> = {
  listed: 0,
  'derived-form': 1,
  compound: 2,
  'shares-stem': 3,
};

const isConstructed = (w: { lexicalStatus?: string }) =>
  !!w.lexicalStatus && (CONSTRUCTED_STATUSES as readonly string[]).includes(w.lexicalStatus);

function toMember(entry: FamilyEntry, relation: FamilyRelation): FamilyMember {
  return {
    id: entry.id,
    word: entry.word,
    gloss: entry.gloss,
    wordType: entry.wordType,
    lexicalStatus: entry.lexicalStatus,
    registers: entry.registers,
    relation,
    constructed: isConstructed(entry),
    missing: false,
  };
}

/**
 * Classify how `candidate` relates to `head`, or null when it does not.
 *
 * The order matters: an exact suffix derivation (மலர் → மலர்தல்) is a stronger
 * claim than a compound (மலர் → மலர்விழி), which is stronger than merely
 * sharing a stem after both were reduced.
 */
function classify(headKey: string, headStem: string, candidate: string): FamilyRelation | null {
  const key = matchKey(candidate);
  if (!key || key === headKey) return null;

  // மலர் + தல் → மலர்தல்: the head plus exactly one productive suffix.
  for (const suffix of SUFFIXES) {
    if (key === headKey + suffix) return 'derived-form';
  }

  // மலர் + விழி → மலர்விழி: the head opens a longer word.
  if (key.startsWith(headKey) && key.length > headKey.length) return 'compound';

  // மலர் + ஒளி → மலரொளி: the pulli was absorbed into a vowel sign.
  if (isSandhiCompound(headKey, key)) return 'compound';

  // Both reduce to the same stem (மலர்ச்சி and மலர்தல் via மலர்).
  if (headStem.length >= MIN_STEM && stemOf(candidate) === headStem) return 'shares-stem';

  return null;
}

/**
 * Build the family for one headword out of the lexicon.
 *
 * `head` need not be an entry itself — the panel can ask for the family of a
 * word the poet is merely considering.
 */
export function buildWordFamily(head: string, lexicon: readonly FamilyEntry[]): WordFamily {
  const headKey = matchKey(head);
  const headStem = stemOf(head);
  const members = new Map<string, FamilyMember>();

  const entry = (lexicon ?? []).find((w) => matchKey(w.word) === headKey);
  const byKey = new Map((lexicon ?? []).map((w) => [matchKey(w.word), w]));

  // 1. Relations the poet recorded himself — these outrank anything derived,
  //    including when the related word is not (yet) an entry of its own.
  if (entry) {
    const listed = [...(entry.semanticFamily ?? []), ...(entry.relatedWords ?? []), ...(entry.synonyms ?? [])];
    for (const rel of listed) {
      const key = matchKey(rel);
      if (!key || key === headKey || members.has(key)) continue;
      const stored = byKey.get(key);
      members.set(
        key,
        stored
          ? toMember(stored, 'listed')
          : { word: rel, relation: 'listed', constructed: false, missing: true }
      );
    }
  }

  // 2. Morphological relatives found among the other entries.
  for (const w of lexicon ?? []) {
    const key = matchKey(w.word);
    if (members.has(key)) continue;
    const relation = classify(headKey, headStem, w.word);
    if (relation) members.set(key, toMember(w, relation));
  }

  const ordered = [...members.values()].sort(
    (a, b) => RELATION_RANK[a.relation] - RELATION_RANK[b.relation] || a.word.localeCompare(b.word, 'ta')
  );

  return {
    head: entry?.word ?? head,
    stem: headStem,
    members: ordered,
    constructedCount: ordered.filter((m) => m.constructed).length,
  };
}
