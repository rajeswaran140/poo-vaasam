/**
 * Async critic job — the durable handoff between the request that enqueues a
 * lyric critique and the worker Lambda that produces it. The form polls the job
 * by id until it's `done` (result populated) or `error`. Mirrors composeJob.ts;
 * a full-ballad critique is ~50-70s, over Amplify's SSR ceiling, so it can't run
 * inline.
 */

import type { LyricCritique } from '@/services/ai/lyricCriticSchema';

export type CriticJobStatus = 'processing' | 'done' | 'error';

export interface CriticJob {
  id: string;
  status: CriticJobStatus;
  createdAt: string;
  updatedAt: string;
  /** The critique, once the worker finishes. */
  result: LyricCritique | null;
  /** Structured failure (code mirrors the critic's LyricCritiqueErrorCode). */
  error: { code: string; message: string } | null;
}
