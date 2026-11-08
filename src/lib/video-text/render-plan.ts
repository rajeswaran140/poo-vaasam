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
import type { Cut } from '@/types/videoText';

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

/**
 * Segment sizing by how heavy the video is (audit 2026-11-08). The 4.9 s/s
 * figure is 1440p at about 24 fps; cost scales with pixels × frames. A 60 fps
 * or 4K video at a fixed 20 s would run out of the chunk's 300 s, so:
 * - maxSec: the longest segment one chunk can encode, with overlays (+20%), in
 *   CHUNK_ENCODE_BUDGET_SEC (300 s less margin, download and upload);
 * - targetSec: half of that (at most 20 s), leaving room for the segment muxer
 *   running past the target to the next keyframe;
 * - refused when even an 8 s segment does not fit, or when the waves of
 *   chunks (VIDEO_TEXT_CONCURRENCY at a time) would not finish inside the
 *   coordinator's 900 s.
 */
export const REF_PIXEL_RATE = 2560 * 1440 * 24;
export const REF_ENCODE_SEC_PER_SEC = 4.9;
const OVERLAY_FACTOR = 1.2;
/**
 * With fades: measured 2026-11-08 on the layer's 7.0.2, a 20 s 1440p30 moving
 * segment with 8 lyric lines took 20.9 s plain-overlaid and 26.6 s fading
 * (+27%, the dense worst case). 1.2 × 1.27 ≈ 1.53; 1.55 keeps margin.
 */
const FADE_OVERLAY_FACTOR = 1.55;
const CHUNK_ENCODE_BUDGET_SEC = 230;
const CHUNK_OVERHEAD_SEC = 30;
const COORDINATOR_WAVES_BUDGET_SEC = 700;
export const MIN_SEGMENT_SEC = 8;
const MAX_SEGMENT_CAP_SEC = 60;
const LANES = 20; // VIDEO_TEXT_CONCURRENCY in worker/video-text.ts

export type SegmentPlan = { ok: true; targetSec: number; maxSec: number; keyframeEverySec: number } | { ok: false; message: string };

export function segmentPlanFor(
  v: { width: number; height: number; fps: number; durationSec: number },
  opts: { fades?: boolean } = {},
): SegmentPlan {
  const factor = opts.fades ? FADE_OVERLAY_FACTOR : OVERLAY_FACTOR;
  const secPerSec = REF_ENCODE_SEC_PER_SEC * ((v.width * v.height * v.fps) / REF_PIXEL_RATE) * factor;
  const maxSec = Math.min(MAX_SEGMENT_CAP_SEC, Math.floor((CHUNK_ENCODE_BUDGET_SEC / secPerSec) * 10) / 10);
  const fps = Math.round(v.fps * 100) / 100;
  if (maxSec < MIN_SEGMENT_SEC) {
    return {
      ok: false,
      message: `This video is too heavy to render here (${v.width}×${v.height} at ${fps} fps). Export it at 1440p and 30 fps or less, and upload again.`,
    };
  }
  const targetSec = Math.floor(Math.min(SEGMENT_TARGET_SEC, maxSec / 2) * 10) / 10;
  const chunks = Math.ceil(v.durationSec / targetSec);
  const waves = Math.ceil(chunks / LANES);
  const perChunk = targetSec * 1.25 * secPerSec + CHUNK_OVERHEAD_SEC;
  if (waves * perChunk > COORDINATOR_WAVES_BUDGET_SEC) {
    return {
      ok: false,
      message: `This video is too long for its size to render in one go (${v.width}×${v.height} at ${fps} fps). Export it at a lower resolution or frame rate, and upload again.`,
    };
  }
  return { ok: true, targetSec, maxSec, keyframeEverySec: Math.max(2, Math.floor(maxSec - targetSec)) };
}

export const fewKeyframesMessage = (everySec: number) =>
  `This video has too few keyframes to split — export it again with a keyframe at least every ${everySec} seconds.`;

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
export type SegmentOverlay = {
  id: string;
  fromSec: number;
  toSec: number;
  /**
   * The block fades: its own start and end relative to THIS segment (either
   * may lie outside it, for a block crossing a cut) and the fade length.
   */
  fade?: { inAt: number; outAt: number; sec: number };
};

export function overlaysForSegment(
  blocks: { id: string; startSec: number; endSec: number; fadeSec?: number }[],
  seg: { startSec: number; endSec: number },
): SegmentOverlay[] {
  const len = seg.endSec - seg.startSec;
  const out: SegmentOverlay[] = [];
  for (const b of blocks) {
    const fromSec = r3(Math.max(0, b.startSec - seg.startSec));
    const toSec = r3(Math.min(len, b.endSec - seg.startSec));
    if (!(toSec > fromSec)) continue;
    const o: SegmentOverlay = { id: b.id, fromSec, toSec };
    if (b.fadeSec && b.fadeSec > 0) {
      o.fade = { inAt: r3(b.startSec - seg.startSec), outAt: r3(b.endSec - seg.startSec), sec: r3(b.fadeSec) };
    }
    out.push(o);
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
  overlays: { path: string; fromSec: number; toSec: number; fade?: SegmentOverlay['fade'] }[];
  width: number;
  height: number;
  outPath: string;
  crf: number;
  preset: string;
  /** The video's frame rate: the fade clips are looped at it, and a trim is cut half a frame early. */
  fps?: number;
  /** Keep only the frames from `fromSec` to `toSec` of this segment (a cut's In or Out falls inside it). */
  trim?: ChunkTrim;
}): string[] {
  const { segPath, overlays, outPath, crf, preset, trim } = params;
  const fps = params.fps && params.fps > 0 ? params.fps : 25;
  const inputs: string[] = ['-i', segPath];
  const filters: string[] = [];
  const layers: { input: string; enable: [number, number]; eof: 'repeat' | 'pass' }[] = [];
  let next = 1;
  for (const o of overlays) {
    if (!o.fade) {
      inputs.push('-i', o.path);
      layers.push({ input: `[${next++}:v]`, enable: [o.fromSec, o.toSec], eof: 'repeat' });
      continue;
    }
    /*
     * A fading block is up to three layers, each only where it overlaps this
     * segment: a fade-in clip [a, a+d), the still image [a+d, b-d), a
     * fade-out clip [b-d, b). The clips repeat the PNG for d plus two frames
     * (so the last ramp frame exists), are faded on their OWN timeline
     * (ffmpeg refuses a negative fade start), then shifted to a or b-d —
     * negative for a block that began in the previous segment.
     */
    const { inAt: a, outAt: b, sec: d } = o.fade;
    // Frames in a fade clip: d plus two, so the last ramp frame exists.
    const clipFrames = Math.ceil(d * fps) + 2;
    const win = (lo: number, hi: number): [number, number] | null => {
      const from = r3(Math.max(o.fromSec, lo));
      const to = r3(Math.min(o.toSec, hi));
      return to > from ? [from, to] : null;
    };
    const fadeIn = win(a, a + d);
    const still = win(a + d, b - d);
    const fadeOut = win(b - d, b);
    // The PNG is decoded ONCE and repeated in the graph (loop filter): `-loop 1`
    // would decode the full-frame image again for every clip frame.
    const clip = (input: number, kind: 'in' | 'out', shift: number) =>
      // settb=AVTB first: the PNG input's timebase is 1/25, and setpts on it
      // truncates to whole 1/25 s ticks — at 60 or 29.97 fps the ramp stepped
      // and even blinked off a frame (review, measured on 7.0.2).
      `[${input}:v]loop=loop=${clipFrames - 1}:size=1:start=0,settb=AVTB,setpts=N/(${fps}*TB),format=rgba,` +
      `fade=t=${kind}:st=0:d=${d}:alpha=1,setpts=PTS+(${shift})/TB`;
    if (fadeIn) {
      inputs.push('-i', o.path);
      const label = `[fi${next}]`;
      filters.push(`${clip(next++, 'in', a)}${label}`);
      layers.push({ input: label, enable: fadeIn, eof: 'pass' });
    }
    if (still) {
      inputs.push('-i', o.path);
      layers.push({ input: `[${next++}:v]`, enable: still, eof: 'repeat' });
    }
    if (fadeOut) {
      inputs.push('-i', o.path);
      const label = `[fo${next}]`;
      filters.push(`${clip(next++, 'out', r3(b - d))}${label}`);
      layers.push({ input: label, enable: fadeOut, eof: 'pass' });
    }
  }
  let graph: string[] = ['-map', '0:v:0'];
  const steps = layers.map((l, i) => {
    const from = i === 0 ? '[0:v]' : `[v${i}]`;
    return `${from}${l.input}overlay=0:0:enable='gte(t,${l.enable[0]})*lt(t,${l.enable[1]})':eof_action=${l.eof}[v${i + 1}]`;
  });
  // The trim comes LAST: the overlays keep the segment's own clock, so a line
  // crossing In shows on the first kept frame exactly as the preview had it.
  const trimFilter = trimFilterFor(trim, fps);
  if (trimFilter) steps.push(`${layers.length === 0 ? '[0:v]' : `[v${layers.length}]`}${trimFilter}[vt]`);
  if (steps.length > 0) {
    graph = ['-filter_complex', [...filters, ...steps].join(';'), '-map', trimFilter ? '[vt]' : `[v${layers.length}]`];
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

/** Seconds of a segment to keep; a missing side keeps that end. */
export interface ChunkTrim {
  fromSec?: number;
  toSec?: number;
}

/**
 * `trim` keeps frames with fromSec - ½ frame ≤ pts < toSec - ½ frame: the
 * marks are on the frame grid, so that is exactly the frame AT In through the
 * frame before Out, whatever float noise the timestamps carry. setpts then
 * starts the chunk at 0, like every other chunk the join concatenates.
 */
function trimFilterFor(trim: ChunkTrim | undefined, fps: number): string | null {
  if (!trim || (trim.fromSec === undefined && trim.toSec === undefined)) return null;
  const half = 0.5 / fps;
  const parts: string[] = [];
  if (trim.fromSec !== undefined && trim.fromSec > 0) parts.push(`start=${r6(trim.fromSec - half)}`);
  if (trim.toSec !== undefined) parts.push(`end=${r6(trim.toSec - half)}`);
  if (parts.length === 0) return null;
  return `trim=${parts.join(':')},setpts=PTS-STARTPTS`;
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * The segments a cut keeps, renumbered from 0, each with the part of it to
 * keep: In and Out fall inside at most two of them, the ones between are kept
 * whole. With no cut every segment is kept whole. A segment that only touches
 * a mark (within half a frame) is left out.
 */
export function segmentsForCut(
  entries: SegmentEntry[],
  cut: Cut | null | undefined,
  fps: number,
  durationSec: number,
): { entry: SegmentEntry; trim?: ChunkTrim }[] {
  if (!cut) return entries.map((entry) => ({ entry }));
  const half = 0.5 / (fps > 0 ? fps : 25);
  const toEnd = cut.outSec >= durationSec - half;
  const out: { entry: SegmentEntry; trim?: ChunkTrim }[] = [];
  for (const entry of entries) {
    if (entry.endSec <= cut.inSec + half) continue;
    if (!toEnd && entry.startSec >= cut.outSec - half) continue;
    const trim: ChunkTrim = {};
    if (cut.inSec > entry.startSec + half) trim.fromSec = r3(cut.inSec - entry.startSec);
    if (!toEnd && cut.outSec < entry.endSec - half) trim.toSec = r3(cut.outSec - entry.startSec);
    out.push(trim.fromSec === undefined && trim.toSec === undefined ? { entry } : { entry, trim });
  }
  return out;
}

/**
 * The cut's sound, copied packet for packet from the extracted audio (no
 * decode). Input seeking with stream copy starts at the packet holding In and
 * marks the samples before In to be skipped, so the sound lines up with the
 * first kept frame to the sample (measured on the layer's 7.0.2: first packet
 * pts -192 at 48 kHz for an In 4 ms into it). Out ends at the packet holding
 * it. Same container as the extract (audioExtractExtFor).
 */
export function buildAudioCutArgs(audioPath: string, outPath: string, cut: Cut, durationSec: number, fps: number): string[] {
  const half = 0.5 / (fps > 0 ? fps : 25);
  const format = /\.mov$/i.test(audioPath) ? 'mov' : 'mp4';
  return [
    '-hide_banner', '-nostats',
    // The marks are times on the SOURCE's clock. Without this, ffmpeg adds the
    // file's start time to -ss/-to, and the extract's start time is the
    // audio's own first timestamp: a song whose sound starts 78 ms after the
    // picture was cut 78 ms late and played that much early (audit 2026-11-08,
    // measured on 7.0.2). With it, a source starting at 0 cuts the same.
    '-seek_timestamp', '1',
    ...(cut.inSec > 0 ? ['-ss', String(cut.inSec)] : []),
    ...(cut.outSec < durationSec - half ? ['-to', String(cut.outSec)] : []),
    '-i', audioPath,
    '-map', '0:a:0', '-c', 'copy', '-f', format, '-y', outPath,
  ];
}

/**
 * True when every packet of `part` (a framecrc listing) is the next packet of
 * `whole`, in order, from some packet on: same size, same checksum. Times are
 * not compared: the cut shifts them. This is how the cut sound is proved to be
 * the song's own packets, unchanged and with none dropped.
 */
export function isPacketRunOf(part: string, whole: string): boolean {
  return cutStartOnSource(part, whole) !== null;
}

/**
 * Where on the source's clock the cut's time 0 lies, in seconds, or null when
 * `part` is not a run of `whole`'s packets (see isPacketRunOf). Both are
 * framecrc listings read with -copyts in the same time base: the cut's first
 * packet sits at pts p in the cut and at pts s in the source, so the cut's 0
 * is source time (s − p). It must equal In, or the sound plays off the picture.
 */
export function cutStartOnSource(part: string, whole: string): number | null {
  const tbOf = (framecrc: string) => {
    const m = framecrc.match(/^#tb 0:\s*(\d+)\/(\d+)/m);
    return m ? Number(m[1]) / Number(m[2]) : null;
  };
  const packets = (framecrc: string) =>
    framecrc
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const f = l.split(',').map((x) => x.trim());
        return { pts: Number(f[2]), id: `${f[4]}:${f[5]}` };
      });
  const p = packets(part);
  const w = packets(whole);
  if (p.length === 0 || p.length > w.length) return null;
  for (let start = 0; start + p.length <= w.length; start++) {
    if (w[start].id !== p[0].id) continue;
    let i = 1;
    while (i < p.length && w[start + i].id === p[i].id) i++;
    if (i === p.length) {
      const tb = tbOf(part) ?? tbOf(whole);
      if (tb === null || tbOf(whole) !== tb) return null;
      return (w[start].pts - p[0].pts) * tb;
    }
  }
  return null;
}

/**
 * STEP 3 — join the chunks by stream copy and lay the original audio under
 * them, copied. `srcPath` is whatever holds that audio: usually the small
 * audio-only .m4a/.mov from buildAudioExtractArgs (the big source is deleted
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
 * Which container holds the extracted audio: QuickTime for a `.mov` source,
 * MP4 (named `.m4a`) for everything else. Both are ISO-BMFF, which keeps the
 * AAC priming edit list. Not Matroska: it drops that offset (first packet pts
 * -0.023 s with 1024 skip samples) and rounds times to 1 ms, so the packets
 * still hash the same but the whole song plays ~23 ms late against the video.
 */
export function audioExtractExtFor(srcPath: string): '.m4a' | '.mov' {
  return /\.mov$/i.test(srcPath) ? '.mov' : '.m4a';
}

/**
 * Copy the source's first audio stream to its own small file, untouched, so
 * the big source can be deleted while the chunks encode. The container comes
 * from the SOURCE path (audioExtractExtFor) and is forced with `-f`, so it is
 * the same muxer family the stream came out of; name `outPath` with
 * audioExtractExtFor(srcPath) to match.
 */
export function buildAudioExtractArgs(srcPath: string, outPath: string): string[] {
  const format = audioExtractExtFor(srcPath) === '.mov' ? 'mov' : 'mp4';
  return ['-hide_banner', '-nostats', '-i', srcPath, '-map', '0:a:0', '-c', 'copy', '-f', format, '-y', outPath];
}
