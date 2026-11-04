/**
 * Visual Story Studio — the shared contract.
 *
 * A visual story is a storyboard (scenes → shots) laid over a window of a
 * mastered song. This module is CLIENT-SAFE: it imports no server SDK, so the
 * admin routes, the studio UI and the worker can share one source of truth for
 * statuses, ids, validation schemas and timeline arithmetic.
 */

import { z } from 'zod';

export type VisualStoryStatus = 'DRAFT' | 'STORYBOARDING' | 'GENERATING' | 'REVIEW' | 'COMPLETE';
export type ShotMode = 'STILL' | 'MOTION' | 'HERO';
export type GenJobStatus = 'submitted' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type AspectRatio = '16:9' | '9:16';

export const SHOT_MODES = ['STILL', 'MOTION', 'HERO'] as const;
export const ASPECT_RATIOS = ['16:9', '9:16'] as const;

export const DEFAULT_BUDGET_USD_CAP = 40;
export const MIN_WINDOW_SEC = 30;
export const MAX_WINDOW_SEC = 120;
export const MIN_SHOT_SEC = 1;
export const MAX_SHOT_SEC = 15;

// ---------------------------------------------------------------------------
// Persisted shapes (as returned to the admin UI)
// ---------------------------------------------------------------------------

/** METADATA item of a visual story. */
export interface VisualStory {
  vsId: string;
  masterJobId: string;
  audioKey: string;
  contentId: string | null;
  title: string;
  status: VisualStoryStatus;
  aspectRatio: AspectRatio;
  providerId: string;
  windowStartSec: number;
  windowEndSec: number;
  budgetUsdCap: number;
  spentUsd: number;
  reservedUsd: number;
  committedUsd: number;
  createdAt: string;
  updatedAt: string;
}

export interface Character {
  charId: string;
  name: string;
  description: string;
  refImageKeys: string[];
  createdAt: string;
}

export interface Scene {
  order: number;
  heading: string;
  summary: string;
  tamilText?: string;
}

export interface Shot {
  sceneOrder: number;
  shotOrder: number;
  mode: ShotMode;
  durationSec: number;
  /** Derived: cumulative across all shots in scene order then shot order. */
  startSec: number;
  visualPrompt: string;
  negativePrompt: string;
  charIds: string[];
  firstFrameCandidateId?: string;
  selectedCandidateId: string | null;
}

export interface Candidate {
  candId: string;
  sceneOrder: number;
  shotOrder: number;
  jobId: string;
  providerId: string;
  providerTaskId: string;
  s3Key: string;
  posterKey?: string;
  costUsd: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// LLM storyboard draft (client-safe; spec §6.5)
// ---------------------------------------------------------------------------

export interface DraftShot {
  durationSec: number;
  mode: ShotMode;
  visualPrompt: string;
  characterNames: string[];
}

export interface DraftScene {
  heading: string;
  summary: string;
  shots: DraftShot[];
}

export interface DraftCharacter {
  name: string;
  description: string;
}

export interface StoryboardDraft {
  draftId: string;
  lyricsHash: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  characters: DraftCharacter[];
  scenes: DraftScene[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Ids — `<prefix>_<13-digit ms>_<random>`; validate before building any key.
// ---------------------------------------------------------------------------

export type IdPrefix = 'vs' | 'ch' | 'cd' | 'dr';

function idGuard(prefix: IdPrefix): (s: unknown) => boolean {
  const re = new RegExp(`^${prefix}_\\d{13}_[a-z0-9]{6,12}$`);
  return (s) => typeof s === 'string' && re.test(s);
}

export const isVsId = idGuard('vs');
export const isCharId = idGuard('ch');
export const isCandId = idGuard('cd');
export const isDraftId = idGuard('dr');

export function newId(prefix: IdPrefix): string {
  let rand = '';
  while (rand.length < 8) rand += Math.random().toString(36).slice(2);
  return `${prefix}_${Date.now()}_${rand.slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export const createStorySchema = z
  .object({
    masterJobId: z.string().trim().min(1),
    title: z.string().trim().min(1, 'Title is required').max(120),
    aspectRatio: z.enum(ASPECT_RATIOS),
    windowStartSec: z.number().min(0),
    windowEndSec: z.number(),
    contentId: z.string().trim().min(1).optional(),
    budgetUsdCap: z.number().min(0).max(500).optional(),
  })
  .refine(
    (v) => {
      const len = v.windowEndSec - v.windowStartSec;
      return len >= MIN_WINDOW_SEC && len <= MAX_WINDOW_SEC;
    },
    { message: `The window must be ${MIN_WINDOW_SEC}–${MAX_WINDOW_SEC} seconds long`, path: ['windowEndSec'] }
  );
export type CreateStoryInput = z.infer<typeof createStorySchema>;

export const sceneInputSchema = z.object({
  heading: z.string().trim().min(1, 'Heading is required').max(120),
  summary: z.string().trim().max(600),
});
export type SceneInput = z.infer<typeof sceneInputSchema>;

export const shotInputSchema = z.object({
  mode: z.enum(SHOT_MODES),
  durationSec: z.number().int().min(MIN_SHOT_SEC).max(MAX_SHOT_SEC),
  visualPrompt: z.string().trim().min(1, 'A visual prompt is required').max(2000),
  negativePrompt: z.string().trim().max(1000),
  charIds: z.array(z.string()).max(14),
});
export type ShotInput = z.infer<typeof shotInputSchema>;

export const characterInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  description: z.string().trim().max(1000),
});
export type CharacterInput = z.infer<typeof characterInputSchema>;

export const draftRequestSchema = z.object({
  lyrics: z.string().trim().min(1, 'Paste the lyrics').max(8000),
});
export type DraftRequest = z.infer<typeof draftRequestSchema>;

// ---------------------------------------------------------------------------
// Timeline helpers
// ---------------------------------------------------------------------------

/** startSec per shot, cumulative from 0 (shots already in scene→shot order). */
export function deriveStartSecs(shots: { durationSec: number }[]): number[] {
  let t = 0;
  return shots.map((s) => {
    const start = t;
    t += s.durationSec;
    return start;
  });
}

/** True when the shots exactly tile the window. */
export function tilesWindow(shots: { durationSec: number }[], windowSec: number): boolean {
  return shots.reduce((sum, s) => sum + s.durationSec, 0) === windowSec;
}
