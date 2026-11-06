/**
 * Visual Story Studio — what a render needs before it is queued, and how a
 * render that never finished is cleared (Phase 6, spec §7.4). Server-side.
 *
 * The route turns the story's tree into the exact shot list the worker will
 * render (the worker cannot Query), refusing anything it would fail on — a
 * shot with nothing chosen, shots that do not fill the window, a render too
 * long for the worker — in words that say what to change.
 */

import type { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import {
  estimateAssembleSec,
  isAssemblyShotKey,
  MAX_ASSEMBLE_SEC,
  shotLabel,
  type AssemblyShot,
} from '@/lib/visual-story-assemble';
import type { Candidate, RenderJob, Shot, VisualStory } from '@/types/visualStory';

/**
 * When a render can no longer be running. ⚠️ TWO CLOCKS: the worker's event
 * can wait in Lambda's async queue (reserved concurrency 3, shared with
 * mastering) before it starts, so a RUNNING render is timed from its claim
 * (`updatedAt`) — the worker dies at 900 s — and a QUEUED one from creation.
 * The worker refuses to start an event older than RENDER_MAX_QUEUE_MS, so a
 * render the sweep fails while queued can never start afterwards.
 */
export const RENDER_RUNNING_STALE_MS = 16 * 60_000;
export const RENDER_QUEUED_STALE_MS = 30 * 60_000;
export const RENDER_MAX_QUEUE_MS = 25 * 60_000;
export const STALE_RENDER_ERROR = 'The render took too long. Please try again.';

export type RenderPlan =
  | { ok: true; shots: AssemblyShot[]; estimateSec: number }
  | { ok: false; message: string };

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

export function planStoryRender(tree: {
  story: Pick<VisualStory, 'vsId' | 'windowStartSec' | 'windowEndSec'>;
  shots: Shot[];
  candidates: Candidate[];
}): RenderPlan {
  const { story, shots, candidates } = tree;
  if (shots.length === 0) return { ok: false, message: 'Add shots before rendering.' };

  const out: AssemblyShot[] = [];
  for (const shot of shots) {
    const label = shotLabel(shot);
    const cand = shot.selectedCandidateId ? candidates.find((c) => c.candId === shot.selectedCandidateId) : undefined;
    if (!cand) return { ok: false, message: `${label} has no picture or clip chosen yet.` };
    if (!isAssemblyShotKey(cand.s3Key, story.vsId)) {
      return { ok: false, message: `${label}: that file cannot be used in the video. Choose another picture or clip.` };
    }
    out.push({ sceneOrder: shot.sceneOrder, shotOrder: shot.shotOrder, key: cand.s3Key, durationSec: shot.durationSec });
  }

  const windowSec = story.windowEndSec - story.windowStartSec;
  const total = out.reduce((n, s) => n + s.durationSec, 0);
  if (total !== windowSec) {
    return {
      ok: false,
      message: `The shots add up to ${mmss(total)}, but the story covers ${mmss(windowSec)} of the song. ` +
        (total < windowSec ? 'Lengthen or add shots.' : 'Shorten or remove shots.'),
    };
  }

  const estimateSec = estimateAssembleSec(out);
  if (estimateSec > MAX_ASSEMBLE_SEC) {
    return {
      ok: false,
      message: `This would take about ${Math.ceil(estimateSec / 60)} minutes to render — longer than the worker allows. ` +
        'Use fewer, longer shots, or clips in place of some pictures (a picture is slower to render than a clip).',
    };
  }
  return { ok: true, shots: out, estimateSec };
}

export const isRenderInFlight = (r: Pick<RenderJob, 'status'>) => r.status === 'queued' || r.status === 'running';

/**
 * Fail a render the worker can no longer be running (crash, timeout, lost
 * invoke). Conditional, so a worker that finishes late does not get its result
 * overwritten, and a late worker's own transition then fails harmlessly.
 * Returns the list with any swept render updated.
 */
export async function sweepStaleRenders(
  repo: Pick<VisualStoryRepository, 'transitionRender'>,
  vsId: string,
  renders: RenderJob[],
  now: number = Date.now()
): Promise<RenderJob[]> {
  const out: RenderJob[] = [];
  for (const r of renders) {
    const stale =
      (r.status === 'running' && now - Date.parse(r.updatedAt) > RENDER_RUNNING_STALE_MS) ||
      (r.status === 'queued' && now - Date.parse(r.createdAt) > RENDER_QUEUED_STALE_MS);
    if (stale) {
      // Only from the status it was judged in: a queued render the worker has
      // just claimed is running now, on the other clock, and must not be failed.
      const moved = await repo.transitionRender(vsId, r.renderId, [r.status], 'failed', { error: STALE_RENDER_ERROR });
      out.push(moved ?? r);
    } else {
      out.push(r);
    }
  }
  return out;
}
