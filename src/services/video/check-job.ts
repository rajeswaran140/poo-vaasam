/**
 * Storyboard check as a background job — the draft job's pattern
 * (storyboard-job.ts), because a check of a long story can outrun Amplify's
 * ~30 s ceiling. The route reserves, writes CHECK#<checkId> 'queued' and
 * invokes the compose worker with the WHOLE storyboard in the event (the
 * worker's role cannot Query); the worker calls Claude and moves the row
 * running → done|failed; the panel polls GET .../check/[checkId].
 *
 * MONEY — exactly one settle per reservation: the worker and the sweep both
 * finish with a conditional transition and settle only if theirs won.
 *
 * PRIVACY: lyrics, when pasted, reach the model only — never stored (the row
 * keeps `withLyrics`), never logged.
 *
 * Bundled into worker/compose-worker.ts by esbuild: keep Next.js out of here.
 */

import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { checkStoryboard, type CheckResult } from '@/services/ai/storyboard-checker';
import { draftCostUsd } from '@/services/video/cost';
import { settleQuietly } from '@/services/video/storyboard-job';
import type { CheckInput } from '@/lib/visual-story-check';
import { ASPECT_RATIOS, isCheckId, isVsId, type StoryCheck } from '@/types/visualStory';

/**
 * ~4 000 output tokens at ~50/s is under two minutes. ⚠️ ORDER MATTERS: this <
 * the compose-worker Lambda's timeout (720 s) < CHECK_STALE_MS.
 */
export const WORKER_CHECK_TIMEOUT_MS = 300_000;
/** A check not finished after this long cannot still be running on the worker. */
export const CHECK_STALE_MS = 15 * 60_000;
export const STALE_CHECK_ERROR = 'The check took too long. Please try again.';
/** Async Lambda invokes take 256 KB; the route refuses an event above this. */
export const MAX_CHECK_EVENT_BYTES = 200_000;

const UPSTREAM_ERROR = 'The AI service failed to respond. Please try again.';
const BAD_REQUEST_ERROR = 'The check request was incomplete. Please try again.';

export interface CheckJobEvent {
  kind: 'story-check';
  checkId: string;
  vsId: string;
  input: CheckInput;
  /** Absent ⇒ no lyrics pasted. */
  lyrics?: string;
}

type Repo = Pick<VisualStoryRepository, 'transitionCheck' | 'settle'>;
type SweepRepo = Pick<VisualStoryRepository, 'transitionCheck' | 'getCheck' | 'settle'>;

const errName = (e: unknown) => (e instanceof Error ? e.name : 'error');
const isStr = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
const isInt = (v: unknown) => Number.isInteger(v);

export function billedUsdFor(result: CheckResult): number {
  return result.usage ? draftCostUsd(result.usage.inputTokens, result.usage.outputTokens) : 0;
}

/** The worker re-checks the event's shape: it is the last stop before a paid call. */
export function checkPayloadOk(e: CheckJobEvent): boolean {
  const i = e.input;
  if (!i || typeof i !== 'object') return false;
  if (!(ASPECT_RATIOS as readonly string[]).includes(i.aspectRatio) || !isInt(i.windowSec)) return false;
  if (!isStr(i.style, 300) || (e.lyrics !== undefined && !isStr(e.lyrics, 8000))) return false;
  if (!Array.isArray(i.characters) || !i.characters.every((c) => isStr(c?.name, 60) && isStr(c?.description, 1000))) return false;
  if (!Array.isArray(i.scenes) || i.scenes.length === 0) return false;
  return i.scenes.every(
    (sc) =>
      isInt(sc?.order) &&
      isStr(sc.heading, 120) &&
      isStr(sc.summary, 600) &&
      Array.isArray(sc.shots) &&
      sc.shots.every(
        (s) =>
          isInt(s?.shotOrder) &&
          typeof s.startSec === 'number' &&
          typeof s.durationSec === 'number' && Number.isFinite(s.durationSec) && s.durationSec > 0 &&
          isStr(s.mode, 10) &&
          isStr(s.visualPrompt, 2000) &&
          Array.isArray(s.characters) &&
          s.characters.every((n) => isStr(n, 60))
      )
  );
}

type Finish =
  | { to: 'done'; fields: Pick<StoryCheck, 'summary' | 'issues' | 'costUsd'> }
  | { to: 'failed'; fields: { code: string; error: string; costUsd?: number } };

/** Run one check on the worker. Never throws once the row is claimed. */
export async function runCheckJob(
  event: CheckJobEvent,
  opts: { timeoutMs?: number; repo?: Repo } = {}
): Promise<{ ok: boolean; status: string }> {
  const { vsId, checkId } = event ?? ({} as CheckJobEvent);
  if (!isVsId(vsId) || !isCheckId(checkId)) {
    console.error('[check-job] bad event', JSON.stringify({ vsIdOk: isVsId(vsId), checkIdOk: isCheckId(checkId) }));
    return { ok: false, status: 'bad-event' };
  }
  const repo: Repo = opts.repo ?? new VisualStoryRepository();

  let check: StoryCheck | null;
  try {
    check = await repo.transitionCheck(vsId, checkId, ['queued'], 'running');
  } catch (err) {
    console.error('[check-job] claim failed', errName(err));
    return { ok: false, status: 'claim-failed' };
  }
  if (!check) {
    console.info('[check-job] check not queued, skipping', JSON.stringify({ checkId }));
    return { ok: true, status: 'skipped' };
  }

  let billedUsd = 0;
  let finish: Finish;
  if (!checkPayloadOk(event)) {
    finish = { to: 'failed', fields: { code: 'bad_request', error: BAD_REQUEST_ERROR } };
  } else {
    let result: CheckResult;
    try {
      result = await checkStoryboard(event.input, {
        ...(event.lyrics ? { lyrics: event.lyrics } : {}),
        timeoutMs: opts.timeoutMs ?? WORKER_CHECK_TIMEOUT_MS,
      });
    } catch (err) {
      console.error('[check-job] checker threw', errName(err));
      result = { ok: false, code: 'upstream', error: UPSTREAM_ERROR };
    }
    billedUsd = billedUsdFor(result);
    finish = result.ok
      ? { to: 'done', fields: { summary: result.summary, issues: result.issues, costUsd: billedUsd } }
      : { to: 'failed', fields: { code: result.code, error: result.error, costUsd: billedUsd } };
  }

  let moved: StoryCheck | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      moved = await repo.transitionCheck(vsId, checkId, ['running'], finish.to, finish.fields);
      break;
    } catch (err) {
      console.error('[check-job] finish transition failed', errName(err));
    }
  }
  if (!moved) {
    console.info('[check-job] check no longer running; not settling', JSON.stringify({ checkId }));
    return { ok: true, status: 'lost' };
  }
  await settleQuietly(repo, vsId, check.reservedUsd, billedUsd, 'check-job');
  console.info('[check-job] complete', JSON.stringify({ checkId, status: finish.to, billedUsd }));
  return { ok: true, status: finish.to };
}

/** Fail-and-release a check the worker never finished. Returns the check as it now stands. */
export async function sweepStaleCheck(
  repo: SweepRepo,
  vsId: string,
  check: StoryCheck,
  now: number = Date.now()
): Promise<StoryCheck> {
  if (check.status !== 'queued' && check.status !== 'running') return check;
  if (!(now - Date.parse(check.createdAt) > CHECK_STALE_MS)) return check;
  const moved = await repo.transitionCheck(vsId, check.checkId, ['queued', 'running'], 'failed', {
    code: 'timeout',
    error: STALE_CHECK_ERROR,
  });
  if (!moved) return (await repo.getCheck(vsId, check.checkId)) ?? check;
  await settleQuietly(repo, vsId, moved.reservedUsd, 0, 'check sweep');
  return moved;
}

/**
 * Sweep a story's checks; returns them as they now stand. Throws on a read
 * failure, so a guard built on it (delete, one check at a time) fails closed.
 */
export async function sweepStaleChecks(
  repo: SweepRepo & Pick<VisualStoryRepository, 'listChecks'>,
  vsId: string,
  now: number = Date.now()
): Promise<StoryCheck[]> {
  const out: StoryCheck[] = [];
  for (const c of await repo.listChecks(vsId)) out.push(await sweepStaleCheck(repo, vsId, c, now));
  return out;
}

export const isCheckInFlight = (c: StoryCheck) => c.status === 'queued' || c.status === 'running';
