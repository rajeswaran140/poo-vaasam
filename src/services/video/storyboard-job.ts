/**
 * Storyboard draft as a background job (R14, owner decision 2026-11-04).
 *
 * A full draft takes ~45-65 s (measured live), so it cannot run inside
 * Amplify's ~30 s ceiling. The draft route reserves money, writes a queued
 * `DRAFTJOB#<jobId>` item and invokes the compose worker; the worker runs
 * `runStoryboardJob`; the client polls the job route, which runs
 * `sweepStaleDraftJob` for a job that never finished.
 *
 * MONEY — exactly one settle per reservation. Both the worker and the sweep
 * finish a job with a CONDITIONAL transition (running → done|failed, or
 * queued|running → failed) and settle only if their transition won. Billed =
 * the token cost whenever an Anthropic response was received (ok or
 * bad_response), else 0.
 *
 * PRIVACY (spec §12): the lyrics reach the model only. They are never stored
 * (the draft keeps a SHA-256), never written to the job item, never logged —
 * logs carry error names only.
 *
 * Bundled into worker/compose-worker.ts by esbuild: keep Next.js out of here.
 */

import { createHash } from 'crypto';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { generateStoryboard, DEFAULT_MODEL, type StoryboardResult } from '@/services/ai/storyboarder';
import { draftCostUsd } from '@/services/video/cost';
import {
  ASPECT_RATIOS,
  MAX_WINDOW_SEC,
  MIN_WINDOW_SEC,
  isDraftJobId,
  isVsId,
  newId,
  type AspectRatio,
  type DraftJob,
  type StoryboardDraft,
} from '@/types/visualStory';

/** The worker's per-call Anthropic timeout (the worker Lambda must allow more than this). */
export const WORKER_DRAFT_TIMEOUT_MS = 150_000;
/** A job not finished after this long cannot still be running on the worker. */
export const DRAFT_JOB_STALE_MS = 10 * 60_000;
export const STALE_DRAFT_ERROR = 'The draft took too long. Please try again.';

const UPSTREAM_ERROR = 'The AI service failed to respond. Please try again.';
const SAVE_ERROR = 'The draft was made but could not be saved. Please try again.';
const BAD_REQUEST_ERROR = 'The draft request was incomplete. Please try again.';

export interface StoryboardJobEvent {
  kind: 'storyboard';
  jobId: string;
  vsId: string;
  lyrics: string;
  windowSec: number;
  aspectRatio: AspectRatio;
}

type Repo = Pick<VisualStoryRepository, 'transitionDraftJob' | 'getDraftJob' | 'putDraft' | 'settle'>;

const errName = (e: unknown) => (e instanceof Error ? e.name : 'error');

/** Tokens were billed whenever a response arrived — success or an unusable one. */
export function billedUsdFor(result: StoryboardResult): number {
  const usage = result.usage;
  return usage ? draftCostUsd(usage.inputTokens, usage.outputTokens) : 0;
}

/** The persisted draft: the lyrics' hash, never the lyrics. */
export function buildDraft(lyrics: string, result: Extract<StoryboardResult, { ok: true }>): StoryboardDraft {
  const { inputTokens, outputTokens } = result.usage;
  return {
    draftId: newId('dr'),
    lyricsHash: createHash('sha256').update(lyrics).digest('hex'),
    model: DEFAULT_MODEL,
    inputTokens,
    outputTokens,
    costUsd: draftCostUsd(inputTokens, outputTokens),
    characters: result.data.characters,
    scenes: result.data.scenes,
    createdAt: new Date().toISOString(),
  };
}

/** Settle, logging (name only) and swallowing any failure — e.g. the story was deleted mid-call. */
export async function settleQuietly(
  repo: Pick<VisualStoryRepository, 'settle'>,
  vsId: string,
  reservedUsd: number,
  billedUsd: number,
  tag: string
): Promise<void> {
  try {
    await repo.settle(vsId, { reservedUsd, billedUsd });
  } catch (err) {
    console.error(`visual-story ${tag}: settle failed`, errName(err));
  }
}

function payloadOk(e: StoryboardJobEvent): boolean {
  return (
    typeof e.lyrics === 'string' &&
    e.lyrics.trim() !== '' &&
    Number.isInteger(e.windowSec) &&
    e.windowSec >= MIN_WINDOW_SEC &&
    e.windowSec <= MAX_WINDOW_SEC &&
    (ASPECT_RATIOS as readonly string[]).includes(e.aspectRatio)
  );
}

type Finish = { to: 'done'; fields: { draftId: string } } | { to: 'failed'; fields: { code: string; error: string } };

/**
 * Run one draft job on the worker. Never throws: an exception after the job is
 * claimed would leave it `running` with no one to finish it but the sweep.
 */
export async function runStoryboardJob(
  event: StoryboardJobEvent,
  opts: { timeoutMs?: number; repo?: Repo } = {}
): Promise<{ ok: boolean; status: string }> {
  const { vsId, jobId } = event ?? ({} as StoryboardJobEvent);
  if (!isVsId(vsId) || !isDraftJobId(jobId)) {
    console.error('[storyboard-job] bad event', JSON.stringify({ vsIdOk: isVsId(vsId), jobIdOk: isDraftJobId(jobId) }));
    return { ok: false, status: 'bad-event' };
  }
  const repo: Repo = opts.repo ?? new VisualStoryRepository();

  let job: DraftJob | null;
  try {
    job = await repo.transitionDraftJob(vsId, jobId, ['queued'], 'running');
  } catch (err) {
    console.error('[storyboard-job] claim failed', errName(err));
    return { ok: false, status: 'claim-failed' };
  }
  if (!job) {
    console.info('[storyboard-job] job not queued, skipping', JSON.stringify({ jobId }));
    return { ok: true, status: 'skipped' };
  }

  let billedUsd = 0;
  let finish: Finish;
  if (!payloadOk(event)) {
    finish = { to: 'failed', fields: { code: 'bad_request', error: BAD_REQUEST_ERROR } };
  } else {
    let result: StoryboardResult;
    try {
      result = await generateStoryboard(
        { lyrics: event.lyrics, windowSec: event.windowSec, aspectRatio: event.aspectRatio },
        { timeoutMs: opts.timeoutMs ?? WORKER_DRAFT_TIMEOUT_MS }
      );
    } catch (err) {
      console.error('[storyboard-job] generator threw', errName(err));
      result = { ok: false, code: 'upstream', error: UPSTREAM_ERROR };
    }
    billedUsd = billedUsdFor(result); // recorded before anything else can fail
    if (!result.ok) {
      finish = { to: 'failed', fields: { code: result.code, error: result.error } };
    } else {
      try {
        const draft = buildDraft(event.lyrics, result);
        await repo.putDraft(vsId, draft);
        finish = { to: 'done', fields: { draftId: draft.draftId } };
      } catch (err) {
        console.error('[storyboard-job] putDraft failed', errName(err));
        finish = { to: 'failed', fields: { code: 'storage', error: SAVE_ERROR } };
      }
    }
  }

  // Final conditional transition; one retry on a storage error. Only a win settles.
  let moved: DraftJob | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      moved = await repo.transitionDraftJob(vsId, jobId, ['running'], finish.to, finish.fields);
      break;
    } catch (err) {
      console.error('[storyboard-job] finish transition failed', errName(err));
    }
  }
  if (!moved) {
    console.info('[storyboard-job] job no longer running; not settling', JSON.stringify({ jobId }));
    return { ok: true, status: 'lost' };
  }
  await settleQuietly(repo, vsId, job.reservedUsd, billedUsd, 'storyboard-job');
  console.info('[storyboard-job] complete', JSON.stringify({ jobId, status: finish.to, billedUsd }));
  return { ok: true, status: finish.to };
}

/**
 * Fail-and-release a job the worker never finished (crash, Lambda timeout,
 * lost invoke). Runs on every poll; acts only on a queued|running job older
 * than DRAFT_JOB_STALE_MS. The worker Lambda's timeout is far below that, so
 * such a job cannot still be running. Returns the job as it now stands.
 */
export async function sweepStaleDraftJob(
  repo: Repo,
  vsId: string,
  job: DraftJob,
  now: number = Date.now()
): Promise<DraftJob> {
  if (job.status !== 'queued' && job.status !== 'running') return job;
  const age = now - Date.parse(job.createdAt);
  if (!(age > DRAFT_JOB_STALE_MS)) return job;

  const moved = await repo.transitionDraftJob(vsId, job.jobId, ['queued', 'running'], 'failed', {
    code: 'timeout',
    error: STALE_DRAFT_ERROR,
  });
  if (!moved) return (await repo.getDraftJob(vsId, job.jobId)) ?? job;
  await settleQuietly(repo, vsId, moved.reservedUsd, 0, 'draft sweep');
  return moved;
}
