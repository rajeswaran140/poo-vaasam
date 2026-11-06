/**
 * A VIDEO BACKGROUND — a clip or GIF the operator uploads, looped under the
 * song in place of a still cover. Pure: no AWS, no spawning.
 *
 * Added 2026-11-06. The still renders are fast because every frame is the same
 * picture; a video background makes every frame different, and encoding it
 * frame by frame for the whole song costs 0.6-3.2x the song's length on the
 * Lambda's ffmpeg 7.0.2 (measured on this box with the layer's own binary,
 * 2 cores like the 3008 MB Lambda). So it is built the same way the still
 * render is — do the expensive part ONCE:
 *
 *   1. the LOOP: encode the clip itself (at most BACKGROUND_LOOP_MAX_SECONDS
 *      of it) to the finished frame size, through the SAME fill-or-backdrop
 *      filter a still cover gets;
 *   2. the TRACK: repeat that encoded loop by stream copy to the length of
 *      the song;
 *   3. the MUX: lay the audio under the track, encoded once.
 *
 * Measured 2026-11-06, a 5:01 song: loop 2-18 s, render 50-54 s, whatever the
 * source. A 10-minute song at 1440p from a deliberately noisy clip: 25 s +
 * 118 s and 1.3 GB, which is why the bitrate is capped (BACKGROUND_MAXRATE).
 * Rotated iPhone HEVC, VP9 WebM and an uneven-delay GIF all decoded with no
 * errors and no timestamp warnings at the joins.
 *
 * ⚠️ THE COVER STAYS. The job's `coverKey` is what becomes the YouTube
 * thumbnail; a background never replaces it. It travels as `backgroundKey`.
 */

import { isMasteringKey, masteringUploadKey } from '@/lib/mastering-storage';

/** What ffmpeg on the layer is known to decode for this. Phone video, web video, GIF. */
export const ACCEPTED_BACKGROUND_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'image/gif'] as const;

/** 200 MB: plenty for a loop, and well inside the worker's 4 GB of scratch disk. */
export const MAX_BACKGROUND_BYTES = 200 * 1024 * 1024;

/** The stored extension for an accepted background type. */
export function backgroundExtensionFor(contentType: string): string | null {
  switch (contentType) {
    case 'video/mp4': return '.mp4';
    case 'video/quicktime': return '.mov';
    case 'video/webm': return '.webm';
    case 'image/gif': return '.gif';
    default: return null;
  }
}

const BACKGROUND_EXTENSIONS = ['.mp4', '.mov', '.webm', '.gif'];

/** Same key rules as a cover — see masteringCoverKey — differing only in extension. */
export function masteringBackgroundKey(
  filename: string,
  contentType: string,
  now: number,
  nonce: string,
): string | null {
  const ext = backgroundExtensionFor(contentType);
  if (!ext) return null;
  return masteringUploadKey(filename, now, nonce).replace(/\.wav$/, ext);
}

/** An uploaded background: in the workspace, with one of our extensions. */
export function isBackgroundKey(key: unknown): key is string {
  if (typeof key !== 'string' || !isMasteringKey(key)) return false;
  const ext = key.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? '';
  return BACKGROUND_EXTENSIONS.includes(ext);
}

/**
 * Only this much of a longer clip is looped. It bounds the one expensive step
 * (the loop encode) whatever is uploaded: a minute of noisy 1440p is ~250 s.
 */
export const BACKGROUND_LOOP_MAX_SECONDS = 60;

/**
 * Longest song a background may run under — the same ten minutes the
 * whole-song vertical allows. Time is not the limit here (the render is a
 * stream copy); the FILE is: ten minutes at the capped rate is ~750 MB, and
 * the YouTube upload holds the whole file in memory.
 */
export const BACKGROUND_MAX_SONG_SECONDS = 600;

/** Motion-smooth, and the rate every moving render here already uses. */
export const BACKGROUND_FPS = 25;

/** 4K is not offered: its loop encode and its file size are both out of proportion. */
export const BACKGROUND_HEIGHTS = [1080, 1440] as const;

/**
 * Peak video bitrate for the loop. YouTube's own recommended upload rates for
 * SDR at 24-30 fps are 8 Mbps (1080p) and 16 Mbps (1440p); 1440p is held to
 * 10 so a ten-minute song stays near 750 MB. Without a cap, a grainy clip at
 * crf 16 measured 142 Mbps — a 5 GB file.
 */
export function backgroundMaxrateFor(height: number): string {
  return height >= 1440 ? '10M' : '8M';
}

export type BackgroundCheck = { ok: true } | { ok: false; message: string };

/**
 * Whether a render may use a background, and why not. Shared by the routes
 * (early, with the recorded length) and the worker (with the probed one).
 * Unknown length is not refused: the worker probes the file and asks again.
 */
export function checkBackground(params: {
  audioSeconds?: number | null;
  /** The 16:9 height; omit for the vertical renders. */
  height?: number;
  slideshow?: boolean;
  motion?: string | null;
}): BackgroundCheck {
  if (params.slideshow) {
    return { ok: false, message: 'A video background plays on its own — remove the extra slideshow images, or the background.' };
  }
  if (params.motion && params.motion !== 'none') {
    return { ok: false, message: 'A video background already moves — set Motion to None.' };
  }
  if (params.height !== undefined && !(BACKGROUND_HEIGHTS as readonly number[]).includes(params.height)) {
    return { ok: false, message: 'With a video background, choose 1080p or 1440p.' };
  }
  const secs = params.audioSeconds;
  if (typeof secs === 'number' && Number.isFinite(secs) && secs > BACKGROUND_MAX_SONG_SECONDS) {
    return {
      ok: false,
      message: `With a video background, songs up to ${BACKGROUND_MAX_SONG_SECONDS / 60} minutes can be rendered.`,
    };
  }
  return { ok: true };
}

/**
 * The clip's first frame as the viewer sees it — rotated by the file's display
 * matrix (ffmpeg autorotates on decode) and with non-square pixels squared —
 * so the existing aspect probe reads the shape that will be on screen. Reading
 * the header instead gets a portrait phone video wrong: it prints the coded
 * 1920x1080 and a separate rotation line.
 */
export function buildBackgroundFirstFrameArgs(srcPath: string, framePath: string): string[] {
  return [
    '-hide_banner', '-nostats',
    '-i', srcPath,
    '-frames:v', '1',
    '-vf', 'scale=trunc(iw*sar/2)*2:ih,setsar=1',
    '-y', framePath,
  ];
}

/**
 * Turn a still cover's compose graph (buildVideoFilter / buildShortFrameFilter)
 * into one for a moving source. The still graph reads `[0:v]` once (fill) or
 * twice (backdrop); an input pad may be read twice, but the squaring and the
 * frame-rate change must happen first, and a filter's output label only once —
 * so the source is normalised and then split for each reader.
 */
export function backgroundFilterFrom(stillFilter: string): string {
  const reads = stillFilter.split('[0:v]').length - 1;
  const head = `[0:v]scale=trunc(iw*sar/2)*2:ih,setsar=1,fps=${BACKGROUND_FPS}`;
  if (reads <= 1) return stillFilter.replace('[0:v]', `${head},`);
  const labels = Array.from({ length: reads }, (_, i) => `[bgsrc${i}]`);
  let i = 0;
  const body = stillFilter.replace(/\[0:v\]/g, () => labels[i++]);
  return `${head},split=${reads}${labels.join('')};${body}`;
}

/** STEP 1 of 3 — encode the loop once, video only, at the finished frame size. */
export function buildBackgroundLoopArgs(params: {
  srcPath: string;
  outPath: string;
  /** From backgroundFilterFrom. */
  filter: string;
  crf: number;
  maxrate: string;
}): string[] {
  const bufsize = `${parseInt(params.maxrate, 10) * 2}M`;
  return [
    '-hide_banner', '-nostats',
    // Bounds the one expensive step whatever was uploaded.
    '-t', String(BACKGROUND_LOOP_MAX_SECONDS),
    '-i', params.srcPath,
    '-an', '-sn', '-dn',
    '-filter_complex', params.filter,
    '-map', '[v]',
    '-c:v', 'libx264', '-preset', 'veryfast',
    '-crf', String(params.crf), '-maxrate', params.maxrate, '-bufsize', bufsize,
    '-pix_fmt', 'yuv420p', '-r', String(BACKGROUND_FPS), '-g', String(BACKGROUND_FPS * 2),
    '-y', params.outPath,
  ];
}

/**
 * STEP 2 of 3 — repeat the loop to the song's length, video only, by stream
 * copy.
 *
 * ⚠️ HOW THE PICTURE ENDS. `-stream_loop -1` never ends on its own, and `-t`
 * on the looped input overshoots by up to a GOP of copied packets (measured
 * +0.11 s). So it is bounded by FRAME COUNT, floored: it ends within one frame
 * BEFORE the song (125.36 s against 125.37 s).
 *
 * ⚠️ WHY THIS IS ITS OWN PASS. Done in the same pass as the audio, the output
 * ends when the video's frame limit is reached and can take the song's last
 * AAC frame with it — measured on 7.0.2 with a WebM source: 21 ms of the song
 * lost, while the same pass over a MOV lost nothing. A finite track joined to
 * the whole audio in step 3 is the shape buildJoinArgs already ships.
 */
export function buildBackgroundTrackArgs(params: {
  loopPath: string;
  outPath: string;
  seconds: number;
}): string[] {
  return [
    '-hide_banner', '-nostats',
    '-stream_loop', '-1', '-i', params.loopPath,
    '-map', '0:v', '-c:v', 'copy',
    '-frames:v', String(Math.floor(params.seconds * BACKGROUND_FPS)),
    '-y', params.outPath,
  ];
}

/**
 * STEP 3 of 3 — lay the audio under the finished track. Video by copy; the
 * audio encoded once, exactly as the still render of the same kind encodes it.
 *
 * `-shortest` is never passed with a finite track — it could only ever trim
 * the song (see buildVideoArgs). The ONE exception is an unknown song length:
 * then there is no track (step 2 needs a length), the loop itself is the
 * input, and `-shortest` is what ends it, because the alternative is a render
 * that never finishes.
 */
export function buildBackgroundMuxArgs(params: {
  /** The step-2 track — or, with `loop`, the step-1 loop itself. */
  videoPath: string;
  /** Unknown song length: loop `videoPath` and end with the audio. */
  loop?: boolean;
  audioPath: string;
  outPath: string;
  /** A clip: seek and bound the audio, as buildShortArgs does. */
  window?: { startSec: number; seconds: number };
  /** `-af` for the audio, if the render of this kind fades it. */
  audioFilter?: string;
  audioBitrate: string;
}): string[] {
  return [
    '-hide_banner', '-nostats',
    ...(params.loop ? ['-stream_loop', '-1'] : []),
    '-i', params.videoPath,
    ...(params.window ? ['-ss', params.window.startSec.toFixed(3), '-t', String(params.window.seconds)] : []),
    '-i', params.audioPath,
    '-map', '0:v', '-map', '1:a',
    ...(params.audioFilter ? ['-af', params.audioFilter] : []),
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', params.audioBitrate, '-ar', '48000',
    '-movflags', '+faststart',
    ...(params.loop ? ['-shortest'] : []),
    '-y', params.outPath,
  ];
}
