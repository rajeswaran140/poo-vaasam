/**
 * Lyric Lexicon types — the personal word-family dictionary that lets the
 * Composer deliberately draw from a different vocabulary per song (see
 * project_poo_vaasam_lexicon).
 *
 * Two axes (not five flat buckets):
 *  - register: a word's style/origin (sangam / literary / village / …)
 *  - usage:    its freshness signal (fresh ↔ neutral ↔ retire/overused)
 * A word carries BOTH, plus theme tags + a gloss — so the composer can ask for
 * e.g. "fresh sangam nature words". `usageCount` is 0 for now and is filled
 * from the lyric corpus in P3 (auto retire/fresh detection).
 */

import { z } from 'zod';
import { SONG_THEMES } from '@/config/song-themes';

/** Word register / origin. Extensible — add values here as the palette grows. */
export const LEXICON_REGISTERS = ['sangam', 'literary', 'village', 'modern', 'devotional'] as const;
export type LexiconRegister = (typeof LEXICON_REGISTERS)[number];

/** Freshness status. Manual for now; corpus-derived in P3. */
export const LEXICON_USAGES = ['fresh', 'neutral', 'retire'] as const;
export type LexiconUsage = (typeof LEXICON_USAGES)[number];

/** Theme tags reuse the song themes so the lexicon and catalogue speak the same vocabulary. */
export const LEXICON_THEMES = SONG_THEMES;

export interface LexiconWord {
  id: string;
  /** Tamil headword — unique (NFC-normalized) across the lexicon. */
  word: string;
  romanization?: string;
  gloss: string;
  register: LexiconRegister;
  usage: LexiconUsage;
  themes: string[];
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

const registerSchema = z.enum(LEXICON_REGISTERS);
const usageSchema = z.enum(LEXICON_USAGES);
const themesSchema = z.array(z.string().trim().min(1).max(40)).max(12);

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

/** A single word as created/accepted (also the shape the AI suggester emits). */
export const lexiconWordInputSchema = z.object({
  word: headwordSchema,
  romanization: z.string().trim().max(80).optional(),
  gloss: z.string().trim().min(1).max(400),
  register: registerSchema,
  usage: usageSchema.default('fresh'),
  themes: themesSchema.default([]),
  notes: z.string().trim().max(1000).optional(),
});
export type LexiconWordInput = z.infer<typeof lexiconWordInputSchema>;

/** Partial update — every field optional; word can be corrected too. */
export const lexiconWordUpdateSchema = z
  .object({
    word: headwordSchema,
    romanization: z.string().trim().max(80).nullable(),
    gloss: z.string().trim().min(1).max(400),
    register: registerSchema,
    usage: usageSchema,
    themes: themesSchema,
    notes: z.string().trim().max(1000).nullable(),
    archived: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type LexiconWordUpdate = z.infer<typeof lexiconWordUpdateSchema>;

/** AI-suggestion request. */
export const lexiconSuggestSchema = z.object({
  register: registerSchema,
  theme: z.enum(SONG_THEMES as unknown as [string, ...string[]]).optional(),
  count: z.number().int().min(1).max(30).default(12),
});

/** Bulk-accept a batch of suggested/curated words. */
export const lexiconBulkSchema = z.object({
  words: z.array(lexiconWordInputSchema).min(1).max(50),
});

/** Normalize a headword for uniqueness comparison (NFC so Tamil compares right). */
export function normalizeWord(word: string): string {
  return word.normalize('NFC').trim();
}
