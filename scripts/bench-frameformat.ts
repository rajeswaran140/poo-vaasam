/**
 * Does the intermediate frame's FILE FORMAT change the encode time?
 *
 * The lyric bench encoded 332 s of video from BMP frames in 120 s. The
 * slideshow bench encoded the same 332 s from PNG frames in 288-308 s. Same
 * encoder settings, same duration, same box — the only difference was the
 * format of the still being looped.
 *
 * The suspicion: `-loop 1` re-decodes the image for every frame it emits, so a
 * 2560x1440 PNG is inflated ~3,320 times per render while a BMP is a memcpy.
 * If that holds it is not a lyric finding at all — it halves EVERY render in
 * the pipeline, including the single-cover one in production today.
 *
 * One variable, both directions, nothing else changed.
 *
 * Run: npx tsx scripts/bench-frameformat.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildComposeArgs, buildSegmentArgs } from '../src/lib/master-video';

const DURATION = 332;
const dir = mkdtempSync(join(tmpdir(), 'fmt-'));

execFileSync('ffmpeg', ['-hide_banner', '-nostats', '-f', 'lavfi', '-i',
  'color=c=teal:s=1672x941,noise=alls=40:allf=t', '-frames:v', '1', '-y', join(dir, 'cover.png')]);

// ONE composed frame, written in each format from the identical source. The
// pixels are the same; only the container differs.
for (const ext of ['.png', '.bmp']) {
  execFileSync('ffmpeg', buildComposeArgs({
    coverPath: join(dir, 'cover.png'), framePath: join(dir, `frame${ext}`), coverAspect: 1672 / 941,
  }));
}

console.log(`\nencoding ${DURATION}s of video from one looped still, ${DURATION * 10} frames\n`);
const results: Array<[string, number, number]> = [];

// Interleaved, not sequential: this box's load drifts, and running png-then-bmp
// once would credit the format with whatever the load did in between.
for (const pass of [1, 2]) {
  for (const ext of ['.png', '.bmp']) {
    const t = Date.now();
    execFileSync('ffmpeg', buildSegmentArgs({
      framePath: join(dir, `frame${ext}`), seconds: DURATION, outPath: join(dir, `out${ext}${pass}.mp4`),
    }), { stdio: ['ignore', 'ignore', 'pipe'] });
    const s = (Date.now() - t) / 1000;
    const mb = statSync(join(dir, `frame${ext}`)).size / 1e6;
    console.log(`  pass ${pass}  ${ext.padEnd(5)}  frame ${mb.toFixed(1).padStart(5)} MB   encode ${s.toFixed(1).padStart(6)}s`);
    results.push([ext, pass, s]);
  }
}

const mean = (ext: string) => {
  const xs = results.filter((r) => r[0] === ext).map((r) => r[2]);
  return xs.reduce((a, b) => a + b, 0) / xs.length;
};
const png = mean('.png');
const bmp = mean('.bmp');
console.log('\nVERDICT');
console.log(`  png mean      ${png.toFixed(1)}s`);
console.log(`  bmp mean      ${bmp.toFixed(1)}s`);
console.log(`  speedup       ${(png / bmp).toFixed(2)}x`);
console.log(`  saved         ${(png - bmp).toFixed(0)}s per render, on a 900s budget\n`);

// The output must be identical apart from the container it was decoded from.
// If BMP were quietly losing something this is where it shows.
for (const ext of ['.png', '.bmp']) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries',
    'stream=width,height,pix_fmt,nb_frames', '-of', 'csv=p=0', join(dir, `out${ext}1.mp4`)]).toString().trim();
  console.log(`  ${ext.padEnd(5)} -> ${out}   ${(statSync(join(dir, `out${ext}1.mp4`)).size / 1e6).toFixed(1)} MB`);
}
console.log();

rmSync(dir, { recursive: true, force: true });
