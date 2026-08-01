/**
 * Detecting a mastering job whose worker died without saying so.
 *
 * The worker wraps its body in try/catch and patches the job to `error` on the
 * way out — but a Lambda TIMEOUT or an out-of-memory kill terminates the
 * process before any catch runs. The job then sits at `processing` forever: the
 * Studio spins with no end state, and 24 hours later the record silently
 * expires on its ttl, so even the evidence disappears. Verified 2026-08-01 that
 * nothing else covers this — `DeadLetterConfig` on `tamilagaval-master-worker`
 * is null and there is no failure destination.
 *
 * The check lives here, pure, and is applied by the status route the Studio
 * already polls. That deliberately needs NO new infrastructure — no queue, no
 * consumer, no cron, no IAM change on a role shared with the compose worker —
 * and it catches every cause of death (timeout, OOM, throttle, a failed invoke)
 * rather than only the ones Lambda reports. It fires exactly when somebody is
 * looking at the job; one nobody polls simply expires on its ttl, which costs
 * nothing because nobody is waiting on it.
 */

import type { MasterJob } from '@/types/masterJob';

/** The Lambda's configured ceiling (`aws lambda get-function-configuration`). */
export const WORKER_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Slack on top of the ceiling before calling a job dead.
 *
 * Covers cold start, the S3 GET of a several-hundred-MB source, and the gap
 * between the worker's last patch and DynamoDB reflecting it. Too tight and a
 * slow-but-healthy master gets declared dead while it is still running — which
 * would be worse than the bug, because the operator would abandon a job that
 * was about to succeed.
 */
export const STUCK_GRACE_MS = 5 * 60 * 1000;

export const STUCK_AFTER_MS = WORKER_TIMEOUT_MS + STUCK_GRACE_MS;

/** Recorded on the job so the Studio and any later reader agree on the cause. */
export const STUCK_ERROR = {
  code: 'worker-died',
  message:
    'The mastering worker stopped without reporting a result — most likely it hit the 15-minute limit or ran out of memory. Nothing was written; re-run the job.',
} as const;

/**
 * True when a job claims to be running but cannot still be.
 *
 * Keyed off `createdAt`, not `updatedAt`: the worker's only intermediate write
 * is the terminal one, so `updatedAt` on a processing job is still its creation
 * stamp. Using it would be the same number today and quietly wrong the moment
 * the worker starts reporting progress.
 */
export function isStuck(
  job: Pick<MasterJob, 'status' | 'createdAt'>,
  nowMs: number
): boolean {
  if (job.status !== 'processing') return false;
  const started = Date.parse(job.createdAt);
  // An unparseable stamp is not evidence of death. Leave it alone rather than
  // failing a job on a bad timestamp.
  if (!Number.isFinite(started)) return false;
  return nowMs - started > STUCK_AFTER_MS;
}
