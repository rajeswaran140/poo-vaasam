/**
 * Schema for a complete, pasteable generation setup.
 *
 * The composer's `suno_prompts` describe a song. These are the four fields the
 * generator actually takes, in the shape they get pasted into. Kept in its own
 * module (not folded into composerSchema) because it is produced on demand for
 * ONE chosen variant: the lyric block runs to thousands of characters and
 * emitting it 3-5 times per brief would be waste, and the arrangement only
 * matters once a style has been picked.
 */

import { z } from 'zod';
import { PROMPT_LIMITS } from '@/lib/prompt-preflight';
import { EXCLUDE_MAX, SLIDER_MIN, SLIDER_MAX } from '@/lib/suno-setup';

export const sunoSetupInputSchema = z.object({
  /** The finished Tamil lyric. Section tags optional — the model adds them. */
  lyrics: z.string().trim().min(1, 'Lyrics are required').max(PROMPT_LIMITS.LYRICS_MAX_CHARS),
  /** The chosen style variant's name, e.g. "Tamil film ballad". */
  style: z.string().trim().min(1).max(120),
  /** The variant's prose description, used as the brief for the style box. */
  styleBrief: z.string().trim().max(4000).optional(),
  /** Instruments already chosen for this variant — breaks must draw from these. */
  instruments: z.array(z.string().trim().min(1)).max(12).default([]),
  ragas: z.array(z.string().trim().min(1)).max(6).default([]),
  voices: z.array(z.string().trim().min(1)).max(6).default([]),
  bpm: z.number().int().min(40).max(200).optional(),
  key: z.string().trim().max(40).optional(),
  mood: z.string().trim().max(200).optional(),
  /** Free-text steer, e.g. "keep it sparse" or "male lead only". */
  notes: z.string().trim().max(1000).optional(),
});

export type SunoSetupInput = z.infer<typeof sunoSetupInputSchema>;

export const sunoSetupOutputSchema = z.object({
  lyrics_block: z
    .string()
    .min(1)
    .max(PROMPT_LIMITS.LYRICS_MAX_CHARS)
    .describe(
      'The lyric with [Kind - Detail] section tags on their own lines, including instrumental breaks. Tamil lines unchanged.'
    ),
  style: z
    .string()
    .min(1)
    .max(PROMPT_LIMITS.STYLE_MAX)
    .describe('Comma-separated descriptors for the style box. No lyrics, no negatives.'),
  weirdness: z.number().int().min(SLIDER_MIN).max(SLIDER_MAX).describe('0-100. 50 is normal.'),
  style_influence: z
    .number()
    .int()
    .min(SLIDER_MIN)
    .max(SLIDER_MAX)
    .describe('0-100. High when the style prompt is dense and specific.'),
  exclude: z
    .array(z.string().trim().min(1))
    .max(EXCLUDE_MAX)
    .default([])
    .describe(`At most ${EXCLUDE_MAX} things to keep out, each already displaced by the style prompt.`),
  /** Why these slider values, in one line — so the choice can be argued with. */
  slider_rationale: z.string().default(''),
});

export type SunoSetupOutput = z.infer<typeof sunoSetupOutputSchema>;
