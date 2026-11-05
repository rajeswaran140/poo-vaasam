/**
 * Video generation jobs (`GENJOB#<jobId>`) — the parts shared by the make-video
 * route, the job route and the reconciler.
 *
 * Keep Next.js out of here: the reconciler may bundle this module.
 */

import { S3Operations } from '@/infrastructure/storage/s3-client';
// Type-only: the repository value-imports VIDEO_STALE_MS from here.
import type { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { candidateKey } from '@/lib/visual-story-storage';
import { candIdForJob } from '@/types/visualStory';
import type { Candidate, Character, GenJob, GenJobStatus, Shot, VisualStory } from '@/types/visualStory';
import type { PollResult, VideoGenerationProvider, VideoGenRequest } from '@/services/video/providers/types';

/** xAI accepts at most this many `reference_images`. */
export const MAX_REFERENCE_IMAGES = 14;
/** A video job (and its per-shot VIDLOCK#) not finished after this long is ended / taken over (Rulings V4, V5). */
export const VIDEO_STALE_MS = 60 * 60_000;
/** Signed URLs handed to xAI live this long. */
export const SIGNED_URL_TTL_SEC = 3600;
/** A finished clip that fails to copy this many times is ended (billed: Grok charged for it). */
export const VIDEO_COPY_MAX_FAILURES = 10;
/** Timeout for fetching a finished clip from Grok before copying it to S3. */
export const VIDEO_COPY_TIMEOUT_MS = 25_000;

export const COPY_FAILED_ERROR = "The clip was made but couldn't be saved; it was still charged.";
export const STALE_VIDEO_ERROR = "Grok didn't finish this clip within an hour; it may still have been charged.";
const NO_CLIP_ERROR = 'Grok finished but returned no clip; it was still charged.';

/** The parts of `loadTree` a video request needs. */
export interface VideoRequestTree {
  story: Pick<VisualStory, 'aspectRatio'>;
  characters: Character[];
  candidates: Candidate[];
}

/**
 * The provider request for one shot: the shot's prompt plus its cast
 * ("Name: description", tagged with the `<IMAGE_n>` references that show
 * them), the pinned first-frame STILL and the cast's reference photos — all
 * as short-lived signed URLs. Never carries an abort signal (R10).
 */
export async function buildVideoRequest(tree: VideoRequestTree, shot: Shot): Promise<VideoGenRequest> {
  const cast = shot.charIds
    .map((id) => tree.characters.find((c) => c.charId === id))
    .filter((c): c is Character => !!c);

  // Cap before signing, so the <IMAGE_n> indices match the URLs sent.
  const refKeys: string[] = [];
  const castLines = cast.map((c) => {
    const tags: string[] = [];
    for (const key of c.refImageKeys ?? []) {
      if (refKeys.length >= MAX_REFERENCE_IMAGES) break;
      tags.push(`<IMAGE_${refKeys.length}>`);
      refKeys.push(key);
    }
    const desc = c.description.trim();
    const line = desc ? `${c.name}: ${desc}` : c.name;
    return tags.length ? `${line} (shown in ${tags.join(', ')})` : line;
  });

  const prompt = castLines.length
    ? `${shot.visualPrompt}\n\nCharacters in this shot:\n${castLines.join('\n')}`
    : shot.visualPrompt;

  const firstFrame = shot.firstFrameCandidateId
    ? tree.candidates.find(
        (c) =>
          c.candId === shot.firstFrameCandidateId &&
          c.sceneOrder === shot.sceneOrder &&
          c.shotOrder === shot.shotOrder &&
          c.mode === 'STILL'
      )
    : undefined;

  const sign = (key: string) => S3Operations.getSignedUrl(key, SIGNED_URL_TTL_SEC);
  const [firstFrameUrl, referenceImageUrls] = await Promise.all([
    firstFrame ? sign(firstFrame.s3Key) : Promise.resolve(undefined),
    Promise.all(refKeys.map(sign)),
  ]);

  return {
    prompt,
    mode: 'HERO',
    durationSec: shot.durationSec,
    aspectRatio: tree.story.aspectRatio,
    ...(firstFrameUrl ? { firstFrameUrl } : {}),
    ...(referenceImageUrls.length ? { referenceImageUrls } : {}),
  };
}

// ---------------------------------------------------------------------------
// Advancing and cancelling a job (poll → copy → settle, exactly once)
// ---------------------------------------------------------------------------

export type GenJobRepo = Pick<
  VisualStoryRepository,
  'transitionGenJob' | 'touchGenJob' | 'putCandidate' | 'releaseShotVideo' | 'getGenJob' | 'settle'
>;

export interface AdvanceDeps {
  fetchImpl?: typeof fetch;
  /** Epoch ms; defaults to Date.now(). */
  now?: number;
}

const errName = (e: unknown) => (e instanceof Error ? e.name : 'error');

const isTerminal = (s: GenJobStatus) => s === 'succeeded' || s === 'failed' || s === 'cancelled';

/**
 * Release the shot's VIDLOCK# and settle the reservation — called ONLY by the
 * side whose conditional terminal transition won. Separate try blocks: a
 * release failure (the lock then goes stale within the hour) never skips the
 * settle; a settle failure (e.g. the story was deleted) is logged and swallowed.
 * Local rather than storyboard-job's settleQuietly: the repository imports
 * this module, so importing storyboard-job here would close a cycle.
 */
async function finishWon(repo: GenJobRepo, vsId: string, job: GenJob, billedUsd: number): Promise<void> {
  try {
    await repo.releaseShotVideo(vsId, job.sceneOrder, job.shotOrder, job.jobId);
  } catch (err) {
    console.error('visual-story video job: release failed', job.jobId, errName(err));
  }
  try {
    await repo.settle(vsId, { reservedUsd: job.reservedUsd, billedUsd });
  } catch (err) {
    console.error('visual-story video job: settle failed', job.jobId, errName(err));
  }
}

/**
 * Conditionally end a job. Won → release + settle `billedUsd`, return the
 * ended job. Lost → settle nothing (the winner did), return the stored job.
 */
async function endJob(
  repo: GenJobRepo,
  vsId: string,
  job: GenJob,
  from: GenJobStatus[],
  to: 'succeeded' | 'failed',
  billed: boolean,
  fields?: { code: string; error: string }
): Promise<GenJob> {
  const moved = fields
    ? await repo.transitionGenJob(vsId, job.jobId, from, to, fields)
    : await repo.transitionGenJob(vsId, job.jobId, from, to);
  if (!moved) {
    console.info('visual-story video job: transition lost; not settling', job.jobId, to);
    return (await repo.getGenJob(vsId, job.jobId)) ?? job;
  }
  await finishWon(repo, vsId, moved, billed ? moved.reservedUsd : 0);
  return moved;
}

/** Fetch the finished clip (25 s timeout, never the client's signal), upload it, record the candidate. */
async function copyClip(
  repo: GenJobRepo,
  vsId: string,
  job: GenJob,
  url: string,
  fetchImpl: typeof fetch
): Promise<void> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(VIDEO_COPY_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`clip fetch ${res.status}`);
  const file = Buffer.from(await res.arrayBuffer());
  const candId = candIdForJob(job.jobId);
  const s3Key = candidateKey(vsId, candId, 'mp4');
  await S3Operations.uploadFile({ key: s3Key, file, contentType: 'video/mp4' });
  // Deterministic candId: a repeated copy overwrites the same object and row.
  await repo.putCandidate(vsId, {
    candId,
    sceneOrder: job.sceneOrder,
    shotOrder: job.shotOrder,
    jobId: job.jobId,
    providerId: 'grok',
    providerTaskId: job.providerTaskId,
    mode: 'HERO',
    s3Key,
    costUsd: job.reservedUsd,
    createdAt: new Date().toISOString(),
  });
}

/**
 * Advance a video job by one step and return it as it now stands.
 *
 * - Terminal → returned as is (after an idempotent, jobId-guarded lock release).
 * - `running` → poll Grok once:
 *   pending/running or a poll error → touch (attempts +1);
 *   succeeded → copy the clip to private storage, THEN running → succeeded,
 *   settled billed (the reservation); a failed copy → touch with copyFailed
 *   and stay running (never stale-ended: the clip exists), and the
 *   VIDEO_COPY_MAX_FAILURES-th → failed, settled billed;
 *   failed → failed, settled billed or not per Grok's `billed`.
 * - Still non-terminal VIDEO_STALE_MS after createdAt (Ruling V4) → failed,
 *   settled BILLED even without a providerTaskId (V4b). A running job is
 *   polled first, so a clip that finishes late is still saved.
 *
 * MONEY: only the side whose conditional transition wins settles and releases
 * the shot's VIDLOCK# (V5). Never receives the client's abort signal.
 */
export async function advanceGenJob(
  repo: GenJobRepo,
  provider: VideoGenerationProvider,
  vsId: string,
  job: GenJob,
  deps: AdvanceDeps = {}
): Promise<GenJob> {
  if (isTerminal(job.status)) {
    // jobId-guarded and idempotent: clears a lock left by a crash between a
    // won terminal transition and its release. Never settles.
    try {
      await repo.releaseShotVideo(vsId, job.sceneOrder, job.shotOrder, job.jobId);
    } catch (err) {
      console.error('visual-story video job: release failed', job.jobId, errName(err));
    }
    return job;
  }
  const now = deps.now ?? Date.now();
  const fetchImpl = deps.fetchImpl ?? fetch;

  let current = job;
  if (job.status === 'running' && job.providerTaskId) {
    let poll: PollResult;
    try {
      poll = await provider.poll(job.providerTaskId);
    } catch (err) {
      console.error('visual-story video job: poll threw', job.jobId, errName(err));
      poll = { ok: false, code: 'upstream', error: 'poll threw' };
    }
    const polledAt = new Date(now).toISOString();

    if (poll.ok && poll.state === 'succeeded') {
      const video = poll.assets.find((a) => a.kind === 'video');
      if (!video) {
        return endJob(repo, vsId, job, ['running'], 'failed', true, { code: 'bad_response', error: NO_CLIP_ERROR });
      }
      let copied = false;
      try {
        await copyClip(repo, vsId, job, video.url, fetchImpl);
        copied = true;
      } catch (err) {
        console.error('visual-story video job: clip copy failed', job.jobId, errName(err));
      }
      if (copied) return endJob(repo, vsId, job, ['running'], 'succeeded', true);

      await repo.touchGenJob(vsId, job.jobId, { copyFailed: true });
      current = { ...job, attempts: job.attempts + 1, copyFailures: job.copyFailures + 1, lastPolledAt: polledAt };
      if (current.copyFailures >= VIDEO_COPY_MAX_FAILURES) {
        return endJob(repo, vsId, current, ['running'], 'failed', true, { code: 'upstream', error: COPY_FAILED_ERROR });
      }
      // Grok finished the clip: keep retrying the copy, even past the hour —
      // VIDEO_COPY_MAX_FAILURES bounds this path, not the stale end.
      return current;
    } else if (poll.ok && poll.state === 'failed') {
      return endJob(repo, vsId, job, ['running'], 'failed', poll.billed, { code: poll.code, error: poll.error });
    } else {
      // pending | running | a poll error (network, auth, 404): record the poll only.
      await repo.touchGenJob(vsId, job.jobId);
      current = { ...job, attempts: job.attempts + 1, lastPolledAt: polledAt };
    }
  }

  const age = now - Date.parse(current.createdAt);
  if (age > VIDEO_STALE_MS) {
    return endJob(repo, vsId, current, ['submitted', 'running'], 'failed', true, {
      code: 'upstream',
      error: STALE_VIDEO_ERROR,
    });
  }
  return current;
}

/**
 * Cancel a submitted|running job. Returns the cancelled job, or null when it
 * had already finished. The winner releases the shot and settles BILLED in
 * both states (Ruling V6): a running task may still finish and charge, and a
 * submitted job's submit may be in flight — Grok can accept it after this
 * cancel, and the make-video route's lost transition then settles nothing.
 * Over-record, never under-record (as V4b).
 */
export async function cancelGenJob(repo: GenJobRepo, vsId: string, job: GenJob): Promise<GenJob | null> {
  const moved = await repo.transitionGenJob(vsId, job.jobId, ['submitted', 'running'], 'cancelled');
  if (!moved) return null;
  await finishWon(repo, vsId, moved, moved.reservedUsd);
  return moved;
}
