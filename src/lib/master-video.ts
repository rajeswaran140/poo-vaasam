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
 * The filter graph: the cover blurred to fill the frame, with the artwork itself
 * centred at native aspect on top.
 *
 * Same shape as the Shorts pipeline's, which is proven on this ffmpeg build —
 * a blurred fill rather than pillarbox bars, because a square cover in a 16:9
 * frame otherwise leaves two black slabs that read as a broken upload.
 */
export function buildVideoFilter(height: VideoHeight): string {
  const width = videoWidthFor(height);
  // The artwork occupies most of the frame height, leaving a margin so the blur
  // is visibly a backdrop rather than a border artefact.
  const art = Math.round(height * 0.82);
  return (
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height},boxblur=24:4,eq=brightness=-0.06[bg];` +
    `[0:v]scale=${art}:${art}:force_original_aspect_ratio=decrease[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2[v]`
  );
}

/**
 * STEP 1 of 2 — compose the finished frame ONCE, to a PNG.
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
}): string[] {
  const height = params.height ?? DEFAULT_VIDEO_HEIGHT;
  return [
    '-hide_banner', '-nostats',
    '-i', params.coverPath,
    '-filter_complex', buildVideoFilter(height),
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
 * `-shortest` ends the video with the audio: the frame is looped indefinitely,
 * so without it the encode never terminates.
 */
export function buildVideoArgs(params: {
  framePath: string;
  audioPath: string;
  outPath: string;
}): string[] {
  return [
    '-hide_banner', '-nostats',
    '-loop', '1', '-framerate', String(VIDEO_FPS), '-i', params.framePath,
    '-i', params.audioPath,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage',
    '-pix_fmt', 'yuv420p', '-r', String(VIDEO_FPS),
    '-c:a', 'aac', '-b:a', VIDEO_AUDIO_BITRATE, '-ar', String(VIDEO_SAMPLE_RATE),
    // faststart moves the index to the front so YouTube can begin processing
    // without reading the whole file first.
    '-movflags', '+faststart',
    '-shortest',
    '-y', params.outPath,
  ];
}
