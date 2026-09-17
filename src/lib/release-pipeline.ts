/**
 * Where a saved master has got to, and what to do with it next.
 *
 * WHY THIS EXISTS. The library showed a row of download links and two action
 * buttons, from which the state of a song had to be inferred: an MP3 link meant
 * it had been encoded, a Video link meant it had been rendered, and whether it
 * had reached YouTube was not shown at all. On 2026-09-16 that cost a wasted
 * 3-minute render on a song already scheduled to premiere — the row gave no
 * sign it was finished.
 *
 * ⚠️ IT DOES NOT DECIDE ELIGIBILITY. Every "can this be done" question is
 * delegated to the planner that already owns it — planRender, planShort,
 * planUpload. A second opinion here would drift from the buttons, and a status
 * line that disagrees with the control beside it is worse than no status line:
 * it teaches the operator to distrust the screen.
 *
 * Pure. No AWS, no React, no clock — `nextAction` is a function of the job.
 */

import type { MasterJob } from '@/types/masterJob';
import { planRender } from '@/lib/master-video';
import { planShort } from '@/lib/master-short';
import { planUpload } from '@/lib/youtube-upload';

export type StageId = 'master' | 'mp3' | 'video' | 'short' | 'youtube';

export interface Stage {
  id: StageId;
  /** Shown under the dot. Short enough to sit in a row. */
  label: string;
  done: boolean;
}

/** The stages in the order a song passes through them. */
export function pipelineFor(job: MasterJob): Stage[] {
  return [
    { id: 'master', label: 'master', done: Boolean(job.masterKey) },
    { id: 'mp3', label: 'mp3', done: Boolean(job.mp3Key) },
    { id: 'video', label: 'video', done: Boolean(job.videoKey) },
    { id: 'short', label: 'short', done: Boolean(job.shortKey) },
    { id: 'youtube', label: 'YouTube', done: Boolean(job.youtubeVideoId) },
  ];
}

export interface NextAction {
  /** What to do, in the operator's words. */
  label: string;
  /** Which control does it, so the line can point at something real. */
  stage: StageId | 'studio';
  /**
   * True when the next step is NOT in this portal — pinning a comment, or
   * converting to a Premiere. Saying so is the point: the panel must never
   * imply a release is finished when two Studio-only steps remain.
   */
  external?: boolean;
}

/**
 * The single next thing worth doing.
 *
 * Deliberately ONE action, not a checklist. The operator works a song at a
 * time, and a list of five possible things is the state they already had to
 * infer for themselves.
 *
 * The order follows the release, not the data model: a song needs a video
 * before it can be uploaded, and the MP3 is what the site serves, so it comes
 * first. The short is optional and never blocks — it is only suggested once the
 * release itself is done, because a clip for a song nobody can watch yet is
 * work in the wrong order.
 */
export function nextAction(job: MasterJob): NextAction | null {
  if (job.status !== 'done' || !job.masterKey) {
    return { label: 'Finish mastering this take', stage: 'master' };
  }
  if (!job.savedAt) {
    return { label: 'Save this master — unsaved jobs expire in 24 hours', stage: 'master' };
  }
  if (!job.mp3Key) {
    return { label: 'Encode the web MP3', stage: 'mp3' };
  }

  // Delegated, so the line and the button cannot disagree.
  const render = planRender(job, job.coverKey, 1440);
  if (!job.videoKey) {
    return render.ok
      ? { label: 'Render the video', stage: 'video' }
      : { label: 'Add a cover image, then render the video', stage: 'video' };
  }

  const upload = planUpload(job, { title: job.title ?? 'x', description: '', tags: [], playlistIds: [] });
  if (!job.youtubeVideoId) {
    return upload.ok
      ? { label: 'Upload to YouTube', stage: 'youtube' }
      : { label: 'Upload to YouTube — add a title first', stage: 'youtube' };
  }

  // On YouTube. The short is the remaining portal-side job; after that the only
  // steps left are ones no API can perform.
  if (!job.shortKey) {
    const short = planShort(job, job.coverKey);
    return short.ok
      ? { label: 'Make a vertical short for Reels', stage: 'short' }
      : { label: 'Add a cover image to make a vertical short', stage: 'short' };
  }

  return { label: 'Pin the comment in YouTube Studio', stage: 'studio', external: true };
}

/**
 * One-line summary of how far along a song is, for a row that is collapsed.
 * Counts only the stages that are done — the dots carry the detail.
 */
export function pipelineSummary(job: MasterJob): string {
  const stages = pipelineFor(job);
  const done = stages.filter((s) => s.done).length;
  return `${done} of ${stages.length}`;
}
