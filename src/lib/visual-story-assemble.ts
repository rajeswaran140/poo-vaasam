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
import { MAX_OWN_CLIP_SEC, MAX_SHOT_SEC, MIN_SHOT_SEC, isTenth, type AspectRatio } from '@/types/visualStory';
import { MIN_PLAYBACK_RATE } from '@/lib/visual-story-clip-fit';

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
  /** A made clip a little short of its row plays this much slower (0.88–1, visual-story-clip-fit.ts). */
  playbackRate?: number;
}

/** "Scene 2, shot 3" — how a failure names the shot it happened on. */
export function shotLabel(s: Pick<AssemblyShot, 'sceneOrder' | 'shotOrder'>): string {
  return `Scene ${s.sceneOrder}, shot ${s.shotOrder}`;
}

/**
 * Shots whose chosen item is a picture although a clip exists for them, by
 * label in story order — so the render panel can say a clip that was paid
 * for is not in the video (the admin may want the picture; it is a note).
 */
export function shotsShowingPictureWithClip(
  shots: { sceneOrder: number; shotOrder: number; selectedCandidateId: string | null }[],
  candidates: { candId: string; sceneOrder: number; shotOrder: number; s3Key: string }[]
): string[] {
  const on = (s: { sceneOrder: number; shotOrder: number }) => (c: { sceneOrder: number; shotOrder: number }) =>
    c.sceneOrder === s.sceneOrder && c.shotOrder === s.shotOrder;
  return [...shots]
    .sort((a, b) => a.sceneOrder - b.sceneOrder || a.shotOrder - b.shotOrder)
    .filter((s) => {
      const chosen = s.selectedCandidateId ? candidates.find((c) => c.candId === s.selectedCandidateId) : undefined;
      if (!chosen || assemblyKindOf(chosen.s3Key) !== 'still') return false;
      return candidates.some((c) => on(s)(c) && assemblyKindOf(c.s3Key) === 'clip');
    })
    .map(shotLabel);
}

/**
 * Each shot's frame count, from the running total of row seconds: shot i
 * covers round(start_i × 25) to round(end_i × 25). Rows are in tenths, which
 * are not whole frames; rounding each row alone would drift off the song.
 */
export function segmentFrames(durations: readonly number[]): number[] {
  // In whole hundredths: a float running total drifts (43.1 × 25 comes out 1077.4999…).
  let centis = 0;
  let at = 0;
  return durations.map((d) => {
    centis += Math.round(d * 100);
    const end = Math.round((centis * ASSEMBLE_FPS) / 100);
    const n = Math.max(1, end - at);
    at += n;
    return n;
  });
}

/** Why the worker refuses one shot of the event, or null. Re-checked there, not trusted from the route. */
export function assemblyShotProblem(sh: AssemblyShot): string | null {
  const maxSec = assemblyKindOf(sh.key) === 'clip' ? MAX_OWN_CLIP_SEC : MAX_SHOT_SEC;
  if (!Number.isFinite(sh.durationSec) || !isTenth(sh.durationSec) || sh.durationSec < MIN_SHOT_SEC || sh.durationSec > maxSec) {
    return `${shotLabel(sh)} has a length this renderer does not accept.`;
  }
  if (sh.playbackRate !== undefined) {
    const r = sh.playbackRate;
    if (typeof r !== 'number' || !Number.isFinite(r) || r < MIN_PLAYBACK_RATE || r >= 1 || assemblyKindOf(sh.key) !== 'clip') {
      return `${shotLabel(sh)} has a speed this renderer does not accept.`;
    }
  }
  return null;
}

/** A clip segment: exactly `frames` frames, sound dropped, slowed by playbackRate when given. */
export function buildClipSegmentArgs(params: {
  srcPath: string;
  outPath: string;
  frames: number;
  playbackRate?: number;
  aspect: AspectRatio;
}): string[] {
  const { width, height } = assembleFrameSize(params.aspect);
  const frames = params.frames;
  const seconds = Math.round((frames / ASSEMBLE_FPS) * 1000) / 1000;
  const slow = params.playbackRate !== undefined && params.playbackRate < 1 ? `setpts=PTS/${params.playbackRate},` : '';
  return [
    '-hide_banner', '-nostats',
    '-i', params.srcPath,
    '-an', '-sn', '-dn',
    '-vf',
    `scale=trunc(iw*sar/2)*2:ih,setsar=1,${slow}fps=${ASSEMBLE_FPS},` +
      `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,` +
      // A clip a second short (Grok rounds) holds its last frame rather than
      // shortening the video under the song.
      `tpad=stop_mode=clone:stop_duration=${seconds}`,
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

/**
 * How much of the song's real ending a whole-second window leaves out: a
 * story covers whole seconds, so a 4:00.70 song's whole-song story ends at
 * 4:00 and lost its last 0.7 s (plus a fade). The worker holds the last shot
 * that much longer and plays the song to its end. 0 for an excerpt (a window
 * ending a second or more before the song) or an unknown length.
 */
export function assembleTailSec(params: { windowEndSec: number; songSec: number | null }): number {
  if (params.songSec === null) return 0;
  const gap = params.songSec - params.windowEndSec;
  return gap > 0 && gap < 1 ? Math.round(gap * 1000) / 1000 : 0;
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

export function estimateAssembleSec(shots: ReadonlyArray<{ key: string; durationSec: number; playbackRate?: number }>): number {
  let total = 0;
  for (const s of shots) {
    const kind = assemblyKindOf(s.key);
    total += ASSEMBLE_COST.perShotSec + s.durationSec * (kind === 'clip' ? ASSEMBLE_COST.clipPerSec : ASSEMBLE_COST.stillPerSec);
    // A slowed clip re-times more frames than it had.
    if (kind === 'clip' && s.playbackRate) total += s.durationSec * (1 / s.playbackRate - 1) * ASSEMBLE_COST.clipPerSec;
    total += s.durationSec * ASSEMBLE_COST.joinPerSec;
  }
  return Math.round(total);
}
