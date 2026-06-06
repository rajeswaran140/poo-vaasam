/**
 * Async compose job — the durable handoff between the request that enqueues a
 * brief and the worker Lambda that generates it. The form polls the job by id
 * until it's `done` (result populated) or `error`.
 */

import type { ComposerAnalysis } from '@/services/ai/composerSchema';

export type ComposeJobStatus = 'processing' | 'done' | 'error';

export interface ComposeJob {
  id: string;
  status: ComposeJobStatus;
  createdAt: string;
  updatedAt: string;
  /** The brief, once the worker finishes. */
  result: ComposerAnalysis | null;
  /** Structured failure (code mirrors the composer's ComposeErrorCode). */
  error: { code: string; message: string } | null;
}
