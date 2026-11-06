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
/**
 * Seven minutes — most whole songs. Bounded twice over (measured 2026-11-06):
 * the storyboard draft for 420 s is ~19k output tokens, under the SDK's
 * non-streaming ceiling (see draftMaxOutputTokens), and assembling 420 s of
 * zoomed stills is ~670 s of the 900 s worker (see estimateAssembleSec).
 */
export const MAX_WINDOW_SEC = 420;
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
  /** The GENJOB# that produced it; null for a STILL (synchronous, no job — spec §6.4). */
  jobId: string | null;
  providerId: string;
  /** Null for a STILL: the image call completes inside the request (spec §6.4). */
  providerTaskId: string | null;
  mode: ShotMode;
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

/**
 * A storyboard draft runs on the background worker (R14): the route reserves
 * and writes a `DRAFTJOB#<jobId>` item, the worker moves it queued → running →
 * done|failed, the client polls. Never carries the lyrics.
 */
export type DraftJobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface DraftJob {
  jobId: string;
  status: DraftJobStatus;
  createdAt: string;
  updatedAt: string;
  /** What the route reserved against the cap; the one settle releases exactly this. */
  reservedUsd: number;
  draftId?: string | null;
  code?: string | null;
  error?: string | null;
}

/**
 * A video generation job (`GENJOB#<jobId>`). Non-terminal rows are indexed on
 * GSI1 (`VSTORY_INFLIGHT`) so the reconciler can find them across stories.
 */
export interface GenJob {
  jobId: string;
  sceneOrder: number;
  shotOrder: number;
  status: GenJobStatus;
  providerId: string;
  providerTaskId: string | null;
  /** What the route reserved against the cap; the one settle releases exactly this. */
  reservedUsd: number;
  candId: string;
  attempts: number;
  copyFailures: number;
  lastPolledAt: string | null;
  /** A VideoErrorCode or 'billing' (kept a plain string: this module imports no provider types). */
  code?: string;
  error?: string;
  /** What the terminal transition decided to bill (the early-return settle uses it; Ruling V10). */
  billedUsd?: number;
  /** Set by the one settle of this job's reservation (Ruling V10). */
  settledAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Assembly (Phase 6, spec §7.4): RENDER#<renderId> in the story partition
// ---------------------------------------------------------------------------

export type RenderStatus = 'queued' | 'running' | 'done' | 'failed';

/**
 * One assembly of the timeline. It carries the shot list it was asked for, so
 * the worker — whose role cannot Query — renders exactly what was checked,
 * and a later edit of the story cannot change a render already queued.
 */
export interface RenderJob {
  renderId: string;
  status: RenderStatus;
  aspectRatio: AspectRatio;
  windowStartSec: number;
  windowEndSec: number;
  shots: Array<{ sceneOrder: number; shotOrder: number; key: string; durationSec: number }>;
  /** The route's estimate of worker time, seconds. */
  estimateSec: number;
  /** Set when done: the MP4 in the mastering workspace. */
  s3Key?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Ids — `<prefix>_<13-digit ms>_<random>`; validate before building any key.
// ---------------------------------------------------------------------------

export type IdPrefix = 'vs' | 'ch' | 'cd' | 'dr' | 'dj' | 'gj' | 'rd';

function idGuard(prefix: IdPrefix): (s: unknown) => boolean {
  const re = new RegExp(`^${prefix}_\\d{13}_[a-z0-9]{6,12}$`);
  return (s) => typeof s === 'string' && re.test(s);
}

export const isVsId = idGuard('vs');
export const isCharId = idGuard('ch');
export const isCandId = idGuard('cd');
export const isDraftId = idGuard('dr');
export const isDraftJobId = idGuard('dj');
export const isGenJobId = idGuard('gj');
export const isRenderId = idGuard('rd');

/** Deterministic candidate id for a video job, so a repeated copy is idempotent. */
export function candIdForJob(jobId: string): string {
  return `cd_${jobId.slice(3)}`;
}

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
