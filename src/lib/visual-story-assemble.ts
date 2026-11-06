/**
 * Visual Story Studio — ASSEMBLY (Phase 6, spec §7.4). Pure ffmpeg arg
 * builders and the render-time estimate; no AWS, no spawning, client-safe.
 *
 * A render joins every shot's chosen picture or clip, in timeline order, over
 * the story's window of the master. Shape, worked out once per shot so the
 * worker holds one shot's files at a time:
 *
 *   clip  → drop its sound, 25 fps, fill-crop to the frame, hold its last
 *           frame if it is short, cut at exactly durationSec × 25 frames;
 *   still → compose like a cover (fill, or blurred backdrop when its shape
 *           differs) at MOTION_SOURCE_SCALE, then a slow zoom across the shot;
 *   join  → concat by stream copy beside the master's window, audio encoded
 *           once. Never `-shortest`: the frame counts already equal the window.
 *
 * ⚠️ ONE ENCODE RECIPE FOR EVERY SEGMENT (ASSEMBLE_CODEC_ARGS). The concat
 * demuxer copies packets; a segment with a different rate, pixel format or
 * profile breaks the join silently or with timestamp warnings.
 */

import { MOTION_SOURCE_SCALE, type ShortMotion } from '@/lib/master-short';
import type { AspectRatio } from '@/types/visualStory';

export const ASSEMBLE_FPS = 25;

/** The frame a story renders at. */
export function assembleFrameSize(aspect: AspectRatio): { width: number; height: number } {
  return aspect === '9:16' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
}

/**
 * Shared by every clip and still segment. crf 18: between the still video's
 * 16 and the Short's 20 — AI clips carry no fine grain worth more bits.
 */
export const ASSEMBLE_CODEC_ARGS: readonly string[] = [
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
  '-pix_fmt', 'yuv420p', '-r', String(ASSEMBLE_FPS), '-g', String(ASSEMBLE_FPS * 2),
  '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
];

/** What a chosen candidate is, by its stored extension — not by the shot's mode. */
export type AssemblyKind = 'clip' | 'still';

export function assemblyKindOf(key: string): AssemblyKind | null {
  const ext = key.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase();
  if (ext === '.mp4') return 'clip';
  if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') return 'still';
  return null;
}

/**
 * A key the worker may read for this story: one of ITS candidates, with an
 * extension assembly knows. The worker's role reaches the whole mastering
 * workspace, so this is checked again there rather than trusted.
 */
export function isAssemblyShotKey(key: unknown, vsId: string): key is string {
  if (typeof key !== 'string' || key.length > 1024 || key.includes('..')) return false;
  const prefix = `audio/mastering/visual-story/${vsId}/candidates/`;
  return key.startsWith(prefix) && key.length > prefix.length && assemblyKindOf(key) !== null;
}

/** One shot of the timeline, as the route sends it and the worker renders it. */
export interface AssemblyShot {
  sceneOrder: number;
  shotOrder: number;
  key: string;
  durationSec: number;
}

/** "Scene 2, shot 3" — how a failure names the shot it happened on. */
export function shotLabel(s: Pick<AssemblyShot, 'sceneOrder' | 'shotOrder'>): string {
  return `Scene ${s.sceneOrder}, shot ${s.shotOrder}`;
}

/** A clip segment: exactly durationSec × 25 frames, sound dropped. */
export function buildClipSegmentArgs(params: {
  srcPath: string;
  outPath: string;
  durationSec: number;
  aspect: AspectRatio;
}): string[] {
  const { width, height } = assembleFrameSize(params.aspect);
  const frames = Math.round(params.durationSec * ASSEMBLE_FPS);
  return [
    '-hide_banner', '-nostats',
    '-i', params.srcPath,
    '-an', '-sn', '-dn',
    '-vf',
    `scale=trunc(iw*sar/2)*2:ih,setsar=1,fps=${ASSEMBLE_FPS},` +
      `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,` +
      // A clip a second short (Grok rounds) holds its last frame rather than
      // shortening the video under the song.
      `tpad=stop_mode=clone:stop_duration=${params.durationSec}`,
    '-frames:v', String(frames),
    ...ASSEMBLE_CODEC_ARGS,
    '-y', params.outPath,
  ];
}

/** Stills alternate in and out, so a run of them does not keep diving forward. */
export function stillMotionFor(index: number): Exclude<ShortMotion, 'none'> {
  return index % 2 === 0 ? 'zoom-in' : 'zoom-out';
}

/**
 * A still's RGB frame converted with the BT.709 matrix the segments are tagged
 * with, BEFORE the zoom. Left to the encoder, swscale uses BT.601 and the
 * picture's colours shift beside the clips (measured 23.9 dB against the
 * source, 35.5 dB converted). Before the move it runs once on the one input
 * frame (15 s of zoom: 14.3 s, same as unconverted); after it, on every
 * output frame (41 s).
 */
export const STILL_TO_BT709 = 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p';

/** The compose step enlarges the frame this much so the zoom moves smoothly. */
export const STILL_SOURCE_SCALE = MOTION_SOURCE_SCALE;

export function buildAssembleConcatList(paths: readonly string[]): string {
  return paths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n';
}

export const ASSEMBLE_FADE_IN_SEC = 0.6;
export const ASSEMBLE_FADE_OUT_SEC = 3;

/**
 * The fades a window gets. An excerpt fades in and out like a Short; a window
 * that starts at the song's start or ends at its end must not — a fade there
 * would cut into the first note or the song's own ending.
 */
export function assembleFades(params: {
  windowStartSec: number;
  windowEndSec: number;
  /** The master's probed length; null ⇒ unknown, treat the window as an excerpt. */
  songSec: number | null;
}): { fadeIn: boolean; fadeOut: boolean } {
  const fadeIn = params.windowStartSec > 0;
  const fadeOut = params.songSec === null || params.windowEndSec < params.songSec - 0.5;
  return { fadeIn, fadeOut };
}

/** Join the segments by copy and lay the master's window under them. */
export function buildAssembleJoinArgs(params: {
  listPath: string;
  audioPath: string;
  outPath: string;
  windowStartSec: number;
  windowSec: number;
  fadeIn: boolean;
  fadeOut: boolean;
}): string[] {
  const fades = [
    ...(params.fadeIn ? [`afade=t=in:st=0:d=${ASSEMBLE_FADE_IN_SEC}`] : []),
    ...(params.fadeOut
      ? [`afade=t=out:st=${(params.windowSec - ASSEMBLE_FADE_OUT_SEC).toFixed(3)}:d=${ASSEMBLE_FADE_OUT_SEC}`]
      : []),
  ];
  return [
    '-hide_banner', '-nostats',
    '-fflags', '+genpts',
    '-f', 'concat', '-safe', '0', '-i', params.listPath,
    '-ss', params.windowStartSec.toFixed(3), '-t', String(params.windowSec), '-i', params.audioPath,
    '-map', '0:v', '-map', '1:a',
    ...(fades.length ? ['-af', fades.join(',')] : []),
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '384k', '-ar', '48000',
    '-movflags', '+faststart',
    '-y', params.outPath,
  ];
}

/**
 * Seconds of worker time a render will take, from the shot list. Measured
 * 2026-11-06 on the layer's ffmpeg 7.0.2 by scripts/verify-assemble.ts (2
 * cores, like the 3008 MB Lambda): a minute of 1080p clip 35 s (0.58/s), a
 * minute of zoomed still 59 s (0.99/s), a 1 s still shot 1.9 s (the 4x
 * compose is the fixed part), joining 30 s 5.5 s. Rounded up, with download,
 * verification and upload folded into perShotSec and joinPerSec.
 */
export const ASSEMBLE_COST = {
  /** Download + spawn + container overhead, per shot. */
  perShotSec: 1.5,
  /** Per second of 16:9 output, by kind. 9:16 has the same pixel count. */
  clipPerSec: 0.6,
  stillPerSec: 1.0,
  /** Join + audio encode + verification + upload, per second of window. */
  joinPerSec: 0.35,
} as const;

/**
 * The longest render the route will queue. 600 of the worker's 900 s until a
 * real all-pictures story has been timed on the Lambda: the costs above came
 * from synthetic fixtures on a 2-core box, and real AI pictures encode slower.
 */
export const MAX_ASSEMBLE_SEC = 600;

export function estimateAssembleSec(shots: ReadonlyArray<{ key: string; durationSec: number }>): number {
  let total = 0;
  for (const s of shots) {
    const kind = assemblyKindOf(s.key);
    total += ASSEMBLE_COST.perShotSec + s.durationSec * (kind === 'clip' ? ASSEMBLE_COST.clipPerSec : ASSEMBLE_COST.stillPerSec);
    total += s.durationSec * ASSEMBLE_COST.joinPerSec;
  }
  return Math.round(total);
}
