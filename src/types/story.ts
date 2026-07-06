/**
 * "Share Your Story" community feature — the shared contract.
 *
 * A Tamil fan shares a memory tied to a song theme. The submission lands in a
 * managed ADMIN inbox (PK=STORY#<id>, SK=METADATA), can optionally grow the
 * email subscriber list, and feeds Raj's songwriting.
 *
 * This module is CLIENT-SAFE: it imports no server SDK, so the public API route,
 * the visitor form, and the admin page can all share one source of truth for the
 * themes, statuses, and validation schema.
 */

import { z } from 'zod';

/** The song-theme a memory is tied to. Drives the form select + admin filter. */
export const STORY_THEMES = ['mother', 'homeland', 'love', 'roots', 'childhood', 'other'] as const;
export type StoryTheme = (typeof STORY_THEMES)[number];

/** Tamil labels for each theme (visitor-facing → RESPECTFUL register elsewhere). */
export const STORY_THEME_LABELS: Record<StoryTheme, string> = {
  mother: 'அம்மா',
  homeland: 'தாயகம்',
  love: 'காதல்',
  roots: 'வேர்கள்',
  childhood: 'குழந்தைப் பருவம்',
  other: 'மற்றவை',
};

/** Moderation lifecycle for a story in the admin inbox. */
export const STORY_STATUSES = ['NEW', 'REVIEWED', 'FEATURED', 'ARCHIVED'] as const;
export type StoryStatus = (typeof STORY_STATUSES)[number];

export const DEFAULT_STORY_STATUS: StoryStatus = 'NEW';

/** The persisted story item shape (as returned to the admin UI). */
export interface Story {
  id: string;
  name: string;
  theme: StoryTheme;
  story: string;
  email?: string;
  featureConsent: boolean;
  status: StoryStatus;
  source: string;
  createdAt: string;
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Validation — shared by POST /api/stories and the visitor StoryForm.
// ---------------------------------------------------------------------------

/**
 * Create-story contract. Mirrors the contact route: honeypot `company` is
 * accepted-then-silently-discarded (never a validation error that reveals the
 * trap). An empty email string normalizes to `undefined` so it's simply absent.
 */
export const createStorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  theme: z.enum(STORY_THEMES),
  story: z
    .string()
    .trim()
    .min(10, 'Please share a little more of your memory')
    .max(5000),
  email: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().email('A valid email is required').max(200).optional()
  ),
  featureConsent: z.boolean().default(false),
  // Honeypot: real users never fill this hidden field; bots often do.
  company: z.string().optional(),
});

export type CreateStoryInput = z.infer<typeof createStorySchema>;

/** Admin PATCH contract — set a story's moderation status. */
export const updateStoryStatusSchema = z.object({
  id: z.string().trim().min(1),
  status: z.enum(STORY_STATUSES),
});
export type UpdateStoryStatusInput = z.infer<typeof updateStoryStatusSchema>;

/** Story ids look like `story_<ms>_<rand>` — validate before addressing a key. */
export function isStoryId(id: string): boolean {
  return /^story_[a-z0-9_]+$/i.test(id);
}
