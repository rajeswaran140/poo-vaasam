/**
 * Does a story render come out exact — on the PRODUCTION ffmpeg — and how
 * long does each kind of shot cost?
 *
 * Runs the real builders from src/lib/visual-story-assemble.ts over fixtures
 * that exercise what a story really holds: a 24 fps 1080p clip WITH sound, a
 * 720p clip (Grok's size when references are used) a second SHORT of its
 * shot, a clip a second LONG, a 16:9 JPG still and a square PNG still. Both
 * aspects. For each render it checks total frames = window × 25, decoded
 * audio = the window, and no decode errors or join warnings; then it times a
 * minute of clip and a minute of zoomed still to price ASSEMBLE_COST.
 *
 * Run: FFMPEG_PATH=/path/to/layer/bin/ffmpeg npx tsx scripts/verify-assemble.ts
 * (7.0.2 is production; this box's 6.1.1 is a different program.)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ASSEMBLE_CODEC_ARGS,
  ASSEMBLE_FPS,
  STILL_SOURCE_SCALE,
  STILL_TO_BT709,
  assembleFrameSize,
  assemblyKindOf,
  buildAssembleConcatList,
  buildAssembleJoinArgs,
  buildClipSegmentArgs,
  stillMotionFor,
} from '../src/lib/visual-story-assemble';
import { buildComposeArgs } from '../src/lib/master-video';
import { buildShortComposeArgs, buildMotionSegmentArgs } from '../src/lib/master-short';
import type { AspectRatio } from '../src/types/visualStory';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const dir = mkdtempSync(join(tmpdir(), 'asmverify-'));
const p = (n: string) => join(dir, n);
const ff = (args: string[]) => execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args]);
const secs = (t0: number) => (Date.now() - t0) / 1000;

function aspectOf(file: string): number | undefined {
  const log = spawnSync(FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr;
  const m = /Video:.*?\s(\d{2,5})x(\d{2,5})/.exec(log);
  return m ? Number(m[1]) / Number(m[2]) : undefined;
}

/** One segment, exactly as the worker builds it. Returns seconds taken. */
function segment(src: string, durationSec: number, aspect: AspectRatio, index: number, out: string): number {
  const t0 = Date.now();
  if (assemblyKindOf(src) === 'clip') {
    ff(buildClipSegmentArgs({ srcPath: src, outPath: out, durationSec, aspect }).slice(1));
  } else {
    const frame = p(`frame${index}.ppm`);
    const coverAspect = aspectOf(src);
    ff((aspect === '16:9'
      ? buildComposeArgs({ coverPath: src, framePath: frame, height: 1080, coverAspect, sourceScale: STILL_SOURCE_SCALE })
      : buildShortComposeArgs({ coverPath: src, framePath: frame, coverAspect, sourceScale: STILL_SOURCE_SCALE })).slice(1));
    ff(buildMotionSegmentArgs({
      framePath: frame, seconds: durationSec, outPath: out, motion: stillMotionFor(index),
      size: assembleFrameSize(aspect), fps: ASSEMBLE_FPS, codecArgs: ASSEMBLE_CODEC_ARGS, inputFilter: STILL_TO_BT709,
    }).slice(1));
    rmSync(frame, { force: true });
  }
  return secs(t0);
}

const videoFrames = (file: string) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-count_packets', '-select_streams', 'v',
    '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file]).toString().trim());
const audioSeconds = (file: string) =>
  execFileSync(FFMPEG, ['-v', 'error', '-i', file, '-map', '0:a', '-f', 's16le', '-ac', '2', '-ar', '48000', '-'],
    { maxBuffer: 1 << 30 }).length / 4 / 48000;

// ---- fixtures ---------------------------------------------------------------
ff(['-f', 'lavfi', '-i', 'sine=f=440:r=48000', '-ac', '2', '-t', '60', '-y', p('master.wav')]);
ff(['-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=24', '-f', 'lavfi', '-i', 'sine=f=300', '-t', '6',
  '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', p('a-1080-24fps-sound.mp4')]);
ff(['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=24', '-t', '5', '-c:v', 'libx264', '-preset', 'fast',
  '-pix_fmt', 'yuv420p', '-y', p('b-720-short.mp4')]);
ff(['-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30', '-t', '7', '-c:v', 'libx264', '-preset', 'fast',
  '-pix_fmt', 'yuv420p', '-y', p('c-1080-long.mp4')]);
ff(['-f', 'lavfi', '-i', 'testsrc2=s=1920x1080', '-frames:v', '1', '-y', p('d-still.jpg')]);
ff(['-f', 'lavfi', '-i', 'testsrc2=s=1024x1024', '-frames:v', '1', '-y', p('e-square.png')]);

const SHOTS = ['a-1080-24fps-sound.mp4', 'b-720-short.mp4', 'c-1080-long.mp4', 'd-still.jpg', 'e-square.png'];
const SHOT_SEC = 6;
const WINDOW_START = 10;
const WINDOW = SHOTS.length * SHOT_SEC;

let failed = false;
const rows: string[] = [];
for (const aspect of ['16:9', '9:16'] as AspectRatio[]) {
  const segPaths: string[] = [];
  const times: string[] = [];
  SHOTS.forEach((name, i) => {
    const out = p(`seg${i}.mp4`);
    times.push(`${name.split('-')[0]} ${segment(p(name), SHOT_SEC, aspect, i, out).toFixed(1)}s`);
    segPaths.push(out);
  });
  writeFileSync(p('list.txt'), buildAssembleConcatList(segPaths));
  const t0 = Date.now();
  const r = spawnSync(FFMPEG, buildAssembleJoinArgs({
    listPath: p('list.txt'), audioPath: p('master.wav'), outPath: p('out.mp4'),
    windowStartSec: WINDOW_START, windowSec: WINDOW, fadeIn: true, fadeOut: true,
  }), { encoding: 'utf8' });
  const joinSec = secs(t0);
  const warnings = (r.stderr.match(/non-monotonic|Invalid|Error|discard/gi) ?? []).length;
  const decodeErrors = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-v', 'error', '-i', p('out.mp4'), '-f', 'null', '-'],
    { encoding: 'utf8' }).stderr.trim().split('\n').filter(Boolean).length;
  const frames = videoFrames(p('out.mp4'));
  const a = audioSeconds(p('out.mp4'));
  const ok = r.status === 0 && warnings === 0 && decodeErrors === 0 && frames === WINDOW * ASSEMBLE_FPS && a >= WINDOW - 0.001;
  if (!ok) failed = true;
  rows.push(`${ok ? 'ok  ' : 'FAIL'} ${aspect}  frames ${frames}/${WINDOW * ASSEMBLE_FPS}  audio ${a.toFixed(3)}/${WINDOW}  ` +
    `warnings ${warnings} decodeErrors ${decodeErrors}  join ${joinSec.toFixed(1)}s  [${times.join(', ')}]`);
}

// ---- cost: one minute of each kind, 16:9 -----------------------------------
ff(['-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=24', '-t', '15', '-c:v', 'libx264', '-preset', 'fast',
  '-pix_fmt', 'yuv420p', '-y', p('grok15.mp4')]);
const clipMin = [0, 1, 2, 3].reduce((n, i) => n + segment(p('grok15.mp4'), 15, '16:9', i, p(`cost-c${i}.mp4`)), 0);
const stillMin = [0, 1, 2, 3].reduce((n, i) => n + segment(p('d-still.jpg'), 15, '16:9', i, p(`cost-s${i}.mp4`)), 0);
const oneSec = segment(p('d-still.jpg'), 1, '16:9', 0, p('cost-1s.mp4'));

console.log(execFileSync(FFMPEG, ['-version']).toString().split('\n')[0]);
console.log(rows.join('\n'));
console.log(`cost: 60 s of clip ${clipMin.toFixed(1)}s (${(clipMin / 60).toFixed(2)}/s), ` +
  `60 s of zoomed still ${stillMin.toFixed(1)}s (${(stillMin / 60).toFixed(2)}/s), a 1 s still shot ${oneSec.toFixed(1)}s`);
rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
