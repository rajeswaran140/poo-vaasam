/**
 * Rendering the YouTube video — cover art plus the mastered audio, straight to
 * an upload-ready MP4.
 *
 * WHY THIS EXISTS. The module masters to a 24-bit/48k WAV and then hands the
 * file to Premiere, where the audio is re-encoded on export before YouTube
 * re-encodes it again. Every one of those steps is a lossy generation the
 * listener eventually hears, and the one that matters most is entirely
 * avoidable: for a cover-art release the "video edit" is a still image over a
 * song, which ffmpeg does deterministically and Premiere does by hand.
 *
 * Three decisions are encoded here, each for a measured reason:
 *
 *  1. THE AUDIO COMES FROM THE MASTER, NEVER THE WEB MP3. The module now
 *     produces both; feeding the 192k MP3 into the render would stack a lossy
 *     generation in front of YouTube's own. `planRender` refuses a job with no
 *     masterKey rather than falling back to anything else.
 *  2. 1440p BY DEFAULT. YouTube assigns a better audio codec and bitrate to
 *     higher-resolution uploads (Opus ~160 kbps at 1440p+ against AAC ~128 at
 *     1080p). For a still image the extra pixels cost almost nothing to encode —
 *     every frame is identical, so they compress to nearly zero — while the
 *     audio the listener receives improves.
 *  3. AAC 384k / 48 kHz. Comfortably above YouTube's 384 kbps recommendation
 *     for stereo, and matched to the master's own sample rate so nothing
 *     resamples on the way out.
 *
 * Pure and I/O-free, like master-edit and master-join: this builds the ffmpeg
 * argument list and decides whether a render is legal; the worker runs it.
 */

import type { MasterJob } from '@/types/masterJob';
import { isMasteringKey } from '@/lib/mastering-storage';
import { isPeakMaster } from '@/lib/master-peak';

/** Upload heights the render offers. 1440 is the default for the codec bump. */
export const VIDEO_HEIGHTS = [1080, 1440, 2160] as const;
export type VideoHeight = (typeof VIDEO_HEIGHTS)[number];

export const DEFAULT_VIDEO_HEIGHT: VideoHeight = 1440;

/**
 * Audio for the upload. NOT the 192k the site serves — this is the copy YouTube
 * transcodes from, so it wants headroom above whatever the final codec does.
 */
export const VIDEO_AUDIO_BITRATE = '384k';
export const VIDEO_SAMPLE_RATE = 48000;

/**
 * A still image needs no motion smoothness.
 *
 * ⚠️ WAS 30, on the reasoning that identical frames "compress to almost
 * nothing". True of the FILE — a 20 s slice is 1.7 MB at 30 fps and 1.3 MB at
 * 10 — but not of the TIME. Frame count is what the encoder and (before the
 * split below) the filter graph are charged for, and a 5:32 song at 30 fps is
 * 9,972 frames against 3,324 at 10. Measured 2026-08-12: dropping to 10 fps is
 * a 2.6x speedup for a file 24% SMALLER.
 *
 * 10 rather than 1-2 (which is cheaper still) because a very low frame rate is
 * unusual enough at ingest to be worth avoiding without evidence; 10 is a
 * conventional value and already buys the whole margin needed.
 *
 * The 1440p default exists for YouTube's audio-codec bump, which keys off
 * RESOLUTION, not frame rate — so this does not cost the Opus upgrade.
 */
export const VIDEO_FPS = 10;

/**
 * Quality target for the picture. There was none before this, so the encode ran
 * libx264's default CRF 23 at `veryfast` and produced 116 kbps of video on a
 * 2560x1440 still — visibly soft, and rejected by eye on 2026-09-15.
 *
 * Measured on the real 5:30 master: CRF 16 with a 10-second GOP gives 1.01 Mbps
 * and costs 52 seconds (2m59.9s -> 3m54s). That is affordable against 900 s.
 * `-preset veryfast` stays: a slower preset is what does NOT fit.
 */
export const VIDEO_CRF = 16;
/** Keyframe every 10 s at 10 fps. The picture never changes; these are the only expensive frames. */
export const VIDEO_GOP = 100;

/**
 * How far from 16:9 a cover may sit and still be treated as 16:9.
 * 1672x941 (the 2026-09-15 cover) is 1.77683 against 1.77778 — 0.05% out.
 */
export const FRAME_FILL_ASPECT_TOLERANCE = 0.02;

/**
 * Extension for the composed intermediate frame.
 *
 * ⚠️ THIS IS NOT COSMETIC. IT IS WORTH ~1.9x ON EVERY RENDER WE PRODUCE.
 *
 * The frame is a temporary, handed straight to the encoder and deleted minutes
 * later — but the encode LOOPS it, and `-loop 1` decodes the file again for
 * every frame it emits. Written as PNG, a 5:32 song at 10 fps costs 3,320
 * decompressions of a 2560x1440 image to reproduce a picture that never
 * changes. Compressing a file we read thousands of times and keep for seconds
 * is exactly the wrong trade.
 *
 * Measured 2026-09-22, interleaved, two passes each, 332 s of video from one
 * looped still on an idle dev box:
 *
 *     PNG   253.8 s / 258.7 s    mean 256.3 s
 *     PPM   119.5 s / 152.7 s    mean 136.1 s     1.88x, ~120 s back
 *
 * ⚠️ PPM, AND SPECIFICALLY NOT BMP. BMP is faster still — 93-95 s, because its
 * layout converts to yuv420p more cheaply — and that is exactly the trap. BMP
 * stores pixels bottom-up in BGR, which sends swscale down a different path and
 * lands on different values: measured at 43.96 dB PSNR against the PNG render,
 * invisible but real. PPM stores RGB in the order PNG decodes to, so the bytes
 * reaching x264 are BIT-IDENTICAL to what we ship today:
 *
 *     decoded rgb24   png b36a5e13  bmp b36a5e13  ppm b36a5e13   (same picture)
 *     as yuv420p      png 1141f6a3  bmp fc943bc0  ppm 1141f6a3   (what x264 eats)
 *
 * Trading a provably identical output for 40 s of the saving is the right way
 * round: this is meant to be a free optimisation, not a new picture.
 * `scripts/verify-frame-format.ts` re-proves both halves.
 */
export const FRAME_EXTENSION = '.ppm';

/** 16:9 for every offered height. */
export function videoWidthFor(height: VideoHeight): number {
  return Math.round((height * 16) / 9 / 2) * 2; // even width — yuv420p requires it
}

/** S3 key for the rendered video, sitting beside the master it came from. */
export function videoKeyFor(masterKey: string, height: VideoHeight): string {
  return masterKey.replace(/\.wav$/i, `-${height}p.mp4`);
}

/** True if the key is a video this module produced. */
export function isRenderedVideoKey(key: string): boolean {
  return /-master(-\d+(?:_\d+)?LUFS)?-\d+p\.mp4$/i.test(key);
}

export type RenderRefusal =
  | 'karaoke-bed'
  | 'not-done'
  | 'not-saved'
  | 'no-master'
  | 'no-cover'
  | 'bad-cover'
  | 'bad-height';

export type RenderPlan =
  | { ok: true; audioKey: string; coverKey: string; height: VideoHeight; videoKey: string }
  | { ok: false; reason: RenderRefusal };

/**
 * Decide whether this job can be rendered, and with what.
 *
 * Requires a SAVED master for the same reason publishing does: an unsaved job
 * expires in 24 hours, and a video whose provenance vanishes the next day is
 * exactly the orphan the library exists to prevent — except this one ends up on
 * YouTube.
 */
export function planRender(
  job: MasterJob,
  coverKey: string | null | undefined,
  height: number = DEFAULT_VIDEO_HEIGHT,
): RenderPlan {
  // FIRST, and deliberately: a karaoke bed is a deliverable someone bought, not
  // a release. It can be saved, named and downloaded like any master, so every
  // other check here would pass — and the pipeline would offer a Render video
  // button that the worker then refuses, because `isMasterKey` does not match a
  // bed's key. Refusing in the planner is what keeps the pipeline's next-action
  // line and its buttons from disagreeing. See src/lib/master-peak.ts.
  if (isPeakMaster(job)) return { ok: false, reason: 'karaoke-bed' };
  if (job.status !== 'done') return { ok: false, reason: 'not-done' };
  if (!job.savedAt) return { ok: false, reason: 'not-saved' };
  // The master, never the MP3 — the whole point of rendering here.
  if (!job.masterKey) return { ok: false, reason: 'no-master' };
  if (!coverKey) return { ok: false, reason: 'no-cover' };
  // The cover is read by the worker, whose role can reach the entire bucket, so
  // it gets the same workspace guard every other key in this module gets.
  if (!isMasteringKey(coverKey)) return { ok: false, reason: 'bad-cover' };
  if (!VIDEO_HEIGHTS.includes(height as VideoHeight)) return { ok: false, reason: 'bad-height' };

  const h = height as VideoHeight;
  return { ok: true, audioKey: job.masterKey, coverKey, height: h, videoKey: videoKeyFor(job.masterKey, h) };
}

/** Operator-facing wording. Says what to DO wherever there is something. */
export function renderRefusalMessage(reason: RenderRefusal): string {
  switch (reason) {
    case 'karaoke-bed':
      return 'A karaoke bed is a deliverable, not a release — there is no video to render from it.';
    case 'not-saved':
      return 'Save this master before rendering its video.';
    case 'no-master':
      return 'This job has no mastered WAV to render from.';
    case 'no-cover':
      return 'Add a cover image to render the video.';
    case 'bad-cover':
      return 'That cover is not in the mastering workspace.';
    case 'bad-height':
      return `Height must be one of ${VIDEO_HEIGHTS.join(', ')}.`;
    case 'not-done':
      return 'Only a finished master can be rendered.';
  }
}

/**
 * The filter graph. TWO shapes, chosen by the cover's own aspect ratio.
 *
 * ⚠️ THIS USED TO HAVE ONE SHAPE, AND IT WAS THE BUG. `art = height * 0.82`
 * fits any cover into a SQUARE box, whatever its aspect — so a 16:9 cover
 * rendered at 1181x1181 inside 2560x1440: 46% of the frame, floating on a
 * blurred copy of itself. It was written for square art and nothing checked.
 *
 *  - 16:9 within tolerance -> FILL the frame. increase+crop loses at most a row
 *    or two. lanczos because the artwork is usually smaller than the frame, and
 *    a mild unsharp to counter that upscale. Both run ONCE, in the compose pass,
 *    so they cost 0.18 s — see buildComposeArgs.
 *  - anything else -> the original blurred backdrop, which is correct for square
 *    and portrait art and is why this code was written that way.
 *
 * An UNKNOWN aspect takes the backdrop branch deliberately. Assuming 16:9 and
 * being wrong crops the operator's artwork, which is the one outcome he has
 * rejected outright ("do not mask").
 */
export function buildVideoFilter(height: VideoHeight, coverAspect?: number): string {
  const width = videoWidthFor(height);
  const target = 16 / 9;
  const fills =
    typeof coverAspect === 'number' &&
    Number.isFinite(coverAspect) &&
    coverAspect > 0 &&
    Math.abs(coverAspect - target) / target <= FRAME_FILL_ASPECT_TOLERANCE;

  if (fills) {
    return (
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase:` +
      `flags=lanczos+accurate_rnd+full_chroma_int,` +
      `crop=${width}:${height},unsharp=5:5:0.55:5:5:0.0[v]`
    );
  }

  // The artwork occupies most of the frame height, leaving a margin so the blur
  // is visibly a backdrop rather than a border artefact.
  const art = Math.round(height * 0.82);
  return (
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height},boxblur=24:4,eq=brightness=-0.06[bg];` +
    `[0:v]scale=${art}:${art}:force_original_aspect_ratio=decrease:flags=lanczos[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2[v]`
  );
}

/**
 * STEP 1 of 2 — compose the finished frame ONCE, to FRAME_EXTENSION.
 *
 * That format is PPM, not PNG, and the difference is worth ~1.9x on every
 * render — see FRAME_EXTENSION for the measurement and for why it must never
 * become BMP.
 *
 * ⚠️ THIS SPLIT IS WHY THE RENDER FITS IN THE LAMBDA AT ALL. The filter graph
 * used to sit inside the encode, so `boxblur=24:4` at 2560x1440 plus the scale
 * and overlay ran on EVERY frame — recomputing an identical backdrop ~10,000
 * times from an image that never changes. `-tune stillimage` makes the ENCODER
 * cheap and does nothing about the FILTER, which is upstream of it.
 *
 * Measured 2026-08-12 against the real 5:32 master: 43 min projected inside a
 * 900 s Lambda as it was, i.e. it could never have completed. Composing once
 * takes 0.53 s and the output is pixel-identical. With the fps change the whole
 * render lands near 4 min, and ~6 min for a 7:52 joined master (which fails
 * even pre-composed at 30 fps — so both changes are load-bearing, not one).
 */
export function buildComposeArgs(params: {
  coverPath: string;
  framePath: string;
  height?: VideoHeight;
  /** width/height of the cover, probed by the worker. Undefined = unknown. */
  coverAspect?: number;
}): string[] {
  const height = params.height ?? DEFAULT_VIDEO_HEIGHT;
  return [
    '-hide_banner', '-nostats',
    '-i', params.coverPath,
    '-filter_complex', buildVideoFilter(height, params.coverAspect),
    '-map', '[v]',
    '-frames:v', '1',
    '-y', params.framePath,
  ];
}

/**
 * STEP 2 of 2 — encode, looping the ALREADY-COMPOSED frame.
 *
 * ⚠️ THERE MUST BE NO `-filter_complex` HERE. Its absence is the entire fix;
 * re-adding one silently reintroduces the per-frame cost and the render starts
 * timing out again with no error to point at — it would simply be killed at
 * 900 s. A test pins this.
 *
 * ⚠️ HOW THE VIDEO IS ENDED, AND WHY IT IS NOT `-shortest`.
 *
 * Production runs ffmpeg 7.0.2 (Lambda layer `tamilagaval-ffmpeg:1`); the dev
 * box runs 6.1.1. Measured 2026-09-23 by running the layer's own binary here,
 * on this recipe: 6.1.1 honours `-shortest`, 7.0.2 OVERSHOOTS it by a variable
 * 1.0-2.4 s. Every upload for months has carried that much held cover and
 * silence, unnoticed, because nothing compared the two stream lengths.
 *
 * So the picture is bounded by `-t` on its OWN input instead, and `-shortest`
 * is then REMOVED. Both halves, or neither:
 *
 *   - `-t` alone is worse than the bug. At 10 fps the picture can only end on
 *     a 0.1 s boundary, so bounding it makes the VIDEO the shorter stream and
 *     `-shortest` trims the AUDIO — the end of the song. Measured -31.3 ms on
 *     a 91.53 s master, -35.0 ms on a 210.019 s one. master-verify's 0.5 s
 *     duration tolerance cannot see a loss that size, so it would ship.
 *   - `-shortest` alone is today's 2.4 s tail.
 *   - Neither, with no duration to bound by, NEVER ENDS: a looped still has no
 *     last frame and the render burns to the 900 s timeout. That is why an
 *     unknown duration keeps `-shortest` rather than dropping both.
 *
 * Bounded, the picture ends 0.019-0.03 s BEFORE the audio — one frame, and
 * exactly what 6.1.1 produces unfixed. The audio is untouched either way.
 *
 * This is not a new recipe: `buildShortArgs` has always had this shape.
 */
export function buildVideoArgs(params: {
  framePath: string;
  audioPath: string;
  outPath: string;
  /**
   * The AUDIO stream's length in seconds, probed by the worker. Undefined or
   * unusable means the probe could not say — see the `-shortest` fallback above.
   */
  audioSeconds?: number | null;
}): string[] {
  const bound =
    typeof params.audioSeconds === 'number' &&
    Number.isFinite(params.audioSeconds) &&
    params.audioSeconds > 0
      ? params.audioSeconds
      : null;
  return [
    '-hide_banner', '-nostats',
    '-loop', '1', '-framerate', String(VIDEO_FPS),
    // Bounds THIS input — the looped still — and nothing else.
    ...(bound !== null ? ['-t', String(bound)] : []),
    '-i', params.framePath,
    '-i', params.audioPath,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage',
    '-crf', String(VIDEO_CRF), '-g', String(VIDEO_GOP), '-keyint_min', String(VIDEO_FPS),
    '-pix_fmt', 'yuv420p', '-r', String(VIDEO_FPS),
    '-c:a', 'aac', '-b:a', VIDEO_AUDIO_BITRATE, '-ar', String(VIDEO_SAMPLE_RATE),
    // faststart moves the index to the front so YouTube can begin processing
    // without reading the whole file first.
    '-movflags', '+faststart',
    // Only when the picture has no other end. See the block above: with `-t`
    // present this would trim the AUDIO, not the picture.
    ...(bound === null ? ['-shortest'] : []),
    '-y', params.outPath,
  ];
}

/* ---------------------------------------------------------------------------
 * SLIDESHOW — several covers, hard cuts, one composed frame each.
 *
 * WHY THIS IS SHAPED THE WAY IT IS. Everything above rests on one fact: every
 * frame of the video is the same picture, so the filter graph runs ONCE and the
 * encoder is charged for identical frames it compresses to nearly nothing. A
 * slideshow is the largest feature that does not break that. Three covers means
 * three composed frames and three runs of identical frames — the frame COUNT is
 * unchanged, only the number of scene changes goes from zero to two.
 *
 * ⚠️ WHAT WOULD BREAK IT, and is therefore deliberately absent: Ken Burns
 * (zoompan), crossfades (xfade), waveform visualisers, animated overlays. Each
 * makes every frame different, which puts the filter back in the per-frame path
 * — the exact cost the compose/encode split exists to remove. The render would
 * not error; it would be killed at 900 s.
 *
 * ⚠️ NO TEXT IS RENDERED HERE. A title card or end card is an IMAGE the
 * operator uploads, exactly like a cover, and goes through buildComposeArgs
 * unchanged. ffmpeg's drawtext does no complex-script shaping and libass
 * mis-spaces Tamil on this build — see the same warning in master-short.ts.
 * Burning a Tamil end card with drawtext renders broken clusters.
 *
 * THREE STEPS, none of which may gain a -filter_complex:
 *   1. compose each frame once          buildComposeArgs   (unchanged, reused)
 *   2. encode each segment, video only  buildSegmentArgs
 *   3. join the segments AND lay the    buildJoinArgs
 *      master audio over them, one pass
 *
 * Audio is encoded once, at step 3, rather than per segment — so there is no
 * AAC seam in the middle of a song.
 *
 * WHAT THIS COSTS, measured 2026-09-22 against a 5:32 fixture: 424 s against
 * the single-image render's 356 s on the same box. The +68 s is NOT the cuts.
 * Attributed on a 60 s fixture: concatenating is 0.65 s, `+faststart` is
 * 0.04 s, and the AAC encode is 12.8 s — essentially the whole of it.
 *
 * ⚠️ THE OVERHEAD IS THE AUDIO ENCODE LOSING MOST OF ITS OVERLAP. The
 * single-image render encodes picture and sound in ONE ffmpeg process, where
 * the AAC pass runs alongside x264 and much of it is absorbed — 356 s total
 * against 288-308 s of video-only segments puts the overlapped audio near a
 * minute rather than at zero. Split into segments, that pass stands alone and
 * is charged in full.
 *
 * The price is therefore FLAT, not per-image: it does not grow with the number
 * of covers. A fourth and fifth image cost about a second each; the first cut
 * is what costs.
 * ------------------------------------------------------------------------- */

/**
 * Shortest stretch an image may hold the screen.
 *
 * Not an aesthetic limit — a cut costs a keyframe, and at 10 fps a segment
 * shorter than this is a handful of frames wrapped in a container. Two seconds
 * is also about the floor at which a hard cut reads as deliberate rather than
 * as a glitch.
 */
export const MIN_SEGMENT_SECONDS = 2;

/**
 * Ceiling on images per video. Not a technical limit: each cover is one more
 * download, probe and compose in a Lambda that also has to encode the song.
 * Eight is past anything a cover-art release needs.
 */
export const MAX_SLIDESHOW_COVERS = 8;

/**
 * Container for the intermediate segments. They are concatenated with a stream
 * copy, so this only has to hold H.264 and round-trip its timestamps.
 */
export const SEGMENT_EXTENSION = '.mp4';

export type SlideshowRefusal =
  | RenderRefusal
  | 'no-duration'
  | 'too-many-covers'
  | 'cuts-out-of-order'
  | 'cut-past-end'
  | 'segment-too-short';

/** An image and the moment it takes over. The first must start at 0. */
export interface SlideshowCover {
  coverKey: string;
  startSec: number;
}

/** A cover with its stretch resolved. The last one's length comes from the song. */
export interface PlannedSegment extends SlideshowCover {
  seconds: number;
}

export type SlideshowPlan =
  | {
      ok: true;
      audioKey: string;
      height: VideoHeight;
      videoKey: string;
      segments: PlannedSegment[];
    }
  | { ok: false; reason: SlideshowRefusal };

/**
 * Decide whether this job can be rendered as a slideshow, and with what.
 *
 * Refusal order mirrors planRender deliberately, karaoke bed first, so the
 * pipeline's next-action line and its buttons cannot disagree.
 *
 * A single cover is not a special case here: it plans one segment spanning the
 * whole song, which is exactly what the existing single-image path renders.
 */
export function planSlideshow(
  job: MasterJob,
  covers: readonly SlideshowCover[] | null | undefined,
  durationSec: number | null | undefined,
  height: number = DEFAULT_VIDEO_HEIGHT,
): SlideshowPlan {
  if (isPeakMaster(job)) return { ok: false, reason: 'karaoke-bed' };
  if (job.status !== 'done') return { ok: false, reason: 'not-done' };
  if (!job.savedAt) return { ok: false, reason: 'not-saved' };
  if (!job.masterKey) return { ok: false, reason: 'no-master' };
  if (!VIDEO_HEIGHTS.includes(height as VideoHeight)) return { ok: false, reason: 'bad-height' };

  const timed = planSegments(covers, durationSec);
  if (!timed.ok) return timed;

  const h = height as VideoHeight;
  return {
    ok: true,
    audioKey: job.masterKey,
    height: h,
    // ⚠️ The same key shape as a single-image render. isRenderedVideoKey and the
    // library's Video button both match on it; a `-slideshow-` variant would be
    // invisible to them.
    videoKey: videoKeyFor(job.masterKey, h),
    segments: timed.segments,
  };
}

export type SegmentPlan =
  | { ok: true; segments: PlannedSegment[] }
  | { ok: false; reason: SlideshowRefusal };

/**
 * The timing half of planSlideshow, without the job.
 *
 * Split out because the WORKER re-derives the segments itself rather than
 * trusting the event — its role can read and write the whole bucket, and the
 * route is not the only thing that can invoke it — but it has no MasterJob
 * entity to hand, only the keys and the duration it probed from the WAV. Two
 * copies of this arithmetic is how a cut ends up in a different place in the
 * preview than in the render.
 *
 * ⚠️ THE DURATION IS REQUIRED and is what makes the last segment possible: the
 * operator supplies cut POINTS, never the final stretch's length. Without it the
 * join's `-shortest` would decide the ending by accident — truncating the song
 * or freezing on the last image.
 */
export function planSegments(
  covers: readonly SlideshowCover[] | null | undefined,
  durationSec: number | null | undefined,
): SegmentPlan {
  if (!covers || covers.length === 0) return { ok: false, reason: 'no-cover' };
  if (covers.length > MAX_SLIDESHOW_COVERS) return { ok: false, reason: 'too-many-covers' };
  for (const c of covers) {
    if (!c?.coverKey) return { ok: false, reason: 'no-cover' };
    // The worker's role can reach the entire bucket, so every key in the list
    // gets the same workspace guard — not just the first.
    if (!isMasteringKey(c.coverKey)) return { ok: false, reason: 'bad-cover' };
  }
  if (typeof durationSec !== 'number' || !Number.isFinite(durationSec) || durationSec <= 0) {
    return { ok: false, reason: 'no-duration' };
  }

  // The first image opens the video. Anything else leaves the opening seconds
  // with nothing to show.
  if (covers[0].startSec !== 0) return { ok: false, reason: 'cuts-out-of-order' };
  for (let i = 1; i < covers.length; i += 1) {
    const at = covers[i].startSec;
    if (!Number.isFinite(at) || at <= covers[i - 1].startSec) {
      return { ok: false, reason: 'cuts-out-of-order' };
    }
  }
  if (covers[covers.length - 1].startSec >= durationSec) return { ok: false, reason: 'cut-past-end' };

  const segments: PlannedSegment[] = covers.map((c, i) => ({
    coverKey: c.coverKey,
    startSec: c.startSec,
    // The final stretch runs to the end of the song — computed, never supplied.
    seconds: (i + 1 < covers.length ? covers[i + 1].startSec : durationSec) - c.startSec,
  }));
  if (segments.some((s) => s.seconds < MIN_SEGMENT_SECONDS)) {
    return { ok: false, reason: 'segment-too-short' };
  }
  return { ok: true, segments };
}

/** Operator-facing wording. Says what to DO wherever there is something. */
export function slideshowRefusalMessage(reason: SlideshowRefusal): string {
  switch (reason) {
    case 'no-duration':
      return 'The length of this master is unknown, so the last image has no end.';
    case 'too-many-covers':
      return `Use at most ${MAX_SLIDESHOW_COVERS} images.`;
    case 'cuts-out-of-order':
      return 'Image times must start at 0:00 and increase.';
    case 'cut-past-end':
      return 'An image starts after the song ends.';
    case 'segment-too-short':
      return `Every image needs at least ${MIN_SEGMENT_SECONDS} seconds on screen.`;
    default:
      return renderRefusalMessage(reason);
  }
}

/**
 * STEP 2 of 4 — encode ONE segment from its already-composed frame. Video only.
 *
 * ⚠️ THERE MUST BE NO `-filter_complex` HERE either. The warning on
 * buildVideoArgs applies to this builder identically — it is the same encode,
 * split by time — and it has its own test pinning the absence, because the test
 * on buildVideoArgs cannot see this path.
 *
 * Encoder flags are the single-image flags verbatim. They have to be: the
 * segments are concatenated with a stream copy at step 3, which is only valid
 * while every segment shares its codec parameters.
 *
 * `-t` rather than `-shortest`: there is no audio here to end the video, so the
 * looped frame would otherwise run forever.
 */
export function buildSegmentArgs(params: {
  framePath: string;
  seconds: number;
  outPath: string;
}): string[] {
  return [
    '-hide_banner', '-nostats',
    '-loop', '1', '-framerate', String(VIDEO_FPS), '-t', String(params.seconds), '-i', params.framePath,
    '-map', '0:v',
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage',
    '-crf', String(VIDEO_CRF), '-g', String(VIDEO_GOP), '-keyint_min', String(VIDEO_FPS),
    '-pix_fmt', 'yuv420p', '-r', String(VIDEO_FPS),
    // No audio in a segment: it is muxed once, whole, at step 4.
    '-an',
    '-y', params.outPath,
  ];
}

/**
 * The concat demuxer's list file.
 *
 * ffmpeg's own escaping: a single quote inside a quoted path closes it, so it
 * is written as '\'' — quote, escaped quote, quote. Worker paths never contain
 * one, which is exactly why it would go unnoticed if they ever did.
 */
export function buildConcatList(segmentPaths: readonly string[]): string {
  return segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n';
}

/**
 * STEP 3 of 3 — join the segments and lay the full-length master audio over
 * them, in ONE pass.
 *
 * ONE pass rather than a concat followed by a mux: the concat demuxer is an
 * input like any other, so the audio comes in beside it. That saves an
 * intermediate file the size of the finished video and a second read of it —
 * worth having, but measured at only 1.4 s. The step's real cost is the audio.
 *
 * ⚠️ THERE MUST BE NO `-filter_complex` HERE either, and `-c:v copy` is what
 * keeps the PICTURE free: it was finished at step 2 and is never touched
 * again — 0.65 s to concatenate 60 s of video, against 132 s to encode it. Each segment already opens on a keyframe (x264 always starts
 * with an IDR), so the cuts land exactly where the plan put them with no
 * re-encode at the seams.
 *
 * `+genpts` rebuilds presentation timestamps across the joins rather than
 * trusting each segment's own, which restart at zero. It is an INPUT option and
 * belongs to the concat input, not the audio.
 *
 * The audio is encoded here, once, in one continuous pass — never per segment,
 * which would put a codec seam at every cut, mid-song.
 */
export function buildJoinArgs(params: {
  listPath: string;
  audioPath: string;
  outPath: string;
}): string[] {
  return [
    '-hide_banner', '-nostats',
    '-fflags', '+genpts',
    '-f', 'concat', '-safe', '0', '-i', params.listPath,
    '-i', params.audioPath,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', VIDEO_AUDIO_BITRATE, '-ar', String(VIDEO_SAMPLE_RATE),
    '-movflags', '+faststart',
    // The segments already total the song's length, so this only guards against
    // a rounding difference at the very end.
    '-shortest',
    '-y', params.outPath,
  ];
}
