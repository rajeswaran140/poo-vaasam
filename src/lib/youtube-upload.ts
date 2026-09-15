/**
 * Deciding whether a rendered video may be uploaded, and with what.
 *
 * Pure and I/O-free, like planRender: this is the one place the rules live, so
 * the enqueue route and the worker cannot disagree about what is legal. The
 * worker re-runs it on the event it receives rather than trusting the caller.
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

export function planUpload(job: MasterJob, input: UploadInput): UploadPlan {
  // Ordered so the most decisive refusal wins: a job that already produced a
  // video must never reach the insert path, whatever else is wrong with it.
  //
  // ⚠️ This MUST stay a JS truthiness check. Every job row is created with
  // `youtubeVideoId: null`, and DynamoDB persists a JS null as a NULL-type
  // attribute — an attribute that EXISTS. So a conditional write using
  // `attribute_not_exists(youtubeVideoId)` would evaluate false for every row,
  // forever, and "upgrading" this guard to one would refuse every upload
  // permanently while looking like a hardening improvement. See the field's
  // own doc comment in masterJob.ts.
  if (job.youtubeVideoId) return { ok: false, reason: 'already-uploaded' };
  if (job.uploadStatus === 'uploading' || job.uploadStatus === 'queued') {
    return { ok: false, reason: 'in-flight' };
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
