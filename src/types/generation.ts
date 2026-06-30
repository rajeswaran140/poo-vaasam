/**
 * Generation — a single ATTEMPT at producing audio for a Brief (Music Lab,
 * Phase 1). A Brief is the durable *intent* (lyrics + analysis); one brief
 * yields many generations, each its own audio + engine settings + human
 * evaluation + verdict. Cataloguing the failures (not just the keepers) is what
 * turns the catalogue into a proprietary Tamil-music research dataset — see
 * project_poo_vaasam_composer / the "Music Lab" direction.
 *
 * The Zod schema is the contract: the API validates against it and the client
 * form derives its types from it, so they can't drift. No server-only SDKs are
 * imported here, so it's safe to import from a client component.
 */

import { z } from 'zod';

/** Generation engines we may log against. SUNO is the current human-in-loop one. */
export const GENERATION_ENGINES = ['suno', 'lyria', 'udio', 'other'] as const;

/** Overall human verdict for the attempt. */
export const GENERATION_VERDICTS = ['success', 'partial', 'failed'] as const;

/**
 * Failure taxonomy — what primarily went wrong. Kept small + closed so the
 * dataset stays aggregatable ("failures cluster on vocal_delivery at tempo>130").
 */
export const FAILURE_REASONS = [
  'melody',
  'rhythm',
  'lyrics',
  'pronunciation',
  'arrangement',
  'emotion',
  'mixing',
  'vocal_delivery',
  'other',
] as const;

// 0–10 human ratings. Optional per-axis so a quick log doesn't force all four.
const scoreField = z.number().int().min(0).max(10);

export const generationScoresSchema = z
  .object({
    melody: scoreField.optional(),
    vocals: scoreField.optional(),
    lyrics: scoreField.optional(),
    mix: scoreField.optional(),
  })
  .default({});

/**
 * LEGACY objective audio measurements — kept only so OLD takes still render.
 * New takes use server-measured `loudness` (see loudnessSchema); the client-side
 * Web-Audio decode that produced this was removed. All finite dBFS/LU values.
 */
export const audioMetricsSchema = z.object({
  durationSec: z.number().nonnegative(),
  peakDbfs: z.number(),
  rmsDbfs: z.number(),
  crestDb: z.number(),
  clipPct: z.number().min(0).max(100),
  lufsIntegrated: z.number().nullable(),
});
export type AudioMetricsRecord = z.infer<typeof audioMetricsSchema>;

/**
 * Server-measured loudness (from the measure-fn Lambda: ffmpeg ebur128+astats).
 * Replaces the legacy client-side audioMetrics for new takes — the browser no
 * longer decodes audio. badge + verdict are computed server-side.
 */
export const loudnessSchema = z.object({
  lufs: z.number(),
  lra: z.number(),
  truePeak: z.number(),
  crest: z.number(),
  flatFactor: z.number(),
  badge: z.string().max(64),
  verdict: z.enum(['ok', 'hot', 'quiet', 'clip-risk', 'squashed']),
});
export type LoudnessRecord = z.infer<typeof loudnessSchema>;

export const generationSettingsSchema = z
  .object({
    /** SUNO "weirdness" knob (0–100). */
    weirdness: z.number().min(0).max(100).optional(),
    /** SUNO "style influence" knob (0–100). */
    styleInfluence: z.number().min(0).max(100).optional(),
    /** Free-text engine/model tag, e.g. "suno v4.5". */
    engineModel: z.string().max(120).optional(),
  })
  .default({});

/**
 * Body accepted by POST /api/admin/generations. Empty audioUrl is coerced to
 * undefined so the form can submit "no audio yet" without tripping url() —
 * you often rate a brief's prompt before the MP3 is back.
 */
export const createGenerationSchema = z
  .object({
    briefId: z.string().min(1, 'briefId is required'),
    engine: z.enum(GENERATION_ENGINES).default('suno'),
    /** Which brief style variant this attempt used (label from suno_prompts). */
    chosenStyle: z.string().max(120).optional(),
    audioUrl: z.preprocess(
      (v) => (v === '' || v === null ? undefined : v),
      // An audio URL must be http(s) — rejects junk schemes (javascript:, data:, …).
      z.url({ protocol: /^https?$/, error: 'audioUrl must be an http(s) URL' }).max(2048).optional()
    ),
    settings: generationSettingsSchema,
    scores: generationScoresSchema,
    verdict: z.enum(GENERATION_VERDICTS),
    failureReason: z.enum(FAILURE_REASONS).optional(),
    notes: z.string().max(4000).default(''),
    /** Legacy client-measured audio (kept for old takes; new takes use `loudness`). */
    audioMetrics: audioMetricsSchema.nullish().transform((m) => m ?? null),
    /** Server-measured loudness (measure-fn). */
    loudness: loudnessSchema.nullish().transform((m) => m ?? null),
  })
  // A success has no failure reason — keeps the dataset coherent.
  .refine((d) => !(d.verdict === 'success' && d.failureReason), {
    message: 'failureReason is not allowed on a success',
    path: ['failureReason'],
  });

export type CreateGenerationInput = z.infer<typeof createGenerationSchema>;
export type GenerationScores = z.infer<typeof generationScoresSchema>;
export type GenerationSettings = z.infer<typeof generationSettingsSchema>;
export type GenerationEngine = (typeof GENERATION_ENGINES)[number];
export type GenerationVerdict = (typeof GENERATION_VERDICTS)[number];
export type FailureReason = (typeof FAILURE_REASONS)[number];

/** Stored generation record (input + server-assigned provenance fields). */
export interface Generation extends CreateGenerationInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Reserved for Phase 2 similarity search (DynamoDB cosine, then a vector DB at scale). */
  embedding: number[] | null;
}
