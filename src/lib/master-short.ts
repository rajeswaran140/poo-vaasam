/**
 * Rendering a vertical short — a hook-first 1080×1920 clip from a saved master.
 *
 * WHY IT EXISTS. The operator composes 3-5 songs a week but publishes only 2-3
 * to YouTube, because releases stacked inside ~36h split one notification
 * budget (the QDJG post-mortem). The surplus goes to Reels and Instagram — and
 * a 5-minute 16:9 video is not something those platforms serve. This produces
 * the format they do.
 *
 * WHY HOOK-FIRST. Retention analysis on this channel shows cold viewers are
 * lost in the first ~15s, so a clip that opens on the intro is a clip nobody
 * finishes. `pickHookWindow` finds the most energetic window — the chorus in
 * practice — and the clip opens there, optionally with a short lead-in so it
 * builds into the hook rather than starting mid-phrase.
 *
 * ⚠️ NO BURNED LYRICS HERE, DELIBERATELY. `scripts/generate-song-short.ts` can
 * burn synchronised Tamil lyrics, but only via python3 + Pillow-built-with-raqm:
 * ffmpeg's drawtext does no complex-script shaping, so Tamil clusters break, and
 * libass mis-spaces them on this build. The worker Lambda is nodejs20 plus an
 * ffmpeg layer — no Python. Rather than block the portal on a Pillow layer, the
 * portal renders the clip and the CLI keeps the lyric version. Do not "add"
 * lyrics here with drawtext; it will render broken Tamil.
 *
 * Pure and I/O-free, like master-video: this builds argument lists and decides
 * what is legal. The worker runs them.
 */

import type { MasterJob } from '@/types/masterJob';
import { isMasteringKey } from '@/lib/mastering-storage';

/** Vertical, the only shape Reels and Shorts serve. */
export const SHORT_WIDTH = 1080;
export const SHORT_HEIGHT = 1920;

/** Clip length. 30s is long enough to carry a chorus and short enough to be watched twice. */
export const SHORT_SECONDS = 30;

/** Skip this much intro before looking for the hook. */
export const SHORT_MIN_START_SEC = 8;

/**
 * Shortest clip worth producing. Below this a "short" is a stub, and the render
 * is better refused than delivered — the operator can see why and cut by hand.
 */
export const SHORT_MIN_SECONDS = 10;

/** Start this far before the hook so the clip builds into it rather than opening mid-phrase. */
export const SHORT_LEAD_IN_SEC = 4;

/** Audio fade at each end, seconds — a hard cut mid-music reads as a broken file. */
export const SHORT_FADE_SEC = 0.6;

/**
 * 25 fps, not the 10 the long-form render uses.
 *
 * The long render loops ONE still, so frame rate is pure cost. A short is
 * consumed in a feed beside real video, and 10 fps reads as a glitch there even
 * on a static image — some players also treat very low frame rates oddly.
 */
export const SHORT_FPS = 25;

export type ShortRefusal = 'not-done' | 'not-saved' | 'no-master' | 'no-cover' | 'bad-cover' | 'too-short';

export type ShortPlan =
  | { ok: true; audioKey: string; coverKey: string; shortKey: string }
  | { ok: false; reason: ShortRefusal };

/** S3 key for the short, beside the master it came from. */
export function shortKeyFor(masterKey: string): string {
  return masterKey.replace(/\.wav$/i, `-short-${SHORT_HEIGHT}.mp4`);
}

/** True if the key is a short this module produced. */
export function isShortKey(key: string): boolean {
  return new RegExp(`-short-${SHORT_HEIGHT}\\.mp4$`, 'i').test(key);
}

/**
 * Decide whether this job can produce a short.
 *
 * Mirrors planRender, including requiring a SAVED master: an unsaved job expires
 * in 24 hours, and a clip whose provenance vanishes overnight is the orphan the
 * library exists to prevent.
 */
export function planShort(job: MasterJob, coverKey: string | null | undefined): ShortPlan {
  if (job.status !== 'done') return { ok: false, reason: 'not-done' };
  if (!job.savedAt) return { ok: false, reason: 'not-saved' };
  if (!job.masterKey) return { ok: false, reason: 'no-master' };
  if (!coverKey) return { ok: false, reason: 'no-cover' };
  if (!isMasteringKey(coverKey)) return { ok: false, reason: 'bad-cover' };
  // A track shorter than the clip cannot yield one. Duration is known once
  // mastering has measured it; null means "not measured", which we allow
  // through rather than refusing on missing data.
  if (job.editedDurationSec !== null && job.editedDurationSec < SHORT_SECONDS) {
    return { ok: false, reason: 'too-short' };
  }
  return { ok: true, audioKey: job.masterKey, coverKey, shortKey: shortKeyFor(job.masterKey) };
}

/** Operator-facing wording. Says what to DO wherever there is something. */
export function shortRefusalMessage(reason: ShortRefusal): string {
  switch (reason) {
    case 'not-saved': return 'Save this master before making a short.';
    case 'no-master': return 'This job has no mastered WAV to cut a short from.';
    case 'no-cover': return 'Add a cover image to make a short.';
    case 'bad-cover': return 'That cover is not in the mastering workspace.';
    case 'not-done': return 'Only a finished master can make a short.';
    case 'too-short': return `The track is shorter than ${SHORT_SECONDS}s, so there is no clip to cut.`;
  }
}

/**
 * Measure momentary loudness so the hook can be found. Output is discarded —
 * only the ebur128 log matters, which is why this writes to null.
 */
export function buildLoudnessArgs(audioPath: string): string[] {
  return ['-hide_banner', '-nostats', '-i', audioPath, '-af', 'ebur128=peak=true', '-f', 'null', '-'];
}

/**
 * STEP 1 of 2 — compose the vertical frame ONCE, to a PNG.
 *
 * The same split as the long-form render, for the same reason: a blurred
 * backdrop recomputed on every frame is what pushed the old pipeline past the
 * Lambda timeout. Composing once costs well under a second.
 */
export function buildShortComposeArgs(params: { coverPath: string; framePath: string }): string[] {
  const art = Math.round(SHORT_WIDTH * 0.92);
  return [
    '-hide_banner', '-nostats',
    '-i', params.coverPath,
    '-filter_complex',
    // Backdrop fills the tall frame; the cover sits centred at native aspect.
    // Vertical ALWAYS gets the backdrop — a 16:9 cover cannot fill 9:16 without
    // cropping most of the picture away, which is the one thing never to do.
    `[0:v]scale=${SHORT_WIDTH}:${SHORT_HEIGHT}:force_original_aspect_ratio=increase,` +
      `crop=${SHORT_WIDTH}:${SHORT_HEIGHT},boxblur=28:4,eq=brightness=-0.10[bg];` +
      `[0:v]scale=${art}:${art}:force_original_aspect_ratio=decrease:flags=lanczos[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2[v]`,
    '-map', '[v]', '-frames:v', '1', '-y', params.framePath,
  ];
}

/**
 * STEP 2 of 2 — encode the clip from the composed frame plus the hook window.
 *
 * ⚠️ NO `-filter_complex` HERE. Its absence is what keeps the render cheap; the
 * audio filter is a plain `-af`, which is per-sample, not per-frame. A test pins this.
 */
export function buildShortArgs(params: {
  framePath: string;
  audioPath: string;
  startSec: number;
  outPath: string;
  seconds?: number;
}): string[] {
  const secs = params.seconds ?? SHORT_SECONDS;
  const fade = SHORT_FADE_SEC;
  return [
    '-hide_banner', '-nostats',
    '-loop', '1', '-framerate', String(SHORT_FPS), '-i', params.framePath,
    // Seek BEFORE the input so ffmpeg jumps rather than decoding from zero.
    '-ss', params.startSec.toFixed(3), '-t', String(secs), '-i', params.audioPath,
    '-map', '0:v', '-map', '1:a',
    '-af', `afade=t=in:st=0:d=${fade},afade=t=out:st=${(secs - fade).toFixed(3)}:d=${fade}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage',
    '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(SHORT_FPS),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart', '-t', String(secs),
    '-y', params.outPath,
  ];
}
