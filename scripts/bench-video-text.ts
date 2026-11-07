/**
 * Video Text render plan — correctness and cost on the LAYER's ffmpeg.
 *
 * Runs the whole plan from src/lib/video-text/render-plan.ts on a real MP4:
 * audio extract → keyframe segments → every chunk re-encoded with timed PNG
 * overlays → stream-copy join over the extracted audio. Then it checks what
 * would be silent if wrong:
 *
 *   - the audio packets are bit-identical: source = extracted .m4a/.mov = output,
 *     AND land at the same times (pts, start_time, duration) — a hash alone
 *     cannot see a container that drops the AAC priming offset;
 *   - the output has the source's frame count, duration (within one frame)
 *     and a constant frame step across every join (no drift vs the audio);
 *   - a full decode of the output prints no errors;
 *   - a block crossing a cut shows on the frames either side of it, and is
 *     absent where it should be (no flash, no always-on overlay);
 * and prints seconds of encode per second of video at 1440p and 1080p: plain
 * re-encode vs 3 overlapping overlays vs 8 lyric lines, plus (1440p, once)
 * the `-loop 1` PNG form buildChunkArgs deliberately does not use.
 *
 * Production runs the layer's ffmpeg 7.0.2, not this box's 6.1.1, so every
 * WRITE and the audio hash go through FFMPEG_PATH. The layer ships no
 * ffprobe; the box's ffprobe only READS metadata here.
 *
 * Run: FFMPEG_PATH=/path/to/layer/bin/ffmpeg npx tsx scripts/bench-video-text.ts <src.mp4> [workDir]
 * (BENCH_SKIP_COST=1 skips the timing section and runs only the checks.)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SEGMENT_TARGET_SEC, CHUNK_CRF, CHUNK_PRESET,
  parseSegmentList, buildSegmentArgs, overlaysForSegment, buildChunkArgs,
  buildJoinMuxArgs, buildAudioHashArgs, buildAudioExtractArgs, audioExtractExtFor,
} from '../src/lib/video-text/render-plan';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const src = process.argv[2];
if (!src) throw new Error('usage: bench-video-text.ts <src.mp4> [workDir]');
const dir = process.argv[3] ? (mkdirSync(process.argv[3], { recursive: true }), process.argv[3]) : mkdtempSync(join(tmpdir(), 'vt-'));

const ff = (args: string[]) => execFileSync(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });
const probe = (args: string[]) => execFileSync(FFPROBE, ['-v', 'error', ...args], { maxBuffer: 1 << 28 }).toString().trim();
const timed = (args: string[]) => { const t = Date.now(); ff(args); return (Date.now() - t) / 1000; };
const hash = (p: string) => ff(buildAudioHashArgs(p)).toString().trim().split('\n').pop()!;
let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failures++; };

console.log(execFileSync(FFMPEG, ['-hide_banner', '-version']).toString().split('\n')[0]);
const [W, H] = probe(['-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', src]).split(',').map(Number);
const fpsFrac = probe(['-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', src]);
const fps = (() => { const [a, b] = fpsFrac.split('/').map(Number); return a / (b || 1); })();
const vDur = (p: string) => Number(probe(['-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', p]));
const vPts = (p: string) => probe(['-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', p])
  .split('\n').map(Number).sort((a, b) => a - b);
console.log(`source ${W}x${H} @ ${fps} fps, video ${vDur(src)} s, segment target ${SEGMENT_TARGET_SEC} s, crf ${CHUNK_CRF} ${CHUNK_PRESET}\n`);

// Opaque patches in distinct corners, so each block is read at its own pixel.
type Block = { id: string; startSec: number; endSec: number; color: [number, number, number]; x: number; y: number };
function makePng(path: string, w: number, h: number, b: Block) {
  const s = Math.round(h / 8);
  const hex = b.color.map((c) => c.toString(16).padStart(2, '0')).join('');
  // An opaque patch padded onto a transparent canvas. (drawbox on rgba leaves alpha 0.)
  ff(['-hide_banner', '-nostats', '-f', 'lavfi', '-i', `color=c=0x${hex}:s=${s}x${s},format=rgba`,
    '-vf', `pad=${w}:${h}:${Math.round(b.x * w)}:${Math.round(b.y * h)}:color=black@0`,
    '-frames:v', '1', '-y', path]);
}
// Frame n of a constant-rate file, sampled at one pixel. Input seeking to just
// before its time decodes from the previous keyframe only.
function pixel(path: string, frame: number, x: number, y: number): number[] {
  const out = ff(['-hide_banner', '-nostats', '-ss', Math.max(0, frame / fps - 0.5 / fps).toFixed(4), '-i', path,
    '-vf', `format=rgb24,crop=2:2:${x}:${y}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  return [...out.subarray(0, 3)];
}

// ---------------------------------------------------------------- 1. extract + segment
const audio = join(dir, `audio${audioExtractExtFor(src)}`);
ff(buildAudioExtractArgs(src, audio));
const listPath = join(dir, 'segments.csv');
ff(buildSegmentArgs(src, join(dir, 'seg%03d.mp4'), listPath, SEGMENT_TARGET_SEC));
const segs = parseSegmentList(readFileSync(listPath, 'utf8'));
const lens = segs.map((s) => +(s.endSec - s.startSec).toFixed(3));
console.log(`SEGMENTS: ${segs.length}, lengths ${lens.join(', ')}`);
console.log(`  longest ${Math.max(...lens)} s = ${(Math.max(...lens) / SEGMENT_TARGET_SEC).toFixed(2)}x target\n`);

// ---------------------------------------------------------------- 2. cost per second
function costAt(height: number, seg: string, segLen: number) {
  const w = Math.round((height * 16) / 9 / 2) * 2;
  let segPath = seg;
  if (height !== H) { // untimed: make a same-length segment at this height
    segPath = join(dir, `seg-${height}.mp4`);
    ff(['-hide_banner', '-nostats', '-i', seg, '-vf', `scale=${w}:${height}`, '-c:v', 'libx264', '-preset', 'veryfast',
      '-crf', String(CHUNK_CRF), '-pix_fmt', 'yuv420p', '-fps_mode', 'passthrough', '-an', '-y', segPath]);
  }
  const overlaysOf = (bs: Block[]) => overlaysForSegment(bs, { startSec: 0, endSec: segLen }).map((o) => {
    const b = bs.find((x) => x.id === o.id)!;
    const path = join(dir, `cost-${height}-${b.id}.png`);
    makePng(path, w, height, b);
    return { ...o, path };
  });
  // Three overlapping blocks, and eight lyric lines one after another.
  const three = overlaysOf([0, 1, 2].map((i) => ({
    id: `t${i}`, startSec: i * 5, endSec: i * 5 + 8, color: [255, 0, 0] as [number, number, number], x: 0.1 + 0.3 * i, y: 0.7,
  })));
  const eight = overlaysOf(Array.from({ length: 8 }, (_, i) => ({
    id: `l${i}`, startSec: (i * segLen) / 8, endSec: ((i + 1) * segLen) / 8, color: [255, 255, 255] as [number, number, number], x: 0.4, y: 0.75,
  })));
  const base = { segPath, width: w, height, outPath: join(dir, `cost-${height}.mp4`), crf: CHUNK_CRF, preset: CHUNK_PRESET };
  const best = (args: string[]) => Math.min(timed(args), timed(args));
  const r = {
    plain: best(buildChunkArgs({ ...base, overlays: [] })) / segLen,
    three: best(buildChunkArgs({ ...base, overlays: three })) / segLen,
    eight: best(buildChunkArgs({ ...base, overlays: eight })) / segLen,
    literal: NaN,
  };
  if (height === H) {
    // The brief's literal form, for the record: each PNG `-loop 1`, `shortest=1`. One run — it is slow.
    const literal = buildChunkArgs({ ...base, overlays: three })
      .flatMap((a, i, all) => (a === '-i' && all[i + 1].endsWith('.png') ? ['-loop', '1', a] : [a]))
      .map((a) => a.replace(/eof_action=repeat/g, 'shortest=1'));
    r.literal = timed(literal) / segLen;
  }
  return r;
}
console.log('COST (dev box, wall s per s of video; best of 2 except the -loop 1 form)');
const seg0Len = segs[0].endSec - segs[0].startSec;
const pct = (a: number, b: number) => `${a >= b ? '+' : ''}${((a / b - 1) * 100).toFixed(0)}%`;
for (const h of process.env.BENCH_SKIP_COST ? [] : [1440, 1080]) {
  const c = costAt(h, join(dir, segs[0].file), seg0Len);
  console.log(`  ${h}p  plain ${c.plain.toFixed(3)}  3 overlays ${c.three.toFixed(3)} (${pct(c.three, c.plain)})` +
    `  8 lyric overlays ${c.eight.toFixed(3)} (${pct(c.eight, c.plain)})` +
    (Number.isNaN(c.literal) ? '' : `  3 overlays as -loop 1 ${c.literal.toFixed(3)} (${pct(c.literal, c.plain)})`));
}
console.log();

// ---------------------------------------------------------------- 3. full render
const cut = segs[0].endSec; // the first join
const blocks: Block[] = [
  { id: 'cross', startSec: cut - 5, endSec: cut + 5, color: [255, 0, 0], x: 0.05, y: 0.05 },
  { id: 'inside', startSec: 3, endSec: 8, color: [0, 255, 0], x: 0.45, y: 0.05 },
  // Two lyric lines tiled edge to edge, in different places so each is read on its own.
  { id: 'adjA', startSec: 8, endSec: 10, color: [255, 255, 0], x: 0.25, y: 0.35 },
  { id: 'adjB', startSec: 10, endSec: 12, color: [255, 0, 255], x: 0.65, y: 0.35 },
  { id: 'later', startSec: segs[Math.min(2, segs.length - 1)].startSec + 2, endSec: segs[Math.min(2, segs.length - 1)].startSec + 6, color: [0, 0, 255], x: 0.85, y: 0.05 },
];
const pngOf = Object.fromEntries(blocks.map((b) => { const p = join(dir, `${b.id}.png`); makePng(p, W, H, b); return [b.id, p]; }));
const chunkFiles: string[] = [];
let encodeSec = 0;
for (const [i, s] of segs.entries()) {
  const out = join(dir, `chunk${String(i).padStart(3, '0')}.mp4`);
  const overlays = overlaysForSegment(blocks, s).map((o) => ({ ...o, path: pngOf[o.id] }));
  encodeSec += timed(buildChunkArgs({ segPath: join(dir, s.file), overlays, width: W, height: H, outPath: out, crf: CHUNK_CRF, preset: CHUNK_PRESET }));
  chunkFiles.push(out);
}
const concat = join(dir, 'concat.txt');
writeFileSync(concat, chunkFiles.map((f) => `file '${f}'\n`).join(''));
const output = join(dir, 'out.mp4');
const joinSec = timed(buildJoinMuxArgs({ concatListPath: concat, srcPath: audio, outPath: output, hasAudio: true }));
console.log(`RENDER: ${segs.length} chunks encoded in ${encodeSec.toFixed(1)} s serial, join ${joinSec.toFixed(1)} s\n`);

console.log('CHECKS');
const [hSrc, hMka, hOut] = [hash(src), hash(audio), hash(output)];
console.log(`  audio ${hSrc}`);
check(hSrc === hMka, `audio hash: source = extracted ${audioExtractExtFor(src)}`);
check(hSrc === hOut, 'audio hash: source = output');
const outFull = join(dir, 'out-from-src.mp4');
ff(buildJoinMuxArgs({ concatListPath: concat, srcPath: src, outPath: outFull, hasAudio: true }));
check(hash(outFull) === hSrc, 'audio hash: join reading the FULL source as input 1 also matches');

// Same packets is not same timing: the packets must also sit at the same times.
const aTiming = (p: string) => ({
  stream: probe(['-select_streams', 'a:0', '-show_entries', 'stream=start_time,duration', '-of', 'csv=p=0', p]),
  pts: probe(['-select_streams', 'a:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', p]),
});
const tSrc = aTiming(src);
console.log(`  audio start_time,duration ${tSrc.stream}, first pts ${tSrc.pts.split('\n')[0]}`);
for (const [label, p] of [[`extracted ${audioExtractExtFor(src)}`, audio], ['output', output], ['output (full-source join)', outFull]]) {
  const t = aTiming(p);
  check(t.stream === tSrc.stream && t.pts === tSrc.pts,
    `audio timing: ${label} start_time,duration ${t.stream}; all ${t.pts.split('\n').length} packet pts equal source`);
}
// For the record: what a Matroska extract would have done (ruled out, R3-amended).
const mka = join(dir, 'audio-control.mka');
ff(['-hide_banner', '-nostats', '-i', src, '-map', '0:a:0', '-c', 'copy', '-y', mka]);
const tMka = aTiming(mka);
console.log(`  info  .mka control: hash ${hash(mka) === hSrc ? 'EQUAL' : 'differs'}, start_time,duration ${tMka.stream}, first pts ${tMka.pts.split('\n')[0]}`);

const [dSrc, dOut] = [vDur(src), vDur(output)];
check(Math.abs(dSrc - dOut) <= 1 / fps + 1e-6, `video duration ${dOut} vs source ${dSrc} (within one frame)`);
const [pSrc, pOut] = [vPts(src), vPts(output)];
check(pSrc.length === pOut.length, `frame count ${pOut.length} vs source ${pSrc.length}`);
const steps = pOut.slice(1).map((t, i) => t - pOut[i]);
const badStep = steps.findIndex((d) => Math.abs(d - 1 / fps) > 1e-3);
check(badStep < 0, badStep < 0 ? `constant ${1 / fps} s frame step across all ${segs.length - 1} joins` : `frame step breaks at frame ${badStep}: ${steps[badStep]}`);
const maxDrift = Math.max(...pOut.map((t, i) => Math.abs(t - pSrc[i])));
check(maxDrift <= 1e-3, `max frame-time drift vs source ${maxDrift.toFixed(6)} s`);
const decode = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-v', 'error', '-i', output, '-f', 'null', '-']);
check(decode.status === 0 && decode.stderr.toString().trim() === '', 'full decode of the output prints no errors');

// Every block, sampled on the frames either side of each of its edges and of
// the cut, and well outside it: present exactly when its time says so.
const near = (a: number[], b: number[], tol: number) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const patch = Math.round(H / 8);
for (const b of blocks) {
  const px = Math.round(b.x * W) + patch / 2, py = Math.round(b.y * H) + patch / 2;
  const f0 = Math.round(b.startSec * fps), f1 = Math.round(b.endSec * fps);
  const frames = new Set([f0, f0 + 1, f1 - 1, f1, Math.max(0, f0 - 2), f1 + 2, Math.round(f0 / 2), f1 + Math.round(5 * fps)]);
  if (b.id === 'cross') { const c = Math.round(cut * fps); [c - 2, c - 1, c, c + 1].forEach((f) => frames.add(f)); }
  for (const f of [...frames].sort((a, z) => a - z)) {
    if (f >= pOut.length) continue;
    const t = f / fps;
    const shown = t >= b.startSec - 1e-6 && t < b.endSec - 1e-6; // half-open, like the enable window
    const got = pixel(output, f, px, py);
    // Absent = the source's own pixel came through (a source already that colour there
    // is still a pass, so pick a neutral-coloured source for a meaningful control).
    const ok = shown ? near(got, b.color, 40) : near(got, pixel(src, f, px, py), 24);
    check(ok, `${b.id.padEnd(6)} frame ${String(f).padStart(4)} (t=${t.toFixed(2)}) ${shown ? 'shown ' : 'absent'} rgb ${got.join(',')}`);
  }
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASS' : `${failures} CHECK(S) FAILED`}`);
if (!process.argv[3]) rmSync(dir, { recursive: true, force: true });
else console.log(`work dir kept: ${dir} (${readdirSync(dir).length} files)`);
process.exitCode = failures ? 1 : 0;
