/**
 * The lexicon's controlled vocabularies — registers, usage, word types, lexical
 * status, confidence, moods, themes.
 *
 * A LEAF module: it imports nothing but the song themes, so both the Zod
 * schemas (`@/types/lexicon`) and the legacy mappers (`@/lib/lexicon-migrate`)
 * can depend on it without a cycle.
 *
 * The axes are deliberately separate, because conflating them is what produced
 * a table with 1,046 "sangam" words in it:
 *
 *   register       — where the word SITS stylistically (a claim about Tamil)
 *   lexicalStatus  — whether it is an ESTABLISHED word or a coined compound
 *   confidence     — how sure we are of the two above (an editorial claim)
 *   usage          — how worn it is for SONGWRITING (nothing to do with history)
 *
 * "நினைவலை is a beautiful modern-poetic coinage, freshly usable, and I am not
 * claiming it is in any dictionary" is four independent facts, not one label.
 */

import { SONG_THEMES } from '@/config/song-themes';

/**
 * Word register / stylistic origin. A word may hold more than one.
 *
 * ⚠️ `sangam` IS A HISTORICAL CLAIM, not a synonym for "sounds classical".
 * Reserve it for words and technical concepts demonstrably associated with
 * Sangam-era literature (அகத்திணை, உரிப்பொருள், திணை). A beautiful compound is
 * not Sangam because it is beautiful. When unsure, `classical` or `literary`
 * says what is actually known.
 *
 * Ordered oldest → most contemporary for display; **the default is not
 * positional** (see DEFAULT_REGISTER) precisely so that adding a value here can
 * never again silently become the default for every new word.
 */
export const LEXICON_REGISTERS = [
  'sangam',
  'classical',
  'literary',
  'modern-poetic',
  'common',
  'colloquial',
  'regional',
  'archaic',
] as const;
export type LexiconRegister = (typeof LEXICON_REGISTERS)[number];

/**
 * The register a form starts on. `literary` — the mildest available claim:
 * "appropriate to poetry or elevated writing", true of essentially everything
 * in a lyricist's palette, and asserting nothing about history or novelty.
 *
 * ⚠️ NEVER make this `sangam`, and never derive it from `LEXICON_REGISTERS[0]`.
 * That exact pattern (`useState(LEXICON_REGISTERS[0])`, repeated in the Add,
 * Paste-import and AI-suggest panels) is what mislabelled the whole table.
 */
export const DEFAULT_REGISTER: LexiconRegister = 'literary';

/** Human-readable register meanings — shown in the UI so the choice is informed. */
export const REGISTER_DESCRIPTIONS: Record<LexiconRegister, string> = {
  sangam: 'Demonstrably associated with Sangam-era Tamil literature.',
  classical: 'Established older/literary Tamil with historical usage, not specifically Sangam.',
  literary: 'Appropriate to formal literature, poetry, or elevated writing.',
  'modern-poetic': 'Modern poetic formation or compound, for contemporary poems and lyrics.',
  common: 'Standard contemporary Tamil, broadly understood and used.',
  colloquial: 'Conversational or spoken Tamil.',
  regional: 'Region-specific usage.',
  archaic: 'Historically attested but uncommon today.',
};

/** Registers that assert something about history — these need real evidence. */
export const HISTORICAL_REGISTERS: readonly LexiconRegister[] = ['sangam', 'classical', 'archaic'];

/**
 * Songwriting freshness — how worn the word is IN LYRICS. This is an editorial
 * judgement about usefulness, explicitly NOT a statement about register: an
 * archaic word can be `fresh` (nobody is using it) and a common one `overused`.
 */
export const LEXICON_USAGES = ['fresh', 'normal', 'familiar', 'overused', 'avoid'] as const;
export type LexiconUsage = (typeof LEXICON_USAGES)[number];

export const USAGE_DESCRIPTIONS: Record<LexiconUsage, string> = {
  fresh: 'Rarely used in songs — carries surprise.',
  normal: 'Ordinary currency; neither tired nor striking.',
  familiar: 'Common in lyrics; safe but unremarkable.',
  overused: 'Worn thin by film lyrics — needs a reason.',
  avoid: 'Do not use (cliché, or wrong for this voice).',
};

/** Usage values that disqualify a word from being OFFERED as a fresh choice. */
export const WORN_USAGES: readonly LexiconUsage[] = ['overused', 'avoid'];

/** Grammatical / lexical type. */
export const LEXICON_WORD_TYPES = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'interjection',
  'compound',
  'poetic-compound',
  'literary-term',
  'proper-term',
  'other',
] as const;
export type LexiconWordType = (typeof LEXICON_WORD_TYPES)[number];

/**
 * Whether the entry is an established word or a creative construction.
 *
 * ⚠️ THE POINT OF THIS FIELD: never present a newly coined compound as though
 * it were an independently attested dictionary word. `creative-poetic` is not a
 * demotion — நினைவலை is a fine word to sing — it is an honest label saying the
 * authority behind it is the poet, not the lexicon.
 */
export const LEXICAL_STATUSES = [
  'established',
  'established-literary',
  'historical',
  'modern-compound',
  'creative-poetic',
  'uncertain',
] as const;
export type LexicalStatus = (typeof LEXICAL_STATUSES)[number];

export const LEXICAL_STATUS_DESCRIPTIONS: Record<LexicalStatus, string> = {
  established: 'An ordinary attested word of Tamil.',
  'established-literary': 'Attested, belonging to the literary tradition.',
  historical: 'Attested in older texts; read as historical today.',
  'modern-compound': 'A modern formation now in general circulation.',
  'creative-poetic': 'A poetic construction rather than an attested headword.',
  uncertain: 'Not yet checked.',
};

/** Statuses that mean "this is a construction, not an attested headword". */
export const CONSTRUCTED_STATUSES: readonly LexicalStatus[] = ['creative-poetic', 'modern-compound'];

/**
 * Editorial confidence in the classification above.
 *
 * ⚠️ `verified` requires reliable lexical or literary evidence — a dictionary,
 * a text, a citation in `notes`. It is not a synonym for "I am fairly sure".
 * Coined compounds get `experimental`.
 */
export const LEXICON_CONFIDENCE = ['verified', 'high', 'medium', 'experimental'] as const;
export type LexiconConfidence = (typeof LEXICON_CONFIDENCE)[number];

/** Emotional colour, for AI suggestion and for browsing by feel. */
export const LEXICON_MOODS = [
  'romantic',
  'joyful',
  'melancholic',
  'nostalgic',
  'hopeful',
  'devotional',
  'philosophical',
  'playful',
  'tender',
  'intense',
] as const;
export type LexiconMood = (typeof LEXICON_MOODS)[number];

/**
 * Theme tags. A superset that BEGINS with the seven `SONG_THEMES` so the
 * lexicon and the song catalogue keep speaking the same vocabulary (existing
 * rows and the /songs filter chips are unaffected), then adds the finer
 * imagery/emotion vocabulary a lyricist actually reaches for.
 *
 * Free-form on the wire (the schema validates shape, not membership) so a theme
 * added here never invalidates a row already stored with an older tag.
 */
const EXTRA_THEMES = [
  'romance',
  'longing',
  'separation',
  'joy',
  'sorrow',
  'rain',
  'sky',
  'moon',
  'sun',
  'dawn',
  'dusk',
  'night',
  'flowers',
  'birds',
  'river',
  'sea',
  'landscape',
  'village',
  'memory',
  'family',
  'childhood',
  'friendship',
  'life',
  'death',
  'hope',
  'philosophy',
  'language',
  'poetry',
  'music',
  'beauty',
  'emotion',
  'virtue',
  'spirituality',
] as const;

export const LEXICON_THEMES: readonly string[] = [...SONG_THEMES, ...EXTRA_THEMES];

/** Themes grouped for a compact picker — the flat list of 39 is unusable as chips. */
export const THEME_GROUPS: ReadonlyArray<{ label: string; themes: readonly string[] }> = [
  { label: 'Love', themes: ['love', 'romance', 'longing', 'separation'] },
  { label: 'Feeling', themes: ['joy', 'sorrow', 'hope', 'emotion', 'beauty', 'virtue'] },
  { label: 'Nature', themes: ['nature', 'rain', 'sky', 'moon', 'sun', 'dawn', 'dusk', 'night', 'flowers', 'birds', 'river', 'sea', 'landscape'] },
  { label: 'People', themes: ['mother', 'father', 'family', 'childhood', 'friendship'] },
  { label: 'Place', themes: ['homeland', 'village', 'tamil'] },
  { label: 'Thought', themes: ['memory', 'life', 'death', 'philosophy', 'spirituality', 'motivation'] },
  { label: 'Craft', themes: ['language', 'poetry', 'music'] },
];
