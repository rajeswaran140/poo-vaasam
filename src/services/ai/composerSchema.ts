/**
 * Composer brief schema — the single source of truth for the shape of a
 * production brief, shared by:
 *   - the composer service (tool-use input_schema + post-validation), and
 *   - POST /api/admin/briefs (validates the durable record on write).
 *
 * This module intentionally pulls in NO server-only SDKs (no Anthropic/AWS), so
 * it can be imported anywhere — including a type-only import from the client
 * ComposerForm — without dragging heavy deps into a bundle.
 *
 * The Zod schema is the contract; we derive both the TypeScript types
 * (`z.infer`) and the JSON Schema handed to Claude (`z.toJSONSchema`) from it,
 * so the model's tool, the runtime validation, and the compile-time types can
 * never drift apart.
 */

import { z } from 'zod';

/** One style-tagged SUNO prompt variant (e.g. style "Devotional"). */
export const sunoVariantSchema = z.object({
  style: z.string().min(1).describe('Short style name, e.g. "Devotional", "Tamil film ballad".'),
  prompt: z
    .string()
    .min(1)
    .describe('One self-contained English paragraph for SUNO (style/instrumentation/tempo/mood). MUST NOT contain the lyrics.'),
});

/** A short-form (Reel/Short) idea drawn from the lyrics. */
export const reelSchema = z
  .object({
    hook: z.string().default('').describe('One punchy Tamil line to open a Short.'),
    caption: z.string().default('').describe('Short English caption.'),
    hashtags: z.array(z.string()).default([]).describe('3-6 punchy hashtags.'),
  })
  // Reel is the most optional section — if the model omits it entirely, fall
  // back to an empty (but well-formed) idea rather than failing the brief.
  .default({ hook: '', caption: '', hashtags: [] });

export const composerAnalysisSchema = z.object({
  emotion: z.string().min(1).describe('One-word Tamil emotion that DOMINATES, e.g. காதல், அன்னை, துயரம், மகிழ்ச்சி.'),
  emotion_breakdown: z
    .array(z.string().min(1))
    .min(1)
    .describe('3-5 Tamil emotions RANKED most→least present. Ranking only — NO numbers, percentages, or scores.'),
  mood: z.string().min(1).describe('2-4 English adjectives, e.g. "Melancholic and reflective".'),
  theme: z.string().min(1).describe('Short English theme phrase, e.g. "Homeland nostalgia".'),
  suggested_key: z.string().min(1).describe('Western key, e.g. "D Minor", "A Major".'),
  // Non-semantic numeric field: clamp/default rather than reject a whole brief
  // over a single out-of-range tempo digit.
  suggested_bpm: z
    .number()
    .int()
    .min(40)
    .max(200)
    .catch(90)
    .describe('Integer 40-200. Ballad 60-80, mid 90-120, upbeat 130-160.'),
  suggested_instruments: z
    .array(z.string().min(1))
    .min(1)
    .describe('4-6 instruments, lead first, chosen ONLY from the provided Indian & Sri Lankan instrument palette (use the exact names).'),
  suggested_ragas: z
    .array(z.string().min(1))
    .min(1)
    .describe('2-4 ragas RANKED best-fit first, chosen ONLY from the provided raga palette by matching each raga\'s rasa to the song\'s emotion.'),
  recommended_voice: z
    .array(z.string().min(1))
    .min(1)
    .describe('2-4 ranked voices, best fit first. From: Male Baritone, Male Tenor, Female Adult, Young Female, Elder Male, Child, Duet.'),
  song_titles: z.array(z.string().min(1)).min(1).describe('Evocative Tamil titles drawn from or inspired by the lyrics.'),
  suno_prompts: z.array(sunoVariantSchema).min(1).describe('3-5 DISTINCT style variants.'),
  thumbnail_prompt: z
    .string()
    .min(1)
    .describe('One English image-generation prompt for a 16:9 YouTube thumbnail. No embedded text.'),
  youtube_description_tamil: z.string().min(1).describe('3-5 sentence Tamil description; 5-8 hashtags at the end including #tamilagaval.'),
  youtube_description_english: z.string().min(1).describe('Same meaning in English; 5-8 hashtags at the end including #tamilagaval.'),
  reel: reelSchema,
});

export type SunoVariant = z.infer<typeof sunoVariantSchema>;
export type ReelIdea = z.infer<typeof reelSchema>;
export type ComposerAnalysis = z.infer<typeof composerAnalysisSchema>;

/**
 * JSON Schema for the Claude tool's `input_schema`, derived from the Zod
 * schema so the two never diverge. Computed once at module load.
 */
export const composerAnalysisJsonSchema = z.toJSONSchema(composerAnalysisSchema) as Record<string, unknown>;
