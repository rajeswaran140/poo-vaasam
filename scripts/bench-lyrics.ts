/**
 * Can line-level Tamil lyrics ride the slideshow machinery on the CURRENT
 * Lambda? A 5:32 song is ~50 lyric lines, so that is ~50 segments rather than
 * the 3 the slideshow bench measured.
 *
 * The architecture under test is NOT the one generate-song-short.ts uses. That
 * one chains N `overlay=...:enable='between(t,a,b)'` filters in a single
 * filter_complex, which is per-frame work — fine for a 29 s Short (870 frames),
 * categorically not fine for a 5:32 song at the 900 s budget. This instead
 * FLATTENS each lyric plate into its own still frame and cuts a segment per
 * line, so every frame within a line is identical and the encode never filters.
 *
 *   1. compose the cover frame ONCE         (the expensive scale/blur pass)
 *   2. flatten each lyric plate onto it     (one frame each, cheap)
 *   3. encode one segment per lyric line
 *   4. join + audio, one pass
 *
 * Run: npx tsx scripts/bench-lyrics.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildComposeArgs,
  buildSegmentArgs,
  buildConcatList,
  buildJoinArgs,
  MIN_SEGMENT_SECONDS,
} from '../src/lib/master-video';

const DURATION = 332;   // the 5:32 master every other measurement uses
const LINES = 50;       // a realistic Tamil lyric count for that length
const dir = mkdtempSync(join(tmpdir(), 'lyrics-'));
/**
 * The flattened frames are temporaries handed straight to x264, so compressing
 * them buys nothing and costs real time: the first run spent 83.6 s writing 50
 * PNGs at 2560x1440. BMP is uncompressed.
 */
const FRAME_EXT = process.env.FRAME_EXT ?? '.bmp';

let total = 0;
function ff(args: string[]): number {
  const t = Date.now();
  execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const s = (Date.now() - t) / 1000;
  total += s;
  return s;
}
const say = (label: string, s: number) => console.log(`  ${label.padEnd(34)} ${s.toFixed(2)}s`);

// --- fixtures ---------------------------------------------------------------
execFileSync('ffmpeg', ['-hide_banner', '-nostats', '-f', 'lavfi', '-i',
  'color=c=teal:s=1672x941,noise=alls=40:allf=t', '-frames:v', '1', '-y', join(dir, 'cover.png')]);
execFileSync('ffmpeg', ['-hide_banner', '-nostats', '-f', 'lavfi', '-i',
  `sine=frequency=220:sample_rate=48000:duration=${DURATION}`, '-ac', '2', '-c:a', 'pcm_s24le',
  '-y', join(dir, 'master.wav')]);
// Stand-in for a Pillow-rendered lyric plate: a translucent full-frame PNG.
// render-lyric-cards.py produces all cues in ONE invocation, so the Python cost
// is a single spawn regardless of line count and is not what this measures.
execFileSync('ffmpeg', ['-hide_banner', '-nostats', '-f', 'lavfi', '-i',
  'color=c=black@0.55:s=2560x1440,format=rgba', '-frames:v', '1', '-y', join(dir, 'plate.png')]);

console.log(`\n${LINES} lyric lines over ${DURATION}s (${(DURATION / LINES).toFixed(1)}s each)\n`);

// --- 1. the expensive compose, ONCE -----------------------------------------
say('compose cover frame (once)', ff(buildComposeArgs({
  coverPath: join(dir, 'cover.png'), framePath: join(dir, 'base.png'), coverAspect: 1672 / 941,
})));

// --- 2. flatten a plate onto it, per line -----------------------------------
// Deliberately NOT the scale/blur graph: the cover is already composed, so this
// is a single overlay of an already-sized plate. One frame out.
let flatten = 0;
for (let i = 0; i < LINES; i += 1) {
  flatten += ff(['-hide_banner', '-nostats',
    '-i', join(dir, 'base.png'), '-i', join(dir, 'plate.png'),
    '-filter_complex', '[0:v][1:v]overlay=0:0[v]', '-map', '[v]',
    '-frames:v', '1', '-y', join(dir, `f${i}${FRAME_EXT}`)]);
}
say(`flatten ${LINES} frames (${FRAME_EXT})`, flatten);

// --- 3. one segment per line ------------------------------------------------
const starts = Array.from({ length: LINES }, (_, i) => Math.round((i * DURATION / LINES) * 10) / 10);
const segments = starts.map((startSec, i) => ({
  startSec,
  seconds: (i + 1 < LINES ? starts[i + 1] : DURATION) - startSec,
}));
if (segments.some((s) => s.seconds < MIN_SEGMENT_SECONDS)) throw new Error('lines too close together');

let encode = 0;
const segs: string[] = [];
segments.forEach((seg, i) => {
  const out = join(dir, `s${i}.mp4`);
  encode += ff(buildSegmentArgs({ framePath: join(dir, `f${i}${FRAME_EXT}`), seconds: seg.seconds, outPath: out }));
  segs.push(out);
});
say(`encode ${LINES} segments`, encode);

// --- 4. join + audio --------------------------------------------------------
writeFileSync(join(dir, 'list.txt'), buildConcatList(segs));
say('join + audio (one pass)', ff(buildJoinArgs({
  listPath: join(dir, 'list.txt'), audioPath: join(dir, 'master.wav'), outPath: join(dir, 'out.mp4'),
})));

// --- verdict ----------------------------------------------------------------
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
  'format=duration', '-show_entries', 'stream=codec_type,nb_frames', '-of', 'json',
  join(dir, 'out.mp4')]).toString());
console.log('\nVERDICT');
console.log(`  total                              ${total.toFixed(1)}s`);
console.log(`  duration      ${Number(probe.format.duration).toFixed(2)}s  (want ${DURATION})`);
console.log(`  streams       ${probe.streams.map((s: { codec_type: string; nb_frames?: string }) =>
  `${s.codec_type}:${s.nb_frames ?? '?'}`).join('  ')}`);
console.log(`  size          ${(statSync(join(dir, 'out.mp4')).size / 1e6).toFixed(1)} MB`);
console.log(`  vs 3-cover slideshow (423.8s) and single image (356.3s)`);
console.log(`  900s budget   ${((total / 900) * 100).toFixed(0)}% used on this box\n`);

rmSync(dir, { recursive: true, force: true });
