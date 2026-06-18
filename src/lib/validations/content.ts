/**
 * Content Validation Schemas
 *
 * Zod schemas for validating content-related API requests
 */

import { z } from 'zod';
import { ContentType, ContentStatus, WORKFLOW_STATES } from '@/types/content';
import { LYRICS_SECTION_KINDS } from '@/domain/songs/Lyrics';

// Admin forms submit '' for blank URL fields; treat empty string as absent
// so optional URL validation doesn't reject it.
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

/**
 * Structured-lyrics input schema. Validates the SHAPE only; the Lyrics value
 * object does the deeper sanitising (trimming, caps, dropping empties) on the
 * way into the entity, so this stays permissive on content and strict on type.
 */
export const lyricsLineSchema = z.object({
  text: z.string(),
  romanized: z.string().optional(),
  startSeconds: z.number().nonnegative().optional(),
});

export const lyricsSectionSchema = z.object({
  kind: z.enum(LYRICS_SECTION_KINDS),
  label: z.string().optional(),
  lines: z.array(lyricsLineSchema),
});

export const lyricsSchema = z.object({
  sections: z.array(lyricsSectionSchema).max(50, 'Too many lyric sections'),
});

/**
 * Create Content Validation Schema
 */
export const createContentSchema = z.object({
  type: z.nativeEnum(ContentType, {
    message: 'Invalid content type. Must be LYRICS, SONGS, POEMS, STORIES, or ESSAYS.',
  }),
  title: z
    .string()
    .min(1, 'Title is required')
    .max(200, 'Title must be less than 200 characters')
    .trim(),
  body: z
    .string()
    .min(1, 'Body content is required')
    .max(50000, 'Body must be less than 50,000 characters')
    .trim(),
  description: z
    .string()
    .max(500, 'Description must be less than 500 characters')
    .trim(),
  author: z
    .string()
    .min(1, 'Author is required')
    .max(100, 'Author name must be less than 100 characters')
    .trim(),
  featuredImage: z
    .string()
    .url('Featured image must be a valid URL')
    .optional(),
  audioUrl: z.preprocess(
    emptyToUndefined,
    z.string().url('Audio URL must be a valid URL').optional()
  ),
  videoUrl: z.preprocess(
    emptyToUndefined,
    z.string().url('Video URL must be a valid URL').optional()
  ),
  previewVideoUrl: z.preprocess(
    emptyToUndefined,
    z.string().url('Preview video URL must be a valid URL').optional()
  ),
  audioDuration: z
    .number()
    .int('Audio duration must be an integer')
    .positive('Audio duration must be positive')
    .max(7200, 'Audio duration must be less than 2 hours')
    .optional(),
  categoryIds: z
    .array(z.string())
    .max(10, 'Cannot assign more than 10 categories')
    .default([]),
  tagIds: z
    .array(z.string())
    .max(20, 'Cannot assign more than 20 tags')
    .default([]),
  status: z
    .nativeEnum(ContentStatus)
    .default(ContentStatus.DRAFT),
  seoTitle: z
    .string()
    .max(60, 'SEO title must be less than 60 characters')
    .optional(),
  seoDescription: z
    .string()
    .max(160, 'SEO description must be less than 160 characters')
    .optional(),
  lyrics: lyricsSchema.optional(),
});

/**
 * Update Content Validation Schema
 */
export const updateContentSchema = z.object({
  id: z
    .string()
    .min(1, 'Content ID is required'),
  title: z
    .string()
    .min(1, 'Title cannot be empty')
    .max(200, 'Title must be less than 200 characters')
    .trim()
    .optional(),
  body: z
    .string()
    .min(1, 'Body cannot be empty')
    .max(50000, 'Body must be less than 50,000 characters')
    .trim()
    .optional(),
  description: z
    .string()
    .max(500, 'Description must be less than 500 characters')
    .trim()
    .optional(),
  author: z
    .string()
    .min(1, 'Author cannot be empty')
    .max(100, 'Author name must be less than 100 characters')
    .trim()
    .optional(),
  featuredImage: z.preprocess(
    emptyToUndefined,
    z.string().url('Featured image must be a valid URL').optional().nullable()
  ),
  audioUrl: z.preprocess(
    emptyToUndefined,
    z.string().url('Audio URL must be a valid URL').optional().nullable()
  ),
  videoUrl: z.preprocess(
    emptyToUndefined,
    z.string().url('Video URL must be a valid URL').optional().nullable()
  ),
  previewVideoUrl: z.preprocess(
    emptyToUndefined,
    z.string().url('Preview video URL must be a valid URL').optional().nullable()
  ),
  // Canonical 11-char YouTube ID — accepted as either explicit ID or empty.
  youtubeVideoId: z.preprocess(
    emptyToUndefined,
    z.string().regex(/^[A-Za-z0-9_-]{11}$/, 'Must be an 11-character YouTube video ID').optional().nullable()
  ),
  // Studio assets — all optional, URL-validated, nullable for clear-on-edit.
  wavUrl: z.preprocess(emptyToUndefined, z.string().url('WAV URL must be a valid URL').optional().nullable()),
  stemsUrl: z.preprocess(emptyToUndefined, z.string().url('Stems URL must be a valid URL').optional().nullable()),
  midiUrl: z.preprocess(emptyToUndefined, z.string().url('MIDI URL must be a valid URL').optional().nullable()),
  thumbnailUrl: z.preprocess(emptyToUndefined, z.string().url('Thumbnail URL must be a valid URL').optional().nullable()),
  workflowState: z.preprocess(emptyToUndefined, z.enum(WORKFLOW_STATES as unknown as [string, ...string[]]).optional().nullable()),
  audioDuration: z
    .number()
    .int('Audio duration must be an integer')
    .positive('Audio duration must be positive')
    .max(7200, 'Audio duration must be less than 2 hours')
    .optional()
    .nullable(),
  categoryIds: z
    .array(z.string())
    .max(10, 'Cannot assign more than 10 categories')
    .optional(),
  tagIds: z
    .array(z.string())
    .max(20, 'Cannot assign more than 20 tags')
    .optional(),
  status: z
    .nativeEnum(ContentStatus)
    .optional(),
  seoTitle: z
    .string()
    .max(60, 'SEO title must be less than 60 characters')
    .optional()
    .nullable(),
  seoDescription: z
    .string()
    .max(160, 'SEO description must be less than 160 characters')
    .optional()
    .nullable(),
  // null clears lyrics on edit; absent leaves them untouched.
  lyrics: lyricsSchema.optional().nullable(),
});

/**
 * Delete Content Validation Schema
 */
export const deleteContentSchema = z.object({
  id: z
    .string()
    .min(1, 'Content ID is required'),
});

/**
 * Query Params Validation Schema
 */
export const queryParamsSchema = z.object({
  type: z
    .nativeEnum(ContentType)
    .optional(),
  status: z
    .nativeEnum(ContentStatus)
    .optional(),
  limit: z
    .string()
    .optional()
    .default('20')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive().max(100)),
  cursor: z
    .string()
    .optional(), // Base64 encoded cursor for pagination
});

/**
 * Helper function to validate and parse request body
 */
export function validateRequestBody<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; errors: z.ZodError } {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return { success: false, errors: result.error };
}

/**
 * Helper to format Zod errors for API responses
 */
export function formatZodErrors(error: z.ZodError): Record<string, string[]> {
  const formatted: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const path = issue.path.join('.');
    if (!formatted[path]) {
      formatted[path] = [];
    }
    formatted[path].push(issue.message);
  }

  return formatted;
}
