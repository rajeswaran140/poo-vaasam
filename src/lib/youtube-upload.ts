/**
 * Deciding whether a rendered video may be uploaded, and with what.
 *
 * Pure and I/O-free, like planRender: this is the one place the rules live, so
 * the enqueue route and the worker cannot disagree about what is legal. The
 * worker re-runs it on the event it receives rather than trusting the caller.
 *
 * ⚠️ TWO ROLES, ONE RULE SET. The planner is asked the same question by two
 * callers standing in different places, and exactly one check differs between
 * them — see `UploadStage`. Everything else is shared on purpose: the point of
 * this module is that the route and the worker cannot disagree about what is
 * legal, and a second copy of the eligibility rules is how they would.
 */
import type { MasterJob } from '@/types/masterJob';

export type UploadStatus = 'idle' | 'queued' | 'uploading' | 'uploaded' | 'failed';

export type UploadRefusal =
  | 'no-video'
  | 'not-saved'
  | 'no-title'
  | 'no-description'
  | 'already-uploaded'
  | 'in-flight';

export interface UploadInput {
  title: string;
  description: string;
  tags: string[];
  playlistIds: string[];
}

export type UploadPlan =
  | {
      ok: true;
      videoKey: string;
      title: string;
      description: string;
      tags: string[];
      categoryId: '10';
      privacyStatus: 'private';
      playlistIds: string[];
      coverKey: string | null;
    }
  | { ok: false; reason: UploadRefusal };

/** YouTube's own limits. Exceeding either is a 400 from the API. */
const TITLE_LIMIT = 100;
const DESCRIPTION_LIMIT = 5000;

/**
 * How long an `'uploading'`/`'queued'` status is trusted as genuinely
 * in-flight before it is treated as abandoned and resumable.
 *
 * Consulted at `stage: 'enqueue'` only — it is the gate's answer to "may a
 * NEW attempt start?". The worker never consults it, because the worker is
 * the attempt.
 *
 * Derived from a hard platform fact, not a guessed number: the master-worker
 * Lambda's configured timeout is 900s (verified against the live function —
 * `aws lambda get-function-configuration --function-name tamilagaval-master-worker`
 * → `Timeout: 900` — on 2026-09-15). The worker CANNOT still be running past
 * that, so once `updatedAt` is older than the timeout the status can only be
 * a crash artifact. The extra 5 minutes of margin absorbs clock skew and a
 * slow final write. If the Lambda's timeout is ever raised, this constant
 * must be raised with it.
 *
 * This is a SAFETY NET, not the primary duplicate-insert defense — that is
 * still `youtubeVideoId` (checked first, below, and unaffected by staleness)
 * and the resumed `uploadSessionUri`. Even if this window is ever too short
 * and a second invocation overlaps a genuinely-running upload, both of those
 * still hold: the id guard fires before any insert, and a stored session uri
 * makes the second attempt RESUME the same resumable upload instead of
 * opening a new one. The worst case is a resumed PUT, never a second video.
 */
export const UPLOAD_STALE_AFTER_MS = 15 * 60 * 1000 + 5 * 60 * 1000; // 900s Lambda ceiling + 5min margin

/**
 * WHICH OF THE TWO CALLERS IS ASKING.
 *
 * `'enqueue'` — the API route, standing OUTSIDE the upload. It is the gate,
 * so it needs every check, `in-flight` included: that refusal is what makes a
 * double-click lose the race instead of starting a second upload.
 *
 * `'execute'` — the worker, which IS the in-flight owner the `queued` status
 * refers to. The route marks the job `queued` (stamping a fresh `updatedAt`)
 * and THEN Event-invokes the worker, so the row the worker reads back is
 * always `queued` and always seconds old. Re-applying the concurrency refusal
 * there made the worker refuse its own invocation — the feature could not
 * complete even once, and a retry only repeated the loop. `'execute'` skips
 * that ONE check and nothing else.
 *
 * ⚠️ `'execute'` is NOT a "skip the checks" mode. `already-uploaded`,
 * `no-video`, `not-saved`, `no-title` and `no-description` all still apply —
 * `already-uploaded` above all, since it is the duplicate-video guard and the
 * worker is the only caller that can actually create the duplicate.
 */
export type UploadStage = 'enqueue' | 'execute';

export interface PlanUploadOptions {
  /** Injected so staleness is testable without the real clock. */
  now?: number;
  /** Defaults to the stricter role, so a forgotten option fails closed. */
  stage?: UploadStage;
}

export function planUpload(
  job: MasterJob,
  input: UploadInput,
  { now = Date.now(), stage = 'enqueue' }: PlanUploadOptions = {},
): UploadPlan {
  // Ordered so the most decisive refusal wins: a job that already produced a
  // video must never reach the insert path, whatever else is wrong with it —
  // and staleness must NEVER weaken this. A stale-and-already-uploaded job
  // still refuses `already-uploaded`, because this check runs first and does
  // not consult time at all.
  //
  // ⚠️ This MUST stay a JS truthiness check. Every job row is created with
  // `youtubeVideoId: null`, and DynamoDB persists a JS null as a NULL-type
  // attribute — an attribute that EXISTS. So a conditional write using
  // `attribute_not_exists(youtubeVideoId)` would evaluate false for every row,
  // forever, and "upgrading" this guard to one would refuse every upload
  // permanently while looking like a hardening improvement. See the field's
  // own doc comment in masterJob.ts.
  if (job.youtubeVideoId) return { ok: false, reason: 'already-uploaded' };
  // THE CONCURRENCY CHECK — and the only one that is role-dependent.
  //
  // WHY THE WORKER SKIPS IT: the worker is not a second caller racing the
  // upload, it IS the upload. `queued` was written by the route on this
  // worker's behalf, microseconds before the invoke, so asking the worker to
  // honour it is asking it to refuse itself. Every other refusal below is a
  // property of the JOB, true no matter who is asking, so none of them are
  // skipped here.
  if (stage === 'enqueue' && (job.uploadStatus === 'uploading' || job.uploadStatus === 'queued')) {
    // Unknown/unparseable `updatedAt` cannot prove staleness, so it is
    // treated as still in-flight — the safe direction when the evidence is
    // missing rather than merely old.
    const updatedAtMs = job.updatedAt ? Date.parse(job.updatedAt) : NaN;
    const age = now - updatedAtMs;
    const isStale = Number.isFinite(age) && age > UPLOAD_STALE_AFTER_MS;
    if (!isStale) return { ok: false, reason: 'in-flight' };
  }
  if (!job.videoKey) return { ok: false, reason: 'no-video' };
  if (!job.savedAt) return { ok: false, reason: 'not-saved' };
  if (!input.title?.trim()) return { ok: false, reason: 'no-title' };
  if (!input.description?.trim()) return { ok: false, reason: 'no-description' };

  return {
    ok: true,
    videoKey: job.videoKey,
    title: input.title.trim().slice(0, TITLE_LIMIT),
    description: input.description.trim().slice(0, DESCRIPTION_LIMIT),
    tags: input.tags.filter((t) => t.trim()).map((t) => t.trim()),
    // Never configurable. 10 = Music; the portal uploads nothing else.
    categoryId: '10',
    // Never configurable. The Data API cannot create a Premiere, so publishing
    // from here would forfeit the premiere the operator always wants.
    privacyStatus: 'private',
    playlistIds: input.playlistIds.filter(Boolean),
    coverKey: job.coverKey ?? null,
  };
}

/** Operator-facing wording. Says what to DO wherever there is something. */
export function uploadRefusalMessage(reason: UploadRefusal): string {
  switch (reason) {
    case 'no-video':
      return 'Render the video before uploading it.';
    case 'not-saved':
      return 'Save this master before uploading its video.';
    case 'no-title':
      return 'Give the upload a title.';
    case 'no-description':
      return 'Write the description before uploading.';
    case 'already-uploaded':
      return 'This master is already on YouTube. Delete that video first if you need to replace it — a video file cannot be swapped in place.';
    case 'in-flight':
      return 'An upload is already running for this master.';
  }
}
