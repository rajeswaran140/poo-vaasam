/**
 * The Video Text render plan. Pure: no AWS, no spawning.
 *
 * The browser draws every text block (title, lyric lines, credits) to a
 * transparent PNG at the video's exact pixel size. The server only lays those
 * images over the uploaded video at their times. Encoding a whole song frame
 * by frame does not fit one Lambda, so the work is split:
 *
 *   1. SEGMENT: cut the source's video stream by stream copy into segments of
 *      about SEGMENT_TARGET_SEC. The segment muxer can only cut on keyframes,
 *      so a segment may run longer than the target when the source's GOP is
 *      long, and the cut times come back in the csv list (parseSegmentList).
 *   2. CHUNK: re-encode each segment in its own Lambda with the PNGs that
 *      intersect it overlaid (overlaysForSegment, buildChunkArgs). Video only.
 *   3. JOIN: concatenate the chunks by stream copy and lay the ORIGINAL audio
 *      under them, copied packet for packet (buildJoinMuxArgs). The audio is
 *      never decoded, so the song is bit-identical; buildAudioHashArgs proves it.
 */

import { VIDEO_CRF } from '@/lib/master-video';

/**
 * Target segment length. A 1440p chunk's encode must take at most 40% of the
 * chunk function's 300 s timeout (≤ 120 s), leaving room for download, upload
 * and a keyframe-cut segment that runs past the target.
 *
 * Lambda figure (the binding one; dev-box CPU is not the Lambda's): one 15 s
 * clip encoded at 1440p took 73 s on the 3008 MB (≈2 vCPU) Lambda with the
 * layer's ffmpeg 7.0.2 — about 4.9 s per second of 1440p video, scaling
 * included. 120 / 4.9 ≈ 24 s is the ceiling; 20 s leaves margin.
 *
 * Dev box (2-core EPYC 7763), measured 2026-11-07 with the layer's 7.0.2
 * binary on a real 5:07 1440p render (10 fps, keyframe every 10 s), via
 * scripts/bench-video-text.ts. Wall seconds per second of video, one 20 s
 * segment, best of 2:
 *
 *            plain    3 overlapping overlays    8 lyric lines
 *   1440p    0.228    0.246 (+8%)               0.269 (+18%)
 *   1080p    0.113    0.131 (+16%)              0.146 (+29%)
 *
 * (This source is a still picture, so the plain encode is unusually cheap and
 * the overlay share is at its largest; on a moving 30 fps 1440p test clip the
 * 8-overlay cost was within noise of plain.) At 1440p the overlays add at
 * most 18%, under the 20% line, so the target stays at 20 s: projected on the
 * Lambda, 20 × 4.9 ≈ 98 s plus a few seconds of overlay blending, inside 120 s.
 * The same run proved: audio packets bit-identical source → output; 3074 of
 * 3074 frames, constant step across all 15 joins, zero drift; a block
 * crossing a cut present on the frames either side of it.
 */
export const SEGMENT_TARGET_SEC = 20;

/** Same quality as every other render here (VIDEO_CRF in master-video.ts). */
export const CHUNK_CRF = VIDEO_CRF;
/** Same preset as every other render here: a slower one is what does not fit. */
export const CHUNK_PRESET = 'veryfast';

export interface SegmentEntry {
  file: string;
  startSec: number;
  endSec: number;
}

/**
 * Read the segment muxer's `-segment_list_type csv` output: one
 * `file,start,end` line per segment, times in seconds of the source. Throws on
 * a malformed line — a dropped segment would silently cut a piece out of the
 * video.
 */
export function parseSegmentList(csv: string): SegmentEntry[] {
  const out: SegmentEntry[] = [];
  for (const raw of csv.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(',');
    const startSec = Number(parts[1]);
    const endSec = Number(parts[2]);
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2] || !Number.isFinite(startSec) || !Number.isFinite(endSec)) {
      throw new Error(`Unreadable segment list line: ${JSON.stringify(line)}`);
    }
    out.push({ file: parts[0], startSec, endSec });
  }
  return out;
}

/**
 * STEP 1 — cut the source's video into keyframe-aligned segments by stream
 * copy. Each segment starts at time 0 and the csv list holds the cut times in
 * the source's presentation time, which is what the blocks are timed in. Audio is left out: it is extracted separately (buildAudioExtractArgs)
 * and only rejoins at the end.
 */
export function buildSegmentArgs(srcPath: string, outPattern: string, listPath: string, targetSec: number): string[] {
  return [
    '-hide_banner', '-nostats',
    '-i', srcPath,
    '-map', '0:v:0',
    '-c', 'copy',
    // Keep the source's own timestamps. The default shifts a B-frame source's
    // negative start DTS to zero, which moves every cut time in the csv list
    // (and segment 0's frames) late by the B-frame delay — measured +0.2 s
    // (2 frames) on a real 10 fps render — so every block would burn in early.
    '-avoid_negative_ts', 'disabled',
    '-f', 'segment',
    '-segment_time', String(targetSec),
    '-reset_timestamps', '1',
    '-segment_list', listPath,
    '-segment_list_type', 'csv',
    '-y', outPattern,
  ];
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The blocks that show during a segment, with times relative to the segment's
 * start and clipped to [0, segment length], rounded to 1 ms so float noise
 * (19.96 - 14.92 = 5.040000000000001) never reaches an `enable=` expression.
 * A block that only touches the segment's edge is left out. A block crossing
 * a cut is listed in both segments, so it shows on both sides of the join.
 */
export function overlaysForSegment(
  blocks: { id: string; startSec: number; endSec: number }[],
  seg: { startSec: number; endSec: number },
): { id: string; fromSec: number; toSec: number }[] {
  const len = seg.endSec - seg.startSec;
  const out: { id: string; fromSec: number; toSec: number }[] = [];
  for (const b of blocks) {
    const fromSec = r3(Math.max(0, b.startSec - seg.startSec));
    const toSec = r3(Math.min(len, b.endSec - seg.startSec));
    if (toSec > fromSec) out.push({ id: b.id, fromSec, toSec });
  }
  return out;
}

/**
 * STEP 2 — one chunk: the segment with its PNGs overlaid, re-encoded, video
 * only. Each PNG is read ONCE, as a single-frame input, and `eof_action=repeat`
 * holds that frame for the rest of the segment; the chain ends with input 0.
 *
 * Not `-loop 1`: a looped image is re-decoded at image2's default 25 fps for
 * every overlay, all segment long. Measured 2026-11-07 on the layer's 7.0.2,
 * a 20 s 1440p segment with 8 lyric-sized overlays: plain 4.3 s, single-frame
 * 5.4 s, `-framerate 1 -loop 1` 14.4 s, `-loop 1` 157 s. And no `shortest=1`:
 * with a one-frame overlay input it would end the chunk after one frame.
 *
 * The frame timing is passed through untouched so the joined video has the
 * source's frames. With no overlays the segment is re-encoded the same way,
 * so every chunk shares one set of encoder parameters and the join can
 * stream-copy. `width`/`height` are not used in the args: the PNGs are drawn
 * at the video's exact size, so `overlay=0:0` needs no scaling. They are kept
 * so a caller states the frame size the PNGs must match.
 */
export function buildChunkArgs(params: {
  segPath: string;
  overlays: { path: string; fromSec: number; toSec: number }[];
  width: number;
  height: number;
  outPath: string;
  crf: number;
  preset: string;
}): string[] {
  const { segPath, overlays, outPath, crf, preset } = params;
  const inputs = ['-i', segPath, ...overlays.flatMap((o) => ['-i', o.path])];
  let graph: string[] = ['-map', '0:v:0'];
  if (overlays.length > 0) {
    const steps = overlays.map((o, i) => {
      const from = i === 0 ? '[0:v]' : `[v${i}]`;
      return `${from}[${i + 1}:v]overlay=0:0:enable='between(t,${o.fromSec},${o.toSec})':eof_action=repeat[v${i + 1}]`;
    });
    graph = ['-filter_complex', steps.join(';'), '-map', `[v${overlays.length}]`];
  }
  return [
    '-hide_banner', '-nostats',
    ...inputs,
    ...graph,
    '-an',
    '-c:v', 'libx264', '-preset', preset, '-crf', String(crf),
    '-pix_fmt', 'yuv420p',
    '-fps_mode', 'passthrough',
    '-y', outPath,
  ];
}

/**
 * STEP 3 — join the chunks by stream copy and lay the original audio under
 * them, copied. `srcPath` is whatever holds that audio: usually the small
 * audio-only file from buildAudioExtractArgs (the big source is deleted
 * before the chunks come back), or the full source; `-map 1:a:0` reads the
 * first audio stream of either. No `-shortest`: it would trim the song to the
 * video's last frame.
 */
export function buildJoinMuxArgs(params: {
  concatListPath: string;
  srcPath: string;
  outPath: string;
  hasAudio: boolean;
}): string[] {
  const { concatListPath, srcPath, outPath, hasAudio } = params;
  return [
    '-hide_banner', '-nostats',
    '-f', 'concat', '-safe', '0', '-i', concatListPath,
    ...(hasAudio ? ['-i', srcPath] : []),
    '-map', '0:v:0',
    ...(hasAudio ? ['-map', '1:a:0'] : []),
    '-c', 'copy',
    '-movflags', '+faststart',
    '-y', outPath,
  ];
}

/** sha256 of the first audio stream's packets, printed to stdout. No decode. */
export function buildAudioHashArgs(path: string): string[] {
  return ['-hide_banner', '-nostats', '-i', path, '-map', '0:a:0', '-c', 'copy', '-f', 'streamhash', '-hash', 'sha256', '-'];
}

/**
 * Copy the source's first audio stream to its own small file, untouched, so
 * the big source can be deleted while the chunks encode. Give `outPath` a
 * `.mka` extension: Matroska takes any codec by stream copy.
 */
export function buildAudioExtractArgs(srcPath: string, outPath: string): string[] {
  return ['-hide_banner', '-nostats', '-i', srcPath, '-map', '0:a:0', '-c', 'copy', '-y', outPath];
}
