/**
 * Lyric Critic schema — single source of truth for the AI lyric *critique* step
 * (the poet's own draft → structured feedback). The AUGMENT-the-craft counterpart
 * to the Lyricist (which generates) and the Composer (which produces): this one
 * neither writes nor rewrites — it helps an experienced Tamil poet see their own
 * work more clearly. See [[feedback_tamilagaval_ai_augments_craft]].
 *
 * Two contracts:
 *   - `lyricCritiqueInputSchema`  — the poet's draft (+ optional focus / notes).
 *   - `lyricCritiqueOutputSchema` — the structured feedback the model must return,
 *     validated after the forced tool call and handed to Claude as the tool
 *     input_schema via `z.toJSONSchema`, so model tool / runtime validation / TS
 *     types can never drift apart.
 *
 * Like composerSchema.ts / lyricistSchema.ts this pulls in NO server-only SDKs,
 * so the client form can type-import it freely.
 */

import { z } from 'zod';

/** The craft dimensions the critique reasons about. */
export const critiqueAspectSchema = z.enum([
  'meter',
  'imagery',
  'vocabulary',
  'emotion',
  'originality',
  'structure',
]);
export type CritiqueAspect = z.infer<typeof critiqueAspectSchema>;

/**
 * Is this actually wrong, or does the critic simply not yet understand why the
 * poet chose it?
 *
 * The single most important field in this schema. Without it the critic flags
 * intentional ambiguity, colloquial Tamil and uncommon imagery with the same
 * weight as a genuine error — which is how a tool starts eroding the
 * originality it was built to protect. An experienced poet bends grammar on
 * purpose; `artistic_choice` is how the critic says "I see this, I think it is
 * deliberate" instead of "this is weak".
 */
export const issueTypeSchema = z.enum(['likely_error', 'possible_issue', 'artistic_choice']);
export type IssueType = z.infer<typeof issueTypeSchema>;

/**
 * How sure the critic is, 0..1.
 *
 * ⚠️ NOT for meter. Syllable counts, rhyme families and register are MEASURED
 * and handed to the model as facts (see lyric-profile.ts) — attaching a
 * confidence to arithmetic would be theatre. Confidence belongs on the
 * genuinely uncertain calls: intent, freshness of an image, whether a word's
 * second reading was meant.
 */
export const confidenceSchema = z
  .number()
  .min(0)
  .max(1)
  .describe('0..1. Reserve high confidence for things you can point at in the text.');

/** What the poet submits: their own draft, optionally steered. */
export const lyricCritiqueInputSchema = z.object({
  lyrics: z
    .string()
    .trim()
    .min(1, 'Paste a lyric to critique')
    .max(8000)
    .describe("The poet's own draft lyric, Tamil script."),
  focus: z
    .array(critiqueAspectSchema)
    .max(6)
    .default([])
    .describe('Optional aspects to weight the critique toward.'),
  notes: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .describe('Optional context — what the poet wants feedback on.'),
});
export type LyricCritiqueInput = z.infer<typeof lyricCritiqueInputSchema>;

/**
 * The structured feedback. Every list defaults to [] so a section the model has
 * nothing real to say about is well-formed (empty), not a hard failure — only
 * `overall` is required. Critically this carries NO rewritten lyric: slackLines
 * quote the poet's own line + a reason, never a replacement.
 */
export const lyricCritiqueOutputSchema = z.object({
  overall: z.string().min(1).describe('An honest 1-3 sentence read of the draft as a whole.'),
  strengths: z.array(z.string().min(1)).default([]).describe('What is already working well.'),
  observations: z
    .array(
      z.object({
        aspect: critiqueAspectSchema,
        note: z.string().min(1),
      })
    )
    .default([])
    .describe('Per-aspect feedback (meter, imagery, vocabulary, emotion, originality, structure).'),
  slackLines: z
    .array(
      z.object({
        line: z.string().min(1).describe('The actual line from the draft, quoted verbatim.'),
        issue: z.string().min(1).describe('Why this line goes slack — diagnosis only, NEVER a rewrite.'),
        issueType: issueTypeSchema.describe(
          'likely_error = a real fault. possible_issue = might read awkwardly. artistic_choice = looks deliberate; you are noting it, not faulting it.'
        ),
        confidence: confidenceSchema,
        questionForWriter: z
          .string()
          .min(1)
          .optional()
          .describe(
            'For an AMBIGUOUS line, ask what was intended INSTEAD of downgrading it — e.g. "Did you mean மெய் as body or as truth?"'
          ),
      })
    )
    .default([])
    .describe('Specific lines worth a second look, with the reason — never a replacement line.'),
  wordIdeas: z
    .array(
      z.object({
        instead_of: z.string().min(1).describe('A word/phrase in the draft worth reconsidering.'),
        consider: z
          .array(z.string().min(1))
          .min(1)
          .describe('Alternative Tamil words to CONSIDER (the poet chooses).'),
        why: z.string().min(1),
        tradeoff: z
          .string()
          .min(1)
          .describe(
            'REQUIRED. What the alternative GAINS and what it LOSES. A swap offered without its cost is how a critic quietly sands originality off a line — if you cannot name the loss, do not offer the word.'
          ),
      })
    )
    .default([])
    .describe('Optional richer-vocabulary nudges — alternatives to weigh, not edits to apply.'),
  questions: z
    .array(z.string().min(1))
    .default([])
    .describe("Sharp questions that push the poet's own thinking."),
});
export type LyricCritique = z.infer<typeof lyricCritiqueOutputSchema>;

/** JSON Schema for the Claude tool input, derived from the Zod schema. */
export const lyricCritiqueOutputJsonSchema = z.toJSONSchema(lyricCritiqueOutputSchema) as Record<string, unknown>;
