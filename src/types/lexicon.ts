/**
 * Lyric Lexicon types — the Tamil literary and songwriting vocabulary system
 * behind /admin/lexicon (see project_poo_vaasam_lexicon).
 *
 * FOUR INDEPENDENT AXES, not one label (the vocabularies and the reasoning live
 * in `@/types/lexicon-vocabulary`):
 *   register(s)    — where the word sits stylistically; a word may hold several
 *   wordType       — its grammatical/lexical kind
 *   lexicalStatus  — established word vs. coined poetic compound
 *   usage          — songwriting freshness (nothing to do with history)
 * plus `confidence`, which says how much weight to put on the first three.
 *
 * Everything added after the original four fields is OPTIONAL, and every reader
 * tolerates its absence: the table holds 1,047 rows written under the old
 * shape, and none of them are being rewritten to make the new UI work.
 */

import { z } from 'zod';
import {
  LEXICON_REGISTERS,
  LEXICON_USAGES,
  LEXICON_WORD_TYPES,
  LEXICAL_STATUSES,
  LEXICON_CONFIDENCE,
  LEXICON_MOODS,
} from '@/types/lexicon-vocabulary';
import type {
  LexiconRegister,
  LexiconUsage,
  LexiconWordType,
  LexicalStatus,
  LexiconConfidence,
  LexiconMood,
} from '@/types/lexicon-vocabulary';
import {
  migrateRegister,
  migrateUsage,
  resolveRegisters,
  LEGACY_REGISTER_VALUES,
  LEGACY_USAGE_VALUES,
} from '@/lib/lexicon-migrate';
import { matchKey } from '@/lib/tamil-normalize';

// Re-exported so every existing `from '@/types/lexicon'` import keeps working.
export * from '@/types/lexicon-vocabulary';

export interface LexiconWord {
  id: string;
  /** Tamil headword, exactly as the poet typed it — never normalized in place. */
  word: string;
  /** Derived match key (NFC, no zero-width chars, folded) for dedupe + search. */
  normalizedWord: string;
  romanization?: string;
  /** English gloss. */
  gloss: string;
  /** Tamil-language meaning — the definition a Tamil reader would want. */
  tamilMeaning?: string;

  /**
   * Primary register. Kept as a scalar because the palette, the critic hints
   * and the CSV export all read it; it is always `registers[0]`.
   */
  register: LexiconRegister;
  /** Full register list — a word may legitimately be e.g. common AND literary. */
  registers: LexiconRegister[];

  wordType?: LexiconWordType;
  lexicalStatus?: LexicalStatus;
  /** Absent = never reviewed. Do not default this to a value; absence is data. */
  confidence?: LexiconConfidence;

  usage: LexiconUsage;
  themes: string[];
  moods: LexiconMood[];

  /** Meaning-side relations. */
  synonyms: string[];
  relatedWords: string[];
  antonyms: string[];

  /** Sound-side relations — the songwriting half. */
  etukai: string[];
  monai: string[];
  rhymesWith: string[];
  semanticFamily: string[];

  /** How the word behaves in a line, in Tamil or English. */
  poeticUsage?: string;
  /** Short ORIGINAL phrases showing natural use. Never quoted from songs. */
  examples: string[];

  /** Times the word appears across the catalogue. 0 until the P3 corpus pass. */
  usageCount: number;
  notes?: string;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Validation — shared by the API routes and the AI-suggestion parser.
// ---------------------------------------------------------------------------

/**
 * Registers and usages accept LEGACY values and map them forward, so an old
 * client, an old test, or a replayed request never 400s on vocabulary that used
 * to be valid. `village` → `regional`, `retire` → `overused`, and so on.
 */
const registerSchema = z
  .enum([...LEXICON_REGISTERS, ...LEGACY_REGISTER_VALUES])
  .transform((v) => migrateRegister(v));
const usageSchema = z.enum([...LEXICON_USAGES, ...LEGACY_USAGE_VALUES]).transform((v) => migrateUsage(v));

const wordTypeSchema = z.enum(LEXICON_WORD_TYPES);
const lexicalStatusSchema = z.enum(LEXICAL_STATUSES);
const confidenceSchema = z.enum(LEXICON_CONFIDENCE);

/** Themes stay free-form strings: adding a tag must never invalidate a stored row. */
const themesSchema = z.array(z.string().trim().min(1).max(40)).max(16);
const moodsSchema = z.array(z.enum(LEXICON_MOODS)).max(6);

/**
 * A headword is ONE word. Reject list separators.
 *
 * ⚠️ THIS SHIPPED WITHOUT THE GUARD AND A REAL ENTRY GOT IN (2026-08-14):
 * `பொற்கதிர், இளங்கதிர், செங்கதிர்,கதிரொளி,பொற்சுடர்` with gloss "Sun" — five
 * genuine synonyms crammed into one field, which `z.string().max(60)` happily
 * accepted. The damage is not cosmetic:
 *   - `lexiconHints` emits `word — gloss [register]`, so the Lyric Critic saw
 *     the whole comma list as ONE vocabulary item — exactly the input most
 *     likely to trigger the overfitting the critic prompt already warns about.
 *   - `normalizeWord` dedupes on the whole string, so adding `பொற்கதிர்` alone
 *     later would NOT be caught as a duplicate.
 *   - GSI1SK is the word, so the index sorts on the blob.
 *
 * The capability he wanted already exists — `/api/admin/lexicon/bulk` takes up
 * to 50 words in one call — so the message points there rather than just
 * refusing.
 */
export const WORD_SEPARATORS = /[,;/|、，]/;

export function headwordIssue(word: string): string | null {
  if (WORD_SEPARATORS.test(word)) {
    return 'A headword must be a single word. To add several at once, use the bulk endpoint (one entry per word) so each stays searchable and de-duplicated.';
  }
  return null;
}

const headwordSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .refine((w) => !WORD_SEPARATORS.test(w), {
    message:
      'A headword must be a single word. To add several at once, use the bulk endpoint (one entry per word) so each stays searchable and de-duplicated.',
  });

/**
 * A relation list (synonyms, etukai, …). Each entry is a headword-shaped
 * string; the same single-word rule as the headword applies, since a relation
 * that is secretly a comma list is the same blob bug one level down.
 */
const relationsSchema = z
  .array(z.string().trim().min(1).max(60).refine((w) => !WORD_SEPARATORS.test(w)))
  .max(24);

/** Original example phrases — a line, not a verse. */
const examplesSchema = z.array(z.string().trim().min(1).max(120)).max(8);

/**
 * How many entries one bulk edit may touch.
 *
 * 200 is a page-and-a-bit of the table at 50 rows per page, which is as much as
 * anyone reviews before clicking apply. It also bounds the write burst against
 * a single DynamoDB partition — the point of a cap is that an unbounded write
 * request is worth bounding, not that 200 is magic.
 */
export const BULK_UPDATE_MAX_IDS = 200;

/**
 * Classification + relation fields, identical in create and update. The free
 * TEXT fields are deliberately NOT here: create takes them as `optional()`,
 * update as `nullable()` so an edit can clear one, and merging those two shapes
 * with a destructure was less readable than writing them twice.
 */
const classificationShape = {
  register: registerSchema.optional(),
  registers: z.array(registerSchema).min(1).max(3).optional(),
  wordType: wordTypeSchema.optional(),
  lexicalStatus: lexicalStatusSchema.optional(),
  confidence: confidenceSchema.optional(),
  usage: usageSchema.optional(),
  themes: themesSchema.optional(),
  moods: moodsSchema.optional(),
  synonyms: relationsSchema.optional(),
  relatedWords: relationsSchema.optional(),
  antonyms: relationsSchema.optional(),
  etukai: relationsSchema.optional(),
  monai: relationsSchema.optional(),
  rhymesWith: relationsSchema.optional(),
  semanticFamily: relationsSchema.optional(),
  examples: examplesSchema.optional(),
};

/**
 * A single word as created/accepted (also the shape the AI suggester emits).
 * The transform collapses `register` / `registers` into both forms, so callers
 * may send either and consumers always get both.
 */
export const lexiconWordInputSchema = z
  .object({
    word: headwordSchema,
    gloss: z.string().trim().min(1).max(400),
    romanization: z.string().trim().max(80).optional(),
    tamilMeaning: z.string().trim().max(400).optional(),
    poeticUsage: z.string().trim().max(600).optional(),
    notes: z.string().trim().max(1000).optional(),
    ...classificationShape,
  })
  .transform((v) => {
    const registers = resolveRegisters(v.registers, v.register);
    return { ...v, registers, register: registers[0], usage: v.usage ?? 'fresh', themes: v.themes ?? [] };
  });
export type LexiconWordInput = z.infer<typeof lexiconWordInputSchema>;

/**
 * The shape a CLIENT sends (pre-transform): `registers` may be absent and a
 * single `register` is enough. Producers that build words to POST — the paste
 * parser, the AI suggester — use this; only code reading a PARSED word uses
 * `LexiconWordInput`, which always has both forms filled in.
 */
export type LexiconWordDraft = z.input<typeof lexiconWordInputSchema>;

/**
 * Partial update — every field optional; the word itself can be corrected too.
 * Text fields are `nullable()` so an edit can CLEAR one (send `null`), which
 * `undefined` cannot express in a partial patch.
 */
export const lexiconWordUpdateSchema = z
  .object({
    word: headwordSchema,
    gloss: z.string().trim().min(1).max(400),
    romanization: z.string().trim().max(80).nullable(),
    tamilMeaning: z.string().trim().max(400).nullable(),
    poeticUsage: z.string().trim().max(600).nullable(),
    notes: z.string().trim().max(1000).nullable(),
    archived: z.boolean(),
    ...classificationShape,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })
  .transform((v) => {
    if (!v.registers && !v.register) return v;
    const registers = resolveRegisters(v.registers, v.register);
    return { ...v, registers, register: registers[0] };
  });
export type LexiconWordUpdate = z.infer<typeof lexiconWordUpdateSchema>;

/** AI-suggestion request. */
export const lexiconSuggestSchema = z.object({
  register: registerSchema.optional(),
  theme: z.string().trim().max(40).optional(),
  wordType: wordTypeSchema.optional(),
  usage: usageSchema.optional(),
  mood: z.enum(LEXICON_MOODS).optional(),
  /** Anchor the suggestions to a word's semantic field rather than its letters. */
  relatedTo: z.string().trim().max(60).optional(),
  count: z.number().int().min(1).max(30).default(12),
});
export type LexiconSuggestRequest = z.infer<typeof lexiconSuggestSchema>;

/** Bulk-accept a batch of suggested/curated words. */
export const lexiconBulkSchema = z.object({
  words: z.array(lexiconWordInputSchema).min(1).max(50),
});

/**
 * Apply ONE change to MANY entries — the tool for correcting groups of words.
 *
 * ⚠️ THEMES ADD, THEY DO NOT REPLACE. `themes` on the single-entry update is a
 * wholesale set, which is right when a human is looking at one word and its
 * chips. Applied across 200 selected rows it would silently erase whatever
 * themes each of them already had. So bulk work gets `addThemes`/`removeThemes`
 * and no way to express "replace the theme list on all of these".
 *
 * Everything else here is a genuine set-to-one-value: a register or confidence
 * applied to a selection is exactly the intent.
 */
export const lexiconBulkUpdateSchema = z
  .object({
    ids: z.array(z.string().trim().min(1).max(80)).min(1).max(BULK_UPDATE_MAX_IDS),
    registers: z.array(registerSchema).min(1).max(3).optional(),
    usage: usageSchema.optional(),
    wordType: wordTypeSchema.optional(),
    lexicalStatus: lexicalStatusSchema.optional(),
    confidence: confidenceSchema.optional(),
    archived: z.boolean().optional(),
    addThemes: themesSchema.optional(),
    removeThemes: themesSchema.optional(),
  })
  .refine(
    (v) =>
      v.registers !== undefined ||
      v.usage !== undefined ||
      v.wordType !== undefined ||
      v.lexicalStatus !== undefined ||
      v.confidence !== undefined ||
      v.archived !== undefined ||
      v.addThemes?.length ||
      v.removeThemes?.length,
    { message: 'Nothing to apply' }
  );
export type LexiconBulkUpdateInput = z.infer<typeof lexiconBulkUpdateSchema>;

/**
 * Normalize a headword for STORAGE (the DynamoDB `GSI1SK = <word>#<id>` key).
 *
 * ⚠️ FROZEN — do not widen. Every one of the 1,047 existing rows has its sort
 * key built from exactly this function; changing it would make legacy rows
 * unfindable by `findByWord`. The richer key used for duplicate detection and
 * search is `matchKey` in `@/lib/tamil-normalize`, stored separately.
 */
export function normalizeWord(word: string): string {
  return word.normalize('NFC').trim();
}

/** The dedupe/search key for a headword. */
export { matchKey };
