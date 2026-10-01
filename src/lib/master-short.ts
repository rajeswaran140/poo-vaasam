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
import { FRAME_FILL_ASPECT_TOLERANCE, MIN_SEGMENT_SECONDS, type SlideshowCover } from '@/lib/master-video';
import { isPeakMaster } from '@/lib/master-peak';

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
 * The ceiling is the real platform limit, NOT a view about what a clip should
 * be. An earlier version capped this at 60s on the reasoning that "above 60s a
 * clip stops being a clip" — which was a convention applied over the channel's
 * own evidence: its 1-2 minute vertical videos perform well, and some songs
 * need two minutes to reach the passage worth posting. YouTube Shorts and
 * Instagram Reels both accept three minutes; Facebook Reels stops at 90s, which
 * is reported rather than enforced (see SHORT_FB_REELS_MAX_SECONDS).
 *
 * Distinct from SHORT_FLOOR_SECONDS, which is about what can physically be
 * rendered rather than what is worth posting.
 */
export const SHORT_PICK_MIN_SECONDS = 30;
export const SHORT_PICK_MAX_SECONDS = 180;

/**
 * Facebook Reels stops at 90s where YouTube Shorts and Instagram Reels take
 * three minutes. A clip past this is not refused — it is simply not a Facebook
 * Reel, and saying so is more use than blocking it.
 */
export const SHORT_FB_REELS_MAX_SECONDS = 90;

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

/**
 * Fade IN, seconds. Deliberately short.
 *
 * A clip in a feed is judged in its first seconds, so easing in over three of
 * them would spend the only attention it gets on near-silence. This is just
 * long enough that opening mid-phrase does not click.
 */
export const SHORT_FADE_IN_SEC = 0.6;

/**
 * Fade OUT, seconds. Deliberately long.
 *
 * Different job from the fade in: this one has to sound like the piece of music
 * ENDED rather than like the file was cut off. At 0.6s it read as an
 * interruption — technically clean, but the ear hears a stop, not an ending.
 */
export const SHORT_FADE_OUT_SEC = 3;

/**
 * A fade may never eat more than this share of the clip.
 *
 * The auto path can clamp a clip to as little as SHORT_FLOOR_SECONDS when the
 * track is short, and a 3s fade on a 10s clip is a third of it fading — which
 * is no longer an ending, it is the whole back half.
 */
export const SHORT_FADE_MAX_FRACTION = 0.25;

/** The fade-out actually used for a clip of this length. */
export function shortFadeOutFor(seconds: number): number {
  const allowed = Math.max(0, seconds) * SHORT_FADE_MAX_FRACTION;
  return Math.round(Math.min(SHORT_FADE_OUT_SEC, allowed) * 100) / 100;
}

/**
 * 25 fps, not the 10 the long-form render uses.
 *
 * The long render loops ONE still, so frame rate is pure cost. A short is
 * consumed in a feed beside real video, and 10 fps reads as a glitch there even
 * on a static image — some players also treat very low frame rates oddly.
 */
export const SHORT_FPS = 25;

export type ShortRefusal =
  | 'karaoke-bed'
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
  // FIRST, for the same reason as planRender: a bed is a deliverable, not a
  // release, and it would otherwise pass every check here and offer a button
  // the worker refuses. See src/lib/master-peak.ts.
  if (isPeakMaster(job)) return { ok: false, reason: 'karaoke-bed' };
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
    case 'karaoke-bed': return 'A karaoke bed is a deliverable, not a release — there is no short to cut from it.';
    case 'not-saved': return 'Save this master before making a short.';
    case 'no-master': return 'This job has no mastered WAV to cut a short from.';
    case 'no-cover': return 'Add a cover image to make a short.';
    case 'bad-cover': return 'That cover is not in the mastering workspace.';
    case 'not-done': return 'Only a finished master can make a short.';
    case 'too-short': return `The track is shorter than ${SHORT_SECONDS}s, so there is no clip to cut.`;
    case 'bad-window': return `A clip must be between ${SHORT_PICK_MIN_SECONDS} seconds and ${SHORT_PICK_MAX_SECONDS / 60} minutes long.`;
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
 * STEP 1 of 2 — compose the vertical frame ONCE, to FRAME_EXTENSION.
 *
 * PPM, not PNG — the long render and this one share the format and the
 * reason. See FRAME_EXTENSION in master-video.ts.
 *
 * The same split as the long-form render, for the same reason: a blurred
 * backdrop recomputed on every frame is what pushed the old pipeline past the
 * Lambda timeout. Composing once costs well under a second.
 */
export function buildShortComposeArgs(params: {
  coverPath: string;
  framePath: string;
  /** width/height of the cover, from probeCoverAspect. Omit ⇒ assume it cannot fill. */
  coverAspect?: number;
  /**
   * Enlarge the FINISHED frame this many times, for a render that moves across
   * it — see MOTION_SOURCE_SCALE. Omit or 1 ⇒ the frame exactly as it has
   * always been composed.
   */
  sourceScale?: number;
}): string[] {
  const base = buildShortFrameFilter(params.coverAspect);
  const scale = params.sourceScale && params.sourceScale > 1 ? params.sourceScale : 1;
  // Composed at 1x FIRST and enlarged after, so a moving short looks exactly
  // like a still one at rest — same fill rule, same backdrop, same sharpening.
  const filter =
    scale === 1
      ? base
      : base.replace(/\[v\]$/, `[v1];[v1]scale=${SHORT_WIDTH * scale}:${SHORT_HEIGHT * scale}:flags=lanczos[v]`);
  return [
    '-hide_banner', '-nostats',
    '-i', params.coverPath,
    '-filter_complex', filter,
    '-map', '[v]', '-frames:v', '1', '-y', params.framePath,
  ];
}

/**
 * The frame itself. Two branches, and the first one is the whole point.
 *
 * ⚠️ NEVER PUT THE ARTWORK IN A SQUARE BOX. The first version scaled every
 * cover to fit inside a 994x994 square regardless of its shape, so a 941x1672
 * cover — already 9:16 to three decimal places — rendered at 559x994, about a
 * QUARTER of the frame, floating on a blurred copy of itself. That is the same
 * defect `buildVideoFilter` was fixed for in the long-form render (the old
 * `art = height * 0.82`), reproduced here. A cover that fits the frame must
 * fill it.
 */
export function buildShortFrameFilter(coverAspect?: number): string {
  const target = SHORT_WIDTH / SHORT_HEIGHT;
  const fills =
    typeof coverAspect === 'number' && Number.isFinite(coverAspect) &&
    coverAspect > 0 && Math.abs(coverAspect - target) / target <= FRAME_FILL_ASPECT_TOLERANCE;

  if (fills) {
    // Edge to edge. The crop takes at most a row or two, which is what
    // `increase` plus a matching aspect means.
    return (
      `[0:v]scale=${SHORT_WIDTH}:${SHORT_HEIGHT}:force_original_aspect_ratio=increase:` +
      `flags=lanczos+accurate_rnd+full_chroma_int,crop=${SHORT_WIDTH}:${SHORT_HEIGHT},` +
      `unsharp=5:5:0.55:5:5:0.0[v]`
    );
  }

  // A cover that genuinely cannot fill 9:16 — a square or widescreen one — is
  // scaled to the FRAME, not to a square box, so it still spans the full width
  // at its own ratio. The blurred backdrop fills what is left rather than
  // cropping the picture away.
  return (
    `[0:v]scale=${SHORT_WIDTH}:${SHORT_HEIGHT}:force_original_aspect_ratio=increase,` +
      `crop=${SHORT_WIDTH}:${SHORT_HEIGHT},boxblur=28:4,eq=brightness=-0.10[bg];` +
    `[0:v]scale=${SHORT_WIDTH}:${SHORT_HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2[v]`
  );
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
  const fadeIn = SHORT_FADE_IN_SEC;
  const fadeOut = shortFadeOutFor(secs);
  return [
    '-hide_banner', '-nostats',
    '-loop', '1', '-framerate', String(SHORT_FPS), '-i', params.framePath,
    // Seek BEFORE the input so ffmpeg jumps rather than decoding from zero.
    '-ss', params.startSec.toFixed(3), '-t', String(secs), '-i', params.audioPath,
    '-map', '0:v', '-map', '1:a',
    '-af', `afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${(secs - fadeOut).toFixed(3)}:d=${fadeOut}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage',
    '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(SHORT_FPS),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart', '-t', String(secs),
    '-y', params.outPath,
  ];
}

/**
 * ============================================================================
 * FULL-LENGTH VERTICAL — the whole song at 1080×1920.
 * ============================================================================
 *
 * Added 2026-09-27. A clip is for Reels and Shorts; this is for a Facebook
 * video or an Instagram feed post, where vertical is welcome but the 3-minute
 * ceiling does not apply. It sits ALONGSIDE the clip, not instead of it.
 *
 * It reuses `buildShortComposeArgs` unchanged — same vertical frame, same
 * blurred backdrop. Only the assembly differs, and it differs in exactly one
 * way that matters.
 */

/**
 * A ceiling to protect the worker, NOT an opinion about song length.
 *
 * The Lambda times out at 900s and existing full-length 16:9 renders take
 * 79-195s, so ten minutes of audio is comfortable headroom. This exists so a
 * corrupt or mis-probed duration cannot wedge the worker.
 */
export const FULL_VERTICAL_MAX_SECONDS = 600;

/**
 * S3 key for the whole-song vertical, beside the master it came from.
 *
 * ⚠️ NOT `shortKeyFor`. The first build stored this under the clip's key and
 * in the clip's fields, so rendering one silently replaced the other — the
 * opposite of "alongside". They are two files and two sets of fields.
 */
export function fullVerticalKeyFor(masterKey: string): string {
  return masterKey.replace(/\.wav$/i, `-vertical-${SHORT_HEIGHT}.mp4`);
}

/** True if the key is a whole-song vertical this module produced. */
export function isFullVerticalKey(key: string): boolean {
  return new RegExp(`-vertical-${SHORT_HEIGHT}\\.mp4$`, 'i').test(key);
}

export type FullVerticalPlan =
  | { ok: true; seconds: number }
  | { ok: false; message: string };

/** Whether this master can be rendered full-length vertical, and why not. */
export function planFullVertical(
  audioSeconds: number | null | undefined,
  /** The move it will be rendered with; omitted or `none` ⇒ still. */
  motion?: string | null,
): FullVerticalPlan {
  if (typeof audioSeconds !== 'number' || !Number.isFinite(audioSeconds) || audioSeconds <= 0) {
    return {
      ok: false,
      message:
        'The audio duration could not be read, and a full-length render is bounded by it. ' +
        'Re-run the analysis for this master.',
    };
  }
  if (audioSeconds > FULL_VERTICAL_MAX_SECONDS) {
    return {
      ok: false,
      message: `That audio is ${Math.round(audioSeconds / 60)} minutes. The limit is ${
        FULL_VERTICAL_MAX_SECONDS / 60
      } minutes, to keep the render inside the worker's timeout.`,
    };
  }
  // 480, written out: FULL_VERTICAL_MOTION_MAX_SECONDS is declared further
  // down this file and this must not depend on declaration order.
  if (motion && motion !== 'none' && audioSeconds > 480) {
    return {
      ok: false,
      message:
        'With motion, the whole-song vertical is limited to 8 minutes — every frame has to be drawn, ' +
        'and a longer song would not finish in the worker\'s time. Set Motion to None for this one.',
    };
  }
  return { ok: true, seconds: audioSeconds };
}

/**
 * Encode the whole song as a vertical video.
 *
 * ⚠️ READ THIS BEFORE CHANGING THE DURATION FLAGS. This does NOT bound the way
 * `buildShortArgs` does, and the difference is deliberate and hard-won.
 *
 * A clip wants a fixed excerpt, so `-t` on the audio input plus `-t` on the
 * output is correct there. Applying that to a full render reproduces the bug
 * the video engine took days to find: on the Lambda's ffmpeg 7.0.2 (the dev
 * box runs 6.1.1, where it behaves differently) the output runs 1.0-2.4s past
 * the audio, and the obvious remedy — `-t` on the output with `-shortest` —
 * TRUNCATES the song by ~31ms instead. That was measured with astats sample
 * counts; the container's own `Duration:` header reports the LONGEST stream
 * and will happily tell you it is fine.
 *
 * So, exactly as `buildVideoArgs` in master-video.ts:
 *   - `-t` bounds the LOOPED STILL, and nothing else;
 *   - the audio input is never trimmed and never seeked;
 *   - `-shortest` is never passed.
 *
 * The video then ends when the looped image does, and the audio plays whole.
 */
export function buildFullVerticalArgs(params: {
  framePath: string;
  audioPath: string;
  outPath: string;
  /** Probed duration of the audio, in seconds. Bounds the looped still. */
  audioSeconds: number;
}): string[] {
  const secs = params.audioSeconds;
  const fadeIn = SHORT_FADE_IN_SEC;
  const fadeOut = shortFadeOutFor(secs);
  return [
    '-hide_banner', '-nostats',
    '-loop', '1', '-framerate', String(SHORT_FPS),
    // Bounds THIS input — the looped still — and nothing else.
    '-t', String(secs),
    '-i', params.framePath,
    // No -ss and no -t: the audio plays from zero, whole.
    '-i', params.audioPath,
    '-map', '0:v', '-map', '1:a',
    '-af', `afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${(secs - fadeOut).toFixed(3)}:d=${fadeOut}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage',
    '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(SHORT_FPS),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart',
    '-y', params.outPath,
  ];
}


/**
 * ============================================================================
 * THE VERTICAL SLIDESHOW — several images in a clip, or in the whole song.
 * ============================================================================
 *
 * Added 2026-10-01. The 16:9 video has had a slideshow since #346; the vertical
 * renders used the cover alone, so a song with three images could not put them
 * in its own short.
 *
 * ONE LIST, ONE MEANING. The image list is the same one the video uses and its
 * times are seconds into the SONG. A clip is a window onto that timeline: it
 * shows whatever the slideshow would be showing during those seconds. The
 * operator never re-times images for a clip, and a clip whose window is picked
 * by loudness — where nobody knows the start until the worker has measured —
 * still gets the right images, because the worker does this mapping.
 *
 * Same architecture as the long-form slideshow, for the same reason: each
 * image is composed ONCE and its stretch is a run of identical frames, so
 * nothing here filters per frame.
 */

/**
 * The images a window shows, re-timed to seconds into the CLIP.
 *
 * Never refuses. A cut that would leave an image on screen for under
 * MIN_SEGMENT_SECONDS at either edge of the window is absorbed rather than
 * reported: at the start the clip opens on the NEXT image, at the end the cut
 * is dropped. The operator timed these images against the song, not against
 * this window — a half-second flash at the edge is an accident of where the
 * clip fell, not a decision of theirs to be refused.
 */
export function windowCovers(
  covers: readonly SlideshowCover[],
  startSec: number,
  seconds: number,
): SlideshowCover[] {
  if (covers.length === 0) return [];
  const end = startSec + seconds;
  // The image the song is showing at the moment the clip starts.
  let open = 0;
  for (let i = 0; i < covers.length; i += 1) {
    if (covers[i].startSec <= startSec) open = i;
  }
  const out: SlideshowCover[] = [{ coverKey: covers[open].coverKey, startSec: 0 }];
  for (let i = open + 1; i < covers.length; i += 1) {
    const at = covers[i].startSec - startSec;
    if (covers[i].startSec >= end) break;
    // Too close to the end to read — and every later cut is closer still.
    if (seconds - at < MIN_SEGMENT_SECONDS) break;
    const last = out[out.length - 1];
    if (at - last.startSec < MIN_SEGMENT_SECONDS) {
      // The previous image would only flash: this one takes its place.
      out[out.length - 1] = { coverKey: covers[i].coverKey, startSec: last.startSec };
      continue;
    }
    out.push({ coverKey: covers[i].coverKey, startSec: Math.round(at * 1000) / 1000 });
  }
  return out;
}

/**
 * Encode ONE stretch of a vertical slideshow from its composed frame.
 *
 * ⚠️ NO `-filter_complex` AND NO AUDIO, exactly as `buildSegmentArgs`: the
 * frame was finished by `buildShortComposeArgs`, and the audio is laid over
 * the joined picture once, in one continuous pass. `seconds` must come from
 * `planSegments(..., SHORT_FPS)` so it is a whole number of frames.
 */
export function buildShortSegmentArgs(params: {
  framePath: string;
  seconds: number;
  outPath: string;
}): string[] {
  return [
    '-hide_banner', '-nostats',
    '-loop', '1', '-framerate', String(SHORT_FPS), '-t', String(params.seconds), '-i', params.framePath,
    '-map', '0:v',
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage',
    '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(SHORT_FPS),
    '-an',
    '-y', params.outPath,
  ];
}

/**
 * Join the stretches and lay the audio over them, in one pass.
 *
 * The AUDIO half is deliberately identical to the single-image renders —
 * `buildShortArgs` for a clip, `buildFullVerticalArgs` for the whole song —
 * so a slideshow changes the picture and nothing about the sound:
 *   - a CLIP seeks and bounds the audio input and bounds the output;
 *   - the WHOLE SONG never seeks or trims the audio.
 * ⚠️ `-shortest` is never passed in either. The picture is finite, and that
 * flag can only ever trim the song — see buildJoinArgs in master-video.ts.
 */
export function buildShortJoinArgs(params: {
  listPath: string;
  audioPath: string;
  outPath: string;
  /** A clip: where it starts in the song and how long it runs. */
  startSec?: number;
  seconds?: number;
  /** The whole song: its probed length. Set ⇒ no seek, no trim. */
  fullSeconds?: number;
}): string[] {
  const full = typeof params.fullSeconds === 'number';
  const secs = full ? params.fullSeconds! : params.seconds ?? SHORT_SECONDS;
  const fadeOut = shortFadeOutFor(secs);
  return [
    '-hide_banner', '-nostats',
    '-fflags', '+genpts',
    '-f', 'concat', '-safe', '0', '-i', params.listPath,
    ...(full ? [] : ['-ss', (params.startSec ?? 0).toFixed(3), '-t', String(secs)]),
    '-i', params.audioPath,
    '-map', '0:v', '-map', '1:a',
    '-af', `afade=t=in:st=0:d=${SHORT_FADE_IN_SEC},afade=t=out:st=${(secs - fadeOut).toFixed(3)}:d=${fadeOut}`,
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart',
    ...(full ? [] : ['-t', String(secs)]),
    '-y', params.outPath,
  ];
}

/**
 * ============================================================================
 * SLOW ZOOM AND PAN — a short whose picture moves.
 * ============================================================================
 *
 * Added 2026-10-01. The first vertical render where every frame differs, so it
 * is the one place in this file that filters per frame — deliberately, for
 * the vertical renders only. A clip is 30 s to 3 minutes. Measured on the Lambda's ffmpeg 7.0.2,
 * 30 s at 25 fps: still 12 s, zoom 26 s, pan 25 s. A 3-minute short is about
 * 2.5 minutes of a 15-minute ceiling. The whole-song vertical may move too,
 * up to FULL_VERTICAL_MOTION_MAX_SECONDS, in out-and-back legs.
 */

/**
 * A long stretch moves out and back in legs of about this long.
 *
 * One 8% move spread over a five-minute song is a third of a pixel a second —
 * invisible. Half a minute a leg is the speed a 30 s clip already moves at.
 */
export const MOTION_LEG_SECONDS = 30;

/**
 * The longest whole song that may MOVE. Tighter than FULL_VERTICAL_MAX_SECONDS
 * because every frame is drawn: a moving 5:32 render measured 294 s on the
 * Lambda's ffmpeg 7.0.2 — 0.88x the song's length — so eight minutes is about
 * 7 of the worker's 15, with the rest for download, verification and upload.
 * The 7:52 joined master fits.
 */
export const FULL_VERTICAL_MOTION_MAX_SECONDS = 480;

/** `none` is first and is the default: a short is still unless a move is chosen. */
export const SHORT_MOTIONS = ['none', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down'] as const;
export type ShortMotion = (typeof SHORT_MOTIONS)[number];

export function isShortMotion(value: unknown): value is ShortMotion {
  return typeof value === 'string' && (SHORT_MOTIONS as readonly string[]).includes(value);
}

/**
 * ⚠️ FOUR, NOT TWO. zoompan positions its window in WHOLE source pixels, so on
 * a 1x frame a slow move advances one output pixel at a time, and at 2x a pan
 * repeated 59% of its frames — it visibly stutters. At 4x the steps are a
 * quarter of an output pixel (15% repeats, none perceptible). 4x costs about
 * twice a still render; 2x would save 10 s and show.
 */
export const MOTION_SOURCE_SCALE = 4;

/**
 * How far a move travels: 8% of the frame, over the whole stretch.
 *
 * Small on purpose. The artwork is the release's identity and a move crops it:
 * a zoom ends 8% in, a pan holds 8% in throughout. Enough to read as alive,
 * not enough to lose a face at the edge.
 */
export const MOTION_TRAVEL = 0.08;

/**
 * Encode ONE stretch with a slow move, from a frame composed at
 * MOTION_SOURCE_SCALE.
 *
 * The move runs once across the stretch — first frame at the start position,
 * last frame at the end — so in a slideshow each image gets its own complete
 * move. `-frames:v` bounds it rather than `-t`: the count is exact, and
 * `seconds` comes from `planSegments(…, SHORT_FPS)`, already whole frames.
 *
 * No `-tune stillimage` — that tuning assumes nothing moves. No audio: the
 * join lays it over, exactly as for a still slideshow.
 */
export function buildMotionSegmentArgs(params: {
  framePath: string;
  seconds: number;
  outPath: string;
  motion: Exclude<ShortMotion, 'none'>;
  /**
   * Go out and back in legs of about this long — the WHOLE SONG passes
   * MOTION_LEG_SECONDS. Omitted ⇒ one pass across the stretch, which is what a
   * clip has always done and must keep doing.
   */
  legSeconds?: number;
}): string[] {
  const frames = Math.max(1, Math.round(params.seconds * SHORT_FPS));
  // `on` runs 0..frames-1, so dividing by frames-1 lands the last frame on the end.
  const span = Math.max(1, frames - 1);
  const T = MOTION_TRAVEL;
  const held = (1 + T).toFixed(2);
  const centreX = "x='iw/2-(iw/zoom/2)'";
  const centreY = "y='ih/2-(ih/zoom/2)'";
  // HOW FAR ALONG THE MOVE, 0..1. One pass is a ramp. A long stretch is a
  // triangle wave: out over one leg, back over the next, so the picture keeps
  // moving at a speed the eye can see and never jumps back to the start.
  const legs =
    params.legSeconds && params.legSeconds > 0 ? Math.max(1, Math.round(params.seconds / params.legSeconds)) : 1;
  const leg = Number((frames / legs).toFixed(3));
  const along = legs > 1 ? `(1-abs(mod(on,${Number((leg * 2).toFixed(3))})-${leg})/${leg})` : `on/${span}`;
  const move: Record<Exclude<ShortMotion, 'none'>, string> = {
    'zoom-in': `z='1+${T}*${along}':${centreX}:${centreY}`,
    'zoom-out': `z='${held}-${T}*${along}':${centreX}:${centreY}`,
    'pan-right': `z='${held}':x='(iw-iw/zoom)*${along}':${centreY}`,
    'pan-left': `z='${held}':x='(iw-iw/zoom)*(1-${along})':${centreY}`,
    'pan-down': `z='${held}':${centreX}:y='(ih-ih/zoom)*${along}'`,
    'pan-up': `z='${held}':${centreX}:y='(ih-ih/zoom)*(1-${along})'`,
  };
  const expr = move[params.motion];
  if (!expr) throw new Error(`not a move: ${String(params.motion)}`);
  return [
    '-hide_banner', '-nostats',
    '-i', params.framePath,
    '-vf', `zoompan=${expr}:d=${frames}:s=${SHORT_WIDTH}x${SHORT_HEIGHT}:fps=${SHORT_FPS}`,
    '-frames:v', String(frames),
    '-c:v', 'libx264', '-preset', 'veryfast',
    '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(SHORT_FPS),
    '-an',
    '-y', params.outPath,
  ];
}
