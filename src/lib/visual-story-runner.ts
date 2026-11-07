'use client';

/**
 * Client helpers for the studio's multi-shot runs (the "Every shot" and
 * "Video from your pictures" panels): one paid POST at a time with a 429
 * back-off that Stop can interrupt, and following started clips to the end.
 * They drive the same per-shot routes as the shot cards, so the server's
 * reservations, budget cap and settles are unchanged.
 */

import { adminFetch } from '@/lib/client-auth';
import { delay } from '@/lib/poll-job';
import type { GenJob, Shot } from '@/types/visualStory';

export const RATE_LIMIT_WAIT_MS = 30_000;
const RATE_LIMIT_TRIES = 3;
export const FOLLOW_INTERVAL_MS = 10_000;
const FOLLOW_TIMEOUT_MS = 20 * 60_000;
export const OFFLINE = 'Could not reach the server.';
/** postWithRetry's status when Stop was pressed during a rate-limit wait: nothing was sent. */
export const STOPPED = -1;

export type PostOutcome = { ok: true; data?: Record<string, unknown> } | { ok: false; status: number; error: string };

export interface RunControl {
  signal: AbortSignal;
  isMounted: () => boolean;
  isStopped?: () => boolean;
}

export const shotLabel = (s: Pick<Shot, 'sceneOrder' | 'shotOrder'>) => `Scene ${s.sceneOrder}, shot ${s.shotOrder}`;

/** One POST (paid or not), retried after a 429. No signal: a paid call is never cut short. Status 0 = no answer. */
export async function postWithRetry(url: string, body: unknown, ctl: RunControl): Promise<PostOutcome> {
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await adminFetch(url, {
        method: 'POST',
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
    } catch {
      return { ok: false, status: 0, error: OFFLINE };
    }
    const json = await res.json().catch(() => null);
    if (res.ok && json?.success) return { ok: true, data: json.data };
    if (res.status === 429 && attempt < RATE_LIMIT_TRIES) {
      await delay(RATE_LIMIT_WAIT_MS, ctl.signal);
      if (!ctl.isMounted() || ctl.isStopped?.()) return { ok: false, status: STOPPED, error: '' };
      continue;
    }
    return { ok: false, status: res.status, error: json?.error || `HTTP ${res.status}` };
  }
}

export interface Started {
  jobId: string;
  shot: Shot;
}

export interface FollowResult {
  succeeded: Started[];
  /** One per job that ended without a clip, with the reason. */
  failed: (Started & { error: string })[];
  /** Still rendering when the cap (or leaving the page) ended the watch. */
  open: number;
}

/** Poll each started clip's job until it ends or the cap; a poll advances (and settles) the job on the server. */
export async function followClips(
  vsId: string,
  jobs: Started[],
  ctl: RunControl & { onProgress?: (finished: number, total: number) => void }
): Promise<FollowResult> {
  let open = [...jobs];
  const succeeded: Started[] = [];
  const failed: FollowResult['failed'] = [];
  const until = Date.now() + FOLLOW_TIMEOUT_MS;
  while (open.length && ctl.isMounted() && Date.now() < until) {
    const still: Started[] = [];
    for (const j of open) {
      let job: GenJob | undefined;
      try {
        const res = await adminFetch(`/api/admin/visual-story/${vsId}/video-jobs/${j.jobId}`, { signal: ctl.signal });
        const json = await res.json().catch(() => null);
        job = res.ok && json?.success ? (json.data as GenJob) : undefined;
      } catch {
        job = undefined; // transient: look again next round
      }
      if (job?.status === 'succeeded') succeeded.push(j);
      else if (job?.status === 'failed' || job?.status === 'cancelled') failed.push({ ...j, error: job.error || 'The video failed.' });
      else still.push(j);
    }
    open = still;
    ctl.onProgress?.(jobs.length - open.length, jobs.length);
    if (open.length) await delay(FOLLOW_INTERVAL_MS, ctl.signal);
  }
  return { succeeded, failed, open: open.length };
}
