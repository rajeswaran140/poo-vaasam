/**
 * Public Songs API contract.
 *
 * The single source of truth for the shape of GET /api/songs. The route
 * validates its OWN output against this before serving, so the contract the
 * web player and the Expo app code against can never silently drift from what
 * the server emits. `PublicSongContract` (z.infer) is the type clients import.
 */

import { z } from 'zod';

export const audioTrackSchema = z.object({
  url: z.url(),
  durationSeconds: z.number().positive().optional(),
  mimeType: z.string().min(1),
});

export const publicSongSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string(),
  artist: z.string(),
  audio: audioTrackSchema,
  // featuredImage may be an absolute CDN URL or a site-relative path — accept both.
  coverUrl: z.string().min(1).optional(),
  theme: z.string().min(1),
  youtubeVideoId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{11}$/, 'Must be an 11-character YouTube video ID')
    .optional(),
  // Whether structured lyrics exist — clients show a "lyrics available" affordance
  // without the list endpoint shipping the full text.
  hasLyrics: z.boolean(),
  publishedAt: z.string(),
});

export const publicSongsResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(publicSongSchema),
  total: z.number().int().nonnegative(),
});

export type PublicSongContract = z.infer<typeof publicSongSchema>;
export type PublicSongsResponse = z.infer<typeof publicSongsResponseSchema>;
