/**
 * Async AI jobs (compose / critique) run on a worker Lambda with a ~120s
 * budget. If that worker dies (OOM, hard timeout, or a dropped async event
 * after AWS's retries are exhausted) it never writes a terminal state, and the
 * job row is stuck `processing` until its 24h TTL. The poll routes use this to
 * report an authoritative timeout instead of echoing `processing` forever.
 */

export const JOB_STALL_MS = 180_000; // worker budget (120s) + async-retry margin

/** True when a `processing` job has outlived the worker budget (→ presumed dead). */
export function isStalledJob(
  job: { status: string; createdAt?: string | null },
  now = Date.now()
): boolean {
  if (job.status !== 'processing') return false;
  const started = job.createdAt ? Date.parse(job.createdAt) : NaN;
  return Number.isFinite(started) && now - started > JOB_STALL_MS;
}

/** Synthetic terminal error surfaced for a stalled job. */
export const JOB_TIMEOUT_ERROR = {
  code: 'upstream' as const,
  message: 'The job timed out — the worker didn’t finish in time. Please try again.',
};
