/**
 * Lyric draft — a managed, versioned home for the poet's own lyrics.
 *
 * Turns the Lyric Critic from a one-shot (paste → feedback → gone) into a
 * writing *workspace*: a draft has a title/theme/status and an ordered list of
 * VERSIONS. Each version is a snapshot of the lyric text plus the critique (if
 * any) that was run against THAT text — so revisions can be compared and the
 * "did I address the feedback?" loop ([[lyric-draft-feedback]]) has the prior
 * critique to diff against. Augment-the-craft, never ghostwrite: a version only
 * ever stores the poet's own words + feedback, never a rewrite.
 */

import { z } from 'zod';
import {
  critiqueAspectSchema,
  lyricCritiqueOutputSchema,
  type LyricCritique,
  type CritiqueAspect,
} from '@/services/ai/lyricCriticSchema';

export const LYRIC_DRAFT_STATUSES = ['seed', 'draft', 'polished', 'ready'] as const;
export type LyricDraftStatus = (typeof LYRIC_DRAFT_STATUSES)[number];
export const lyricDraftStatusSchema = z.enum(LYRIC_DRAFT_STATUSES);

export interface LyricDraftVersion {
  version: number;
  lyrics: string;
  focus: CritiqueAspect[];
  notes?: string;
  /** The critique run against this exact version, if one was saved with it. */
  critique: LyricCritique | null;
  critiquedAt?: string;
  createdAt: string;
}

export interface LyricDraft {
  id: string;
  title: string;
  /**
   * Unsaved in-progress text, overwritten in place by autosave and NEVER
   * versioned. Versions are deliberate acts — the unit a critique is filed
   * against — so autosaving into them would bury the handful of real revisions
   * under keystroke snapshots. See lib/lyric-autosave.
   */
  workingLyrics?: string;
  workingUpdatedAt?: string;
  theme?: string;
  status: LyricDraftStatus;
  latestVersion: number;
  createdAt: string;
  updatedAt: string;
  /** Ordered oldest→newest. Populated by get(); omitted from list summaries. */
  versions: LyricDraftVersion[];
}

/** Lightweight row for the drafts list (no full version bodies). */
export interface LyricDraftSummary {
  id: string;
  title: string;
  theme?: string;
  status: LyricDraftStatus;
  latestVersion: number;
  snippet: string;
  updatedAt: string;
}

// The lyric-bearing payload shared by "create draft" and "save new version".
const versionPayloadSchema = z.object({
  lyrics: z.string().trim().min(1, 'Lyrics are required').max(8000),
  focus: z.array(critiqueAspectSchema).max(6).default([]),
  notes: z.string().trim().max(1000).optional(),
  // The just-produced critique for this text, if any (stored verbatim with the version).
  critique: lyricCritiqueOutputSchema.nullish().transform((c) => c ?? null),
});

export const createLyricDraftSchema = versionPayloadSchema.extend({
  title: z.string().trim().min(1, 'Give the draft a title').max(120),
  theme: z.string().trim().max(120).optional(),
});
export type CreateLyricDraftInput = z.infer<typeof createLyricDraftSchema>;

export const addVersionSchema = versionPayloadSchema;
export type AddVersionInput = z.infer<typeof addVersionSchema>;

export const updateLyricDraftMetaSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    theme: z.string().trim().max(120).optional(),
    // Autosave target. Same 8000 ceiling as a version's lyrics so a working
    // copy can always be promoted to one without truncation.
    workingLyrics: z.string().max(8000).optional(),
    status: lyricDraftStatusSchema.optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'No fields to update' });
export type UpdateLyricDraftMetaInput = z.infer<typeof updateLyricDraftMetaSchema>;

/** First non-empty line of a lyric, truncated — used as the list preview. Pure. */
export function draftSnippet(lyrics: string, max = 90): string {
  const first = (lyrics ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean) ?? '';
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}
