/**
 * Async SUNO-setup job — the durable handoff between the request that enqueues
 * an arrangement and the worker Lambda that produces it.
 *
 * WHY IT CANNOT RUN INLINE. Amplify's SSR compute caps at ~30s. Arranging a
 * full song is the same class of Sonnet call as a compose brief, which measured
 * **41s** on the worker on 2026-08-09. Run inline it returns 504 every time —
 * which is exactly what shipped, and what this replaces. Mirrors criticJob.ts.
 */

import type { SunoSetupOutput } from '@/services/ai/sunoSetupSchema';
import type { SetupFinding } from '@/lib/suno-setup';

export type SunoSetupJobStatus = 'processing' | 'done' | 'error';

/** What the worker writes on success — the setup plus its deterministic checks. */
export interface SunoSetupJobResult {
  setup: SunoSetupOutput;
  findings: SetupFinding[];
  ready: boolean;
}

export interface SunoSetupJob {
  id: string;
  status: SunoSetupJobStatus;
  createdAt: string;
  updatedAt: string;
  result: SunoSetupJobResult | null;
  error: { code: string; message: string } | null;
}
