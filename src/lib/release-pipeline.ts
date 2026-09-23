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
import { planUpload, uploadRefusalMessage, type UploadRefusal } from '@/lib/youtube-upload';
import { isPeakMaster, KARAOKE_MP3_BITRATE } from '@/lib/master-peak';

export type StageId = 'master' | 'mp3' | 'video' | 'short' | 'youtube';

export interface Stage {
  id: StageId;
  /** Shown under the dot. Short enough to sit in a row. */
  label: string;
  done: boolean;
}

/**
 * The stages in the order a song passes through them.
 *
 * A KARAOKE BED HAS TWO, not five. It is sold to one buyer, never rendered,
 * never uploaded — so three stages it can never reach would leave every bed
 * reading "2 of 5" forever, which is a progress bar that measures nothing. Two
 * honest stages beat five where three are unreachable.
 */
export function pipelineFor(job: MasterJob): Stage[] {
  if (isPeakMaster(job)) {
    return [
      { id: 'master', label: 'bed', done: Boolean(job.masterKey) },
      { id: 'mp3', label: `mp3 ${KARAOKE_MP3_BITRATE}`, done: Boolean(job.mp3Key) },
    ];
  }
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
   * True when the next step is NOT on this panel — pinning a comment or
   * converting to a Premiere (YouTube Studio), or creating a delivery link
   * (Library → Delivery links). Saying so is the point: the panel must never
   * imply a job is finished when a step it cannot perform remains.
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
/**
 * The next thing for a karaoke bed, which is a different job entirely.
 *
 * It ends at a delivery link, not at YouTube: nothing about a bed is released.
 * Without this the pipeline delegated to `planRender`, which now refuses a bed,
 * and the row read "Add a cover image, then render the video" — advice that
 * would waste an operator's time on a file that must never be rendered.
 */
function bedNextAction(job: MasterJob): NextAction {
  if (job.status !== 'done' || !job.masterKey) {
    return { label: 'Finish this karaoke bed', stage: 'master' };
  }
  if (!job.savedAt) {
    return { label: 'Save this bed — unsaved jobs expire in 24 hours', stage: 'master' };
  }
  if (!job.mp3Key) {
    return { label: `Encode the ${KARAOKE_MP3_BITRATE} MP3 the buyer receives`, stage: 'mp3' };
  }
  return {
    label: 'Create a delivery link — Library → Delivery links',
    stage: 'studio',
    external: true,
  };
}

/**
 * A job-level reason the upload cannot proceed, as a next action.
 *
 * ⚠️ THE STAGE IS NOT ALWAYS 'youtube'. An audio mismatch is fixed by
 * RE-RENDERING, so the line points at the video control rather than at an
 * upload button that would only refuse. Pointing an operator at a control that
 * cannot help is how the short's refusal went unread for a day.
 *
 * `no-video`, `not-saved`, `no-title` and `no-description` cannot reach here —
 * the first two are refused earlier in nextAction and the last two are stubbed
 * at the call site. The default branch exists so that a refusal added to
 * planUpload later surfaces its own message rather than silently inheriting
 * someone else's.
 */
function uploadBlocked(reason: UploadRefusal): NextAction {
  switch (reason) {
    case 'audio-mismatch':
      return { label: 'Re-render the video — its audio does not match the master', stage: 'video' };
    case 'in-flight':
      return { label: 'An upload is already running for this master', stage: 'youtube' };
    default:
      return { label: `Upload to YouTube — ${uploadRefusalMessage(reason)}`, stage: 'youtube' };
  }
}

export function nextAction(job: MasterJob): NextAction | null {
  if (isPeakMaster(job)) return bedNextAction(job);

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

  // ⚠️ THE TITLE AND DESCRIPTION ARE STUBBED HERE, DELIBERATELY. Neither is
  // stored on the job — both are typed in the upload panel — so their absence is
  // not a property of the JOB and must not be reported as its next action.
  //
  // What was here refused on every job and named the wrong reason for it. The
  // empty `description` meant `planUpload` always returned `no-description`, so
  // this line always took its fallback branch; and `title: job.title ?? 'x'`
  // meant `no-title` could never fire, so the fallback's "add a title first"
  // was a reason the call could not produce. The line therefore never named
  // anything true.
  //
  // That became actively misleading when `planUpload` gained `audio-mismatch`
  // on 2026-09-22: a video whose audio does not match its master was announced
  // as a missing title. Exactly the drift the header warns about — a status line
  // disagreeing with the control beside it.
  const upload = planUpload(job, {
    title: job.title?.trim() || 'untitled',
    description: 'pending',
    tags: [],
    playlistIds: [],
  });
  if (!job.youtubeVideoId) {
    if (!upload.ok) return uploadBlocked(upload.reason);
    // Asked of the JOB, not of the planner, because the planner was handed a
    // stub. This is the one upload-panel field the job can actually answer for.
    return job.title?.trim()
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
