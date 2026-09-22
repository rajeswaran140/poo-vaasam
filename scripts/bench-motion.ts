/**
 * What does cinematic motion ACTUALLY cost on this pipeline?
 *
 * The file has always said per-frame filtering does not fit — measured once, in
 * 2026-08, as 43 min projected for a 5:32 song when `boxblur=24:4` ran per
 * frame. But boxblur is one of the most expensive filters there is, and that
 * number has been carrying a conclusion about pan and zoom that nobody has
 * tested. Finding 194 s inside a file extension made me stop trusting it.
 *
 * Motion has two multipliers, and this separates them:
 *
 *   1. FRAME RATE. 10 fps is deliberate and worth 2.6x. Motion needs 24-30, so
 *      before any filter runs there are three times as many frames. Case A
 *      prices that alone.
 *   2. THE FILTER. Cases B and C price two ways of moving a still, which differ
 *      by an order of magnitude in what they ask of the CPU:
 *        - crop: pure pixel selection from an oversized frame. No resampling.
 *          Gives pan. The cheapest motion that exists.
 *        - zoompan: rescales every frame. Gives pan AND zoom, i.e. Ken Burns.
 *
 * Everything is BMP-sourced, so the PNG decode tax measured separately is not
 * being charged to motion here.
 *
 * Run: npx tsx scripts/bench-motion.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildComposeArgs, VIDEO_CRF, VIDEO_GOP } from '../src/lib/master-video';

const DURATION = 332;      // the 5:32 master every other measurement uses
const BUDGET = 900;
const W = 2560, H = 1440;
const dir = mkdtempSync(join(tmpdir(), 'motion-'));

execFileSync('ffmpeg', ['-hide_banner', '-nostats', '-f', 'lavfi', '-i',
  'color=c=teal:s=1672x941,noise=alls=40:allf=t', '-frames:v', '1', '-y', join(dir, 'cover.png')]);

// The frame every case loops. BMP, so the decode tax is not in these numbers.
execFileSync('ffmpeg', buildComposeArgs({
  coverPath: join(dir, 'cover.png'), framePath: join(dir, 'frame.bmp'), coverAspect: 1672 / 941,
}));

// An OVERSIZED frame for the crop case: pan selects a window from it, so the
// enlargement happens once here rather than on every frame.
execFileSync('ffmpeg', ['-hide_banner', '-nostats', '-i', join(dir, 'cover.png'),
  '-filter_complex', `[0:v]scale=${Math.round(W * 1.25)}:${Math.round(H * 1.25)}:force_original_aspect_ratio=increase:flags=lanczos,crop=${Math.round(W * 1.25)}:${Math.round(H * 1.25)}[v]`,
  '-map', '[v]', '-frames:v', '1', '-y', join(dir, 'frame-big.bmp')]);

const ENCODE = [
  '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage',
  '-crf', String(VIDEO_CRF), '-g', String(VIDEO_GOP),
  '-pix_fmt', 'yuv420p', '-an',
];

interface Case { key: string; label: string; fps: number; args: () => string[] }

const cases: Case[] = [
  {
    key: 'static-10', label: 'static, 10 fps (today)', fps: 10,
    args: () => ['-hide_banner', '-nostats', '-loop', '1', '-framerate', '10', '-t', String(DURATION),
      '-i', join(dir, 'frame.bmp'), '-map', '0:v', ...ENCODE, '-r', '10', '-y', join(dir, 'a10.mp4')],
  },
  {
    key: 'static-30', label: 'static, 30 fps', fps: 30,
    args: () => ['-hide_banner', '-nostats', '-loop', '1', '-framerate', '30', '-t', String(DURATION),
      '-i', join(dir, 'frame.bmp'), '-map', '0:v', ...ENCODE, '-r', '30', '-y', join(dir, 'a30.mp4')],
  },
  {
    key: 'crop-30', label: 'pan via crop, 30 fps', fps: 30,
    // Pure pixel selection, no resampling. Drifts across the oversized frame.
    args: () => ['-hide_banner', '-nostats', '-loop', '1', '-framerate', '30', '-t', String(DURATION),
      '-i', join(dir, 'frame-big.bmp'),
      '-filter_complex', `[0:v]crop=${W}:${H}:x='(iw-${W})*t/${DURATION}':y='(ih-${H})/2'[v]`,
      '-map', '[v]', ...ENCODE, '-r', '30', '-y', join(dir, 'c30.mp4')],
  },
  {
    key: 'zoompan-30', label: 'Ken Burns via zoompan, 30 fps', fps: 30,
    // Rescales every frame — pan AND zoom. This is Phase 1 as the brief describes it.
    args: () => ['-hide_banner', '-nostats', '-loop', '1', '-framerate', '30', '-t', String(DURATION),
      '-i', join(dir, 'frame-big.bmp'),
      '-filter_complex',
      `[0:v]zoompan=z='min(1+0.0004*on,1.25)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=30[v]`,
      '-map', '[v]', ...ENCODE, '-r', '30', '-y', join(dir, 'z30.mp4')],
  },
];

console.log(`\n${DURATION}s master, ${W}x${H}, CRF ${VIDEO_CRF}, GOP ${VIDEO_GOP}, BMP source`);
console.log(`900 s budget. Dev box runs ~1.5x slower than the Lambda.\n`);
console.log('  case                            frames      encode    x static-10   budget');
console.log('  ' + '-'.repeat(76));

const results: Record<string, number> = {};
for (const c of cases) {
  const t = Date.now();
  execFileSync('ffmpeg', c.args(), { stdio: ['ignore', 'ignore', 'pipe'] });
  const s = (Date.now() - t) / 1000;
  results[c.key] = s;
  const rel = results['static-10'] ? (s / results['static-10']).toFixed(2) + 'x' : '—';
  const pct = ((s / BUDGET) * 100).toFixed(0) + '%';
  const over = s > BUDGET ? '  OVER' : '';
  console.log(
    `  ${c.label.padEnd(30)} ${String(DURATION * c.fps).padStart(6)}  ${(s.toFixed(1) + 's').padStart(9)}` +
    `  ${rel.padStart(11)}  ${pct.padStart(7)}${over}`
  );
}

console.log('\nWHAT EACH MULTIPLIER COSTS');
const r = results;
console.log(`  frame rate alone  10 -> 30 fps        ${(r['static-30'] / r['static-10']).toFixed(2)}x`);
console.log(`  crop on top of 30 fps                 ${(r['crop-30'] / r['static-30']).toFixed(2)}x`);
console.log(`  zoompan on top of 30 fps              ${(r['zoompan-30'] / r['static-30']).toFixed(2)}x`);
console.log(`\n  Ken Burns vs today, all in           ${(r['zoompan-30'] / r['static-10']).toFixed(2)}x`);

console.log('\nAGAINST THE 900s LAMBDA (this box / est. Lambda at 1.5x faster)');
for (const c of cases) {
  const lambda = results[c.key] / 1.5;
  const verdict = lambda > BUDGET ? 'DOES NOT FIT' : lambda > BUDGET * 0.75 ? 'tight' : 'fits';
  console.log(`  ${c.label.padEnd(30)} ${(results[c.key].toFixed(0) + 's').padStart(6)} / ${(lambda.toFixed(0) + 's').padStart(6)}   ${verdict}`);
}

console.log('\nOUTPUT');
for (const c of cases) {
  const f = { 'static-10': 'a10.mp4', 'static-30': 'a30.mp4', 'crop-30': 'c30.mp4', 'zoompan-30': 'z30.mp4' }[c.key]!;
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries',
    'stream=width,height,nb_frames,r_frame_rate', '-of', 'csv=p=0', join(dir, f)]).toString().trim();
  console.log(`  ${c.label.padEnd(30)} ${probe}  ${(statSync(join(dir, f)).size / 1e6).toFixed(0)} MB`);
}
console.log();

rmSync(dir, { recursive: true, force: true });
