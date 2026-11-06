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

/** The worker times out at 900 s; a render older than this cannot still be running. */
export const RENDER_STALE_MS = 16 * 60_000;
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
    if (isRenderInFlight(r) && now - Date.parse(r.createdAt) > RENDER_STALE_MS) {
      const moved = await repo.transitionRender(vsId, r.renderId, ['queued', 'running'], 'failed', { error: STALE_RENDER_ERROR });
      out.push(moved ?? r);
    } else {
      out.push(r);
    }
  }
  return out;
}
