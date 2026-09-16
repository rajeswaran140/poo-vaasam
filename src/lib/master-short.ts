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

/**
 * Clip length when the machine picks the window. 30s is long enough to carry a
 * chorus and short enough to be watched twice.
 */
export const SHORT_SECONDS = 30;

/**
 * The range an OPERATOR may choose, when they pick the window themselves.
 *
 * These are editorial bounds, not technical ones: below 30s a chosen lyric has
 * no room to land, and above 60s a clip stops being a clip. Every platform this
 * feeds (Reels, Instagram, Shorts) accepts far more than 60s — the ceiling is
 * about what is worth posting, not what is allowed. Distinct from
 * SHORT_FLOOR_SECONDS, which is about what can physically be rendered.
 */
export const SHORT_PICK_MIN_SECONDS = 30;
export const SHORT_PICK_MAX_SECONDS = 60;

/** Skip this much intro before looking for the hook. */
export const SHORT_MIN_START_SEC = 8;

/**
 * Physical floor. Below this a "short" is a stub, and the render is better
 * refused than delivered — the operator can see why and cut by hand. This
 * bounds the AUTO path, where the window comes from a measurement of a track
 * whose length nothing else knew; an operator's own pick is bounded by
 * SHORT_PICK_MIN_SECONDS instead, which is higher.
 */
export const SHORT_FLOOR_SECONDS = 10;

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

export type ShortRefusal =
  | 'not-done' | 'not-saved' | 'no-master' | 'no-cover' | 'bad-cover' | 'too-short'
  | 'bad-window' | 'window-past-end';

/**
 * An operator-chosen window. `null` anywhere this appears means "no choice was
 * made" — measure the track and take the loudest stretch, the original
 * behaviour.
 */
export interface ShortWindow {
  startSec: number;
  seconds: number;
}

export type ShortPlan =
  | { ok: true; audioKey: string; coverKey: string; shortKey: string; window: ShortWindow | null }
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
export function planShort(
  job: MasterJob,
  coverKey: string | null | undefined,
  /** What the operator picked on the waveform, or typed. Omit to let it pick. */
  want?: Partial<ShortWindow> | null
): ShortPlan {
  if (job.status !== 'done') return { ok: false, reason: 'not-done' };
  if (!job.savedAt) return { ok: false, reason: 'not-saved' };
  if (!job.masterKey) return { ok: false, reason: 'no-master' };
  if (!coverKey) return { ok: false, reason: 'no-cover' };
  if (!isMasteringKey(coverKey)) return { ok: false, reason: 'bad-cover' };

  const window = readWindow(want);
  if (window === 'invalid') return { ok: false, reason: 'bad-window' };

  // Duration is known once mastering has measured it; null means "not
  // measured", which we allow through rather than refusing on missing data —
  // the worker re-checks against the file's own header either way.
  const duration = job.editedDurationSec;
  if (window) {
    // A chosen window that runs off the end is REFUSED, never quietly
    // shortened: the operator auditioned those seconds, and handing back a
    // different clip than the one they heard is the worst of both.
    if (duration !== null && window.startSec + window.seconds > duration) {
      return { ok: false, reason: 'window-past-end' };
    }
  } else if (duration !== null && duration < SHORT_SECONDS) {
    return { ok: false, reason: 'too-short' };
  }

  return { ok: true, audioKey: job.masterKey, coverKey, shortKey: shortKeyFor(job.masterKey), window };
}

/**
 * Normalise what arrived over the wire into a window, `null` (nothing picked)
 * or `'invalid'`.
 *
 * Deliberately strict rather than clamping. A start of -5 or a length of 600
 * is not a near-miss to be rounded into range — it is a caller that does not
 * mean what this function would decide for it.
 */
function readWindow(want: Partial<ShortWindow> | null | undefined): ShortWindow | null | 'invalid' {
  if (!want) return null;
  const { startSec, seconds } = want;
  // Neither given is the same as no window at all.
  if (startSec === undefined && seconds === undefined) return null;
  if (typeof startSec !== 'number' || typeof seconds !== 'number') return 'invalid';
  if (!Number.isFinite(startSec) || !Number.isFinite(seconds)) return 'invalid';
  if (startSec < 0) return 'invalid';
  if (seconds < SHORT_PICK_MIN_SECONDS || seconds > SHORT_PICK_MAX_SECONDS) return 'invalid';
  // Round to the tenth the waveform can actually express; ffmpeg gets three
  // decimals but nobody can drag to a millisecond.
  return { startSec: Math.round(startSec * 10) / 10, seconds: Math.round(seconds * 10) / 10 };
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
    case 'bad-window': return `Pick a window between ${SHORT_PICK_MIN_SECONDS} and ${SHORT_PICK_MAX_SECONDS} seconds long.`;
    case 'window-past-end': return 'That window runs past the end of the track — move it earlier or make it shorter.';
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
