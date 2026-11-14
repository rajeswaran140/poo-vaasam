/**
 * Storyboarder schema — the OUTPUT shape Claude must return for the Visual
 * Story Studio storyboard drafter (lyrics → characters + scenes → shots).
 * Single source of truth: validates the forced tool call and is handed to
 * Claude as the tool input_schema. The parsed output is assignable to
 * `{characters, scenes}` of `StoryboardDraft` (src/types/visualStory.ts).
 *
 * Client-safe: imports only zod and the shared types.
 */

import { z } from 'zod';
import { SHOT_MODES } from '@/types/visualStory';

export const storyboardShotSchema = z.object({
  durationSec: z.number().int().min(1).max(15).describe('Whole seconds, 1-15.'),
  mode: z.enum(SHOT_MODES).default('STILL').describe('STILL (image), MOTION (short clip) or HERO (premium clip).'),
  visualPrompt: z.string().trim().min(1).describe('What the camera sees, concrete and specific to this song.'),
  characterNames: z.array(z.string().min(1)).default([]).describe('Names from `characters` who appear in this shot.'),
});

export const storyboardSceneSchema = z.object({
  heading: z.string().trim().min(1).describe('Short scene heading.'),
  summary: z.string().trim().min(1).describe('One or two sentences on what happens in the scene.'),
  shots: z.array(storyboardShotSchema).min(1),
});

export const storyboardCharacterSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).describe('Visual description: age, build, clothing, distinguishing features.'),
});

export const storyboardOutputSchema = z.object({
  characters: z.array(storyboardCharacterSchema).max(6).default([]),
  // No upper bound here: a long song needs more scenes, and the drafter folds
  // any past maxScenesFor(window) into the last one instead of refusing the draft.
  scenes: z.array(storyboardSceneSchema).min(1),
});
export type StoryboardOutput = z.infer<typeof storyboardOutputSchema>;

/** JSON Schema for the Claude tool input, derived from the Zod schema. */
export const storyboardOutputJsonSchema = z.toJSONSchema(storyboardOutputSchema) as Record<string, unknown>;
