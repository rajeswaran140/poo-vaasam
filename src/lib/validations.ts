/**
 * Validation Schemas
 *
 * Zod schemas for form validation
 */

import { z } from 'zod';
import { ContentType, ContentStatus } from '@/types/content';

/**
 * Content Form Validation Schema
 */
export const contentSchema = z.object({
  type: z.nativeEnum(ContentType),
  title: z
    .string()
    .min(1, 'Title is required')
    .max(200, 'Title must be less than 200 characters')
    .trim(),
  body: z
    .string()
    .min(10, 'Content body must be at least 10 characters')
    .max(50000, 'Content body must be less than 50,000 characters'),
  description: z
    .string()
    .max(500, 'Description must be less than 500 characters')
    .optional(),
  author: z
    .string()
    .min(1, 'Author is required')
    .max(100, 'Author name must be less than 100 characters')
    .trim(),
  status: z.nativeEnum(ContentStatus),
  categoryIds: z
    .array(z.string())
    .max(5, 'Maximum 5 categories allowed')
    .default([]),
  tagIds: z
    .array(z.string())
    .max(10, 'Maximum 10 tags allowed')
    .default([]),
  audioUrl: z
    .string()
    .url('Please enter a valid URL')
    .optional()
    .or(z.literal('')),
  audioDuration: z
    .number()
    .min(0, 'Duration cannot be negative')
    .max(7200, 'Duration must be less than 2 hours')
    .optional(),
  featuredImage: z
    .string()
    .url('Please enter a valid image URL')
    .optional()
    .or(z.literal('')),
  seoTitle: z
    .string()
    .max(60, 'SEO title should be less than 60 characters')
    .optional(),
  seoDescription: z
    .string()
    .max(160, 'SEO description should be less than 160 characters')
    .optional(),
});

export type ContentFormData = z.infer<typeof contentSchema>;

/**
 * Category Form Validation Schema
 */
export const categorySchema = z.object({
  name: z
    .string()
    .min(1, 'Category name is required')
    .max(50, 'Category name must be less than 50 characters')
    .trim()
    .refine(
      (name) => /^[a-zA-Z0-9\s\u0B80-\u0BFF]+$/.test(name),
      'Category name can only contain letters, numbers, and Tamil characters'
    ),
  description: z
    .string()
    .max(200, 'Description must be less than 200 characters')
    .optional(),
});

export type CategoryFormData = z.infer<typeof categorySchema>;

/**
 * Tag Form Validation Schema
 */
export const tagSchema = z.object({
  name: z
    .string()
    .min(1, 'Tag name is required')
    .max(30, 'Tag name must be less than 30 characters')
    .trim()
    .refine(
      (name) => /^[a-zA-Z0-9\u0B80-\u0BFF]+$/.test(name),
      'Tag name can only contain letters, numbers, and Tamil characters (no spaces)'
    ),
});

export type TagFormData = z.infer<typeof tagSchema>;

/**
 * URL Validation Helper
 */
export const urlSchema = z
  .string()
  .url('Invalid URL format')
  .refine(
    (url) => {
      try {
        const parsed = new URL(url);
        return ['http:', 'https:'].includes(parsed.protocol);
      } catch {
        return false;
      }
    },
    'URL must use HTTP or HTTPS protocol'
  );

/**
 * Email Validation
 */
export const emailSchema = z
  .string()
  .email('Invalid email address')
  .min(1, 'Email is required');

/**
 * Validate data against a schema and return formatted errors
 */
export function validateData<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; errors: Record<string, string> } {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  // Format Zod errors into a more user-friendly structure
  const errors: Record<string, string> = {};
  result.error.issues.forEach((err: z.ZodIssue) => {
    const path = err.path.join('.');
    errors[path] = err.message;
  });

  return { success: false, errors };
}
