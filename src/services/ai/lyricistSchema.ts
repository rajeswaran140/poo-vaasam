/**
 * Lyricist schema — single source of truth for the AI lyric *generation* step
 * (brief → lyrics), the inverse of the Composer (lyrics → production brief).
 *
 * Two contracts live here:
 *   - `lyricBriefSchema`  — the INPUT the admin supplies (the creative brief).
 *   - `lyricsOutputSchema` — the OUTPUT shape the model must return (validated
 *     after the forced tool call, and handed to Claude as the tool input_schema
 *     via `z.toJSONSchema`, so the model tool / runtime validation / TS types
 *     can never drift apart).
 *
 * Like composerSchema.ts this module pulls in NO server-only SDKs (no
 * Anthropic/AWS), so the client ComposerForm can type-import it freely.
 */

import { z } from 'zod';

/** Word-choice register the lyric should sit in. */
export const lyricRegisterSchema = z.enum(['literary', 'village', 'sangam', 'modern', 'devotional']);
export type LyricRegister = z.infer<typeof lyricRegisterSchema>;

/** Requested song shape. Pallavi is always present; the rest is opt-in. */
export const lyricStructureSchema = z.object({
  anupallavi: z.boolean().default(false).describe('Include an anupallavi section.'),
  charanams: z.number().int().min(1).max(5).default(2).describe('Number of charanam (verse) sections, 1-5.'),
});

/** The creative brief the admin submits to generate lyrics. */
export const lyricBriefSchema = z.object({
  theme: z.string().trim().min(1, 'Theme is required').max(200).describe('Short theme phrase, Tamil or English.'),
  emotions: z
    .array(z.string().trim().min(1).max(60))
    .min(1, 'At least one emotion is required')
    .max(5)
    .describe('1-5 Tamil emotions RANKED most→least present.'),
  voice: z.string().trim().min(1).max(40).optional().describe('Intended voice, e.g. "Male Baritone", "Duet".'),
  register: lyricRegisterSchema.default('modern'),
  structure: lyricStructureSchema.default({ anupallavi: false, charanams: 2 }),
  seedWords: z
    .array(z.string().trim().min(1).max(40))
    .max(20)
    .default([])
    .describe('Optional lexicon palette — words to weave in where natural.'),
  titleHint: z.string().trim().max(120).optional().describe('Optional steer for the title.'),
  notes: z.string().trim().max(1000).optional().describe('Optional free-text guidance.'),
});
export type LyricBrief = z.infer<typeof lyricBriefSchema>;

/**
 * The generated lyric. A charanam is an array of lines, so the song is a list
 * of charanams (array of arrays). Pallavi is required; anupallavi defaults to
 * empty so an omitted section is well-formed rather than a hard failure.
 */
export const lyricsOutputSchema = z.object({
  title: z.string().min(1).describe('Evocative Tamil title drawn from the lyric (Tamil script).'),
  pallavi: z.array(z.string().min(1)).min(1).describe('Pallavi lines, Tamil script.'),
  anupallavi: z.array(z.string().min(1)).default([]).describe('Anupallavi lines; [] when none.'),
  charanams: z
    .array(z.array(z.string().min(1)).min(1))
    .min(1)
    .describe('Each charanam is an array of Tamil lines.'),
  notes: z.string().default('').describe('Optional one-line note on imagery/meter.'),
});
export type Lyrics = z.infer<typeof lyricsOutputSchema>;

/** JSON Schema for the Claude tool input, derived from the Zod schema. */
export const lyricsOutputJsonSchema = z.toJSONSchema(lyricsOutputSchema) as Record<string, unknown>;
