/**
 * Content Validation Schemas
 *
 * Zod schemas for validating content-related API requests
 */

import { z } from 'zod';
import { ContentType, ContentStatus } from '@/types/content';

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
  audioUrl: z
    .string()
    .url('Audio URL must be a valid URL')
    .optional(),
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
  featuredImage: z
    .string()
    .url('Featured image must be a valid URL')
    .optional()
    .nullable(),
  audioUrl: z
    .string()
    .url('Audio URL must be a valid URL')
    .optional()
    .nullable(),
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
