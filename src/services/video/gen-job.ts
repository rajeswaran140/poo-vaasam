/**
 * Video generation jobs (`GENJOB#<jobId>`) — the parts shared by the make-video
 * route, the job route and the reconciler.
 *
 * Keep Next.js out of here: the reconciler may bundle this module.
 */

import { S3Operations } from '@/infrastructure/storage/s3-client';
import { withStyle } from '@/lib/visual-story-style';
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
/**
 * One advance (poll + clip fetch + S3 upload) must finish inside this many ms
 * of its start, so a single GET fits the platform's request ceiling. The poll
 * keeps the provider's own 20 s timeout; the copy gets what is left.
 */
export const VIDEO_ADVANCE_DEADLINE_MS = 22_000;
/** The copy always gets at least this long, even after a slow poll. */
export const VIDEO_COPY_MIN_MS = 3_000;

/** The copy's budget after a poll that took `pollMs`. */
export const copyBudgetMs = (pollMs: number): number =>
  Math.max(VIDEO_COPY_MIN_MS, VIDEO_ADVANCE_DEADLINE_MS - Math.max(0, pollMs));

export const COPY_FAILED_ERROR = "The clip was made but couldn't be saved; it was still charged.";
export const STALE_VIDEO_ERROR = "Grok didn't finish this clip within an hour; it may still have been charged.";
const NO_CLIP_ERROR = 'Grok finished but returned no clip; it was still charged.';

/** The parts of `loadTree` a video request needs. */
export interface VideoRequestTree {
  /** `style` is optional only for callers built before Style existed. */
  story: Pick<VisualStory, 'aspectRatio'> & { style?: string };
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

  const prompt = withStyle(
    castLines.length ? `${shot.visualPrompt}\n\nCharacters in this shot:\n${castLines.join('\n')}` : shot.visualPrompt,
    tree.story.style
  );

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
  'transitionGenJob' | 'touchGenJob' | 'putCandidate' | 'releaseShotVideo' | 'getGenJob' | 'settleGenJob'
>;

export interface AdvanceDeps {
  fetchImpl?: typeof fetch;
  /** Epoch ms; defaults to Date.now(). Used for the job's age and lastPolledAt. */
  now?: number;
  /** Monotonic-enough clock for measuring the poll; defaults to Date.now. */
  clock?: () => number;
  /** The copy's deadline signal; defaults to AbortSignal.timeout. */
  deadlineSignal?: (ms: number) => AbortSignal;
}

const errName = (e: unknown) => (e instanceof Error ? e.name : 'error');

const isTerminal = (s: GenJobStatus) => s === 'succeeded' || s === 'failed' || s === 'cancelled';

/**
 * Settle the job's reservation (Ruling V10: atomic with the job's settledAt
 * stamp, so it can be repeated safely), THEN release the shot's VIDLOCK#.
 * Settle first: a kill after the release must not leave a free shot with an
 * unsettled reservation. Separate try blocks: a settle failure (the next
 * advance retries it) never skips the release; a release failure (the lock
 * goes stale within the hour) is logged. Returns the job, stamped settled
 * when this call settled it.
 */
async function settleAndRelease(repo: GenJobRepo, vsId: string, job: GenJob, billedUsd: number): Promise<GenJob> {
  let out = job;
  try {
    if (await repo.settleGenJob(vsId, job.jobId, { reservedUsd: job.reservedUsd, billedUsd })) {
      out = { ...job, billedUsd, settledAt: new Date().toISOString() };
    }
  } catch (err) {
    console.error('visual-story video job: settle failed', job.jobId, errName(err));
  }
  try {
    await repo.releaseShotVideo(vsId, job.sceneOrder, job.shotOrder, job.jobId);
  } catch (err) {
    console.error('visual-story video job: release failed', job.jobId, errName(err));
  }
  return out;
}

/**
 * Conditionally end a job, storing the billed amount it decided on (so a
 * settle lost to a crash can be finished later, Ruling V10). Won → settle
 * that amount + release, return the ended job. Lost → settle nothing (the
 * winner did), return the stored job.
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
  const billedUsd = billed ? job.reservedUsd : 0;
  const moved = await repo.transitionGenJob(vsId, job.jobId, from, to, { ...fields, billedUsd });
  if (!moved) {
    console.info('visual-story video job: transition lost; not settling', job.jobId, to);
    return (await repo.getGenJob(vsId, job.jobId)) ?? job;
  }
  return settleAndRelease(repo, vsId, moved, billedUsd);
}

/**
 * Fetch the finished clip, upload it, record the candidate — the fetch and
 * the upload both stop at `signal` (the advance's deadline; never the
 * client's signal).
 */
async function copyClip(
  repo: GenJobRepo,
  vsId: string,
  job: GenJob,
  url: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal
): Promise<void> {
  const res = await fetchImpl(url, { signal });
  if (!res.ok) throw new Error(`clip fetch ${res.status}`);
  const file = Buffer.from(await res.arrayBuffer());
  const candId = candIdForJob(job.jobId);
  const s3Key = candidateKey(vsId, candId, 'mp4');
  await S3Operations.uploadFile({ key: s3Key, file, contentType: 'video/mp4' }, { abortSignal: signal });
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
 * - Terminal → returned as is, after finishing what a crash may have cut
 *   short: an unsettled job (no `settledAt`) is settled with its stored
 *   `billedUsd` (Ruling V10; missing → the reservation, over-record), then the
 *   idempotent, jobId-guarded lock release.
 * - `running` → poll Grok once:
 *   pending/running or a poll error → touch (attempts +1);
 *   succeeded → record the copy attempt FIRST (touch with copyFailed: a
 *   platform kill mid-copy still counts), copy the clip to private storage
 *   within the advance's deadline (VIDEO_ADVANCE_DEADLINE_MS), THEN
 *   running → succeeded, settled billed (the reservation); a failed copy stays
 *   running (never stale-ended: the clip exists), and the
 *   VIDEO_COPY_MAX_FAILURES-th attempt → failed, settled billed;
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
    if (job.settledAt) {
      // jobId-guarded and idempotent: clears a lock left by a crash between a
      // won terminal transition and its release.
      try {
        await repo.releaseShotVideo(vsId, job.sceneOrder, job.shotOrder, job.jobId);
      } catch (err) {
        console.error('visual-story video job: release failed', job.jobId, errName(err));
      }
      return job;
    }
    // A crash between the won terminal transition and its settle: finish it.
    // settleGenJob's settledAt condition makes a concurrent repeat a no-op.
    const settled = await settleAndRelease(repo, vsId, job, job.billedUsd ?? job.reservedUsd);
    return settled.settledAt ? settled : job;
  }
  const now = deps.now ?? Date.now();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const clock = deps.clock ?? Date.now;
  const deadlineSignal = deps.deadlineSignal ?? ((ms: number) => AbortSignal.timeout(ms));

  let current = job;
  if (job.status === 'running' && job.providerTaskId) {
    const pollStart = clock();
    let poll: PollResult;
    try {
      poll = await provider.poll(job.providerTaskId);
    } catch (err) {
      console.error('visual-story video job: poll threw', job.jobId, errName(err));
      poll = { ok: false, code: 'upstream', error: 'poll threw' };
    }
    const pollMs = clock() - pollStart;
    const polledAt = new Date(now).toISOString();

    if (poll.ok && poll.state === 'succeeded') {
      const video = poll.assets.find((a) => a.kind === 'video');
      if (!video) {
        return endJob(repo, vsId, job, ['running'], 'failed', true, { code: 'bad_response', error: NO_CLIP_ERROR });
      }
      // Enough attempts already counted (e.g. ten platform kills mid-copy).
      if (job.copyFailures >= VIDEO_COPY_MAX_FAILURES) {
        return endJob(repo, vsId, job, ['running'], 'failed', true, { code: 'upstream', error: COPY_FAILED_ERROR });
      }
      // Count the attempt BEFORE copying: a kill mid-copy still counts. On a
      // successful copy the success transition makes copyFailures irrelevant.
      await repo.touchGenJob(vsId, job.jobId, { copyFailed: true });
      current = { ...job, attempts: job.attempts + 1, copyFailures: job.copyFailures + 1, lastPolledAt: polledAt };
      let copied = false;
      try {
        await copyClip(repo, vsId, job, video.url, fetchImpl, deadlineSignal(copyBudgetMs(pollMs)));
        copied = true;
      } catch (err) {
        console.error('visual-story video job: clip copy failed', job.jobId, errName(err));
      }
      if (copied) return endJob(repo, vsId, current, ['running'], 'succeeded', true);

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
  const moved = await repo.transitionGenJob(vsId, job.jobId, ['submitted', 'running'], 'cancelled', {
    billedUsd: job.reservedUsd,
  });
  if (!moved) return null;
  return settleAndRelease(repo, vsId, moved, moved.reservedUsd);
}
