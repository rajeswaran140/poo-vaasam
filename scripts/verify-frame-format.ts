/**
 * Prove that writing the intermediate frame uncompressed changes nothing you
 * can see, before changing what production renders.
 *
 * The speed finding is not in doubt (2.50x, interleaved, two passes each). What
 * IS worth proving is that PNG and BMP are the same picture: they are different
 * containers around the same pixels, but "should be" is not a check, and the
 * two encoded outputs differed by 0.2% in size, which deserves an explanation
 * rather than a shrug.
 *
 * Three questions, in order of how much they matter:
 *   1. Are the composed FRAMES bit-identical? If yes, nothing downstream can
 *      differ for any reason other than the encoder's own nondeterminism.
 *   2. Do the ENCODED videos match frame for frame? PSNR of infinity means
 *      every pixel of every frame is equal.
 *   3. If they do differ, by how much, and is it visible?
 *
 * Run: npx tsx scripts/verify-frame-format.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildComposeArgs, buildSegmentArgs } from '../src/lib/master-video';

// Production runs a DIFFERENT ffmpeg from this box (layer
// `tamilagaval-ffmpeg:1` is 7.0.2; the dev box is 6.1.1) and they do not
// behave identically — a `-shortest` difference between them hid a 2.4 s
// overrun on every render for months. A measurement taken here describes
// production only if it RAN the production binary, so this honours
// FFMPEG_PATH the way the worker and verify-fixtures.ts do.
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

const SECONDS = 20; // pixel equality does not depend on duration
const dir = mkdtempSync(join(tmpdir(), 'verify-'));
const ff = (args: string[]) => execFileSync(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });

// A cover with real detail in it — a flat colour would pass any comparison.
ff(['-hide_banner', '-nostats', '-f', 'lavfi', '-i',
  'color=c=teal:s=1672x941,noise=alls=40:allf=t', '-frames:v', '1', '-y', join(dir, 'cover.png')]);

console.log('\n1 — THE COMPOSED FRAME');
for (const ext of ['.png', '.bmp']) {
  ff(buildComposeArgs({
    coverPath: join(dir, 'cover.png'), framePath: join(dir, `frame${ext}`), coverAspect: 1672 / 941,
  }));
}
// Decode each to raw pixels and hash those — comparing the files themselves
// would only prove they are different containers, which is the point of the
// exercise, not a finding.
const hashes: Record<string, string> = {};
for (const ext of ['.png', '.bmp']) {
  ff(['-hide_banner', '-nostats', '-i', join(dir, `frame${ext}`),
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-y', join(dir, `raw${ext}.rgb`)]);
  hashes[ext] = createHash('sha256').update(readFileSync(join(dir, `raw${ext}.rgb`))).digest('hex');
  console.log(`  ${ext.padEnd(5)} file ${(statSync(join(dir, `frame${ext}`)).size / 1e6).toFixed(1).padStart(5)} MB` +
    `   raw pixels sha256 ${hashes[ext].slice(0, 16)}…`);
}
const framesIdentical = hashes['.png'] === hashes['.bmp'];
console.log(`  -> decoded pixels ${framesIdentical ? 'BIT-IDENTICAL' : 'DIFFER'}`);

console.log('\n2 — THE ENCODED VIDEO');
for (const ext of ['.png', '.bmp']) {
  ff(buildSegmentArgs({
    framePath: join(dir, `frame${ext}`), seconds: SECONDS, outPath: join(dir, `out${ext}.mp4`),
  }));
}
for (const ext of ['.png', '.bmp']) {
  console.log(`  ${ext.padEnd(5)} ${(statSync(join(dir, `out${ext}.mp4`)).size / 1e6).toFixed(2)} MB`);
}

// PSNR of "inf" means every pixel of every frame is equal. ffmpeg reports the
// filter's summary on stderr, so this reads the merged stream.
const psnr = execFileSync('bash', ['-c',
  `ffmpeg -hide_banner -i '${join(dir, 'out.png.mp4')}' -i '${join(dir, 'out.bmp.mp4')}' ` +
  `-filter_complex '[0:v][1:v]psnr' -f null - 2>&1 | grep -o 'average:[^ ]*' | tail -1`]).toString().trim();
console.log(`  PSNR ${psnr || '(not reported)'}`);

console.log('\n3 — VERDICT');
if (framesIdentical && /average:inf/.test(psnr)) {
  console.log('  The frames are the same pixels and the videos are the same pixels.');
  console.log('  The format change is provably invisible. Ship it.');
} else if (framesIdentical) {
  console.log('  Frames are bit-identical, so any video difference is x264 threading,');
  console.log('  not the source format. Check the PSNR figure: above ~50 dB is');
  console.log('  imperceptible; "inf" is exact.');
} else {
  console.log('  ⚠️ THE FRAMES DIFFER. Do not ship the change until this is');
  console.log('  understood — BMP and PNG should be the same pixels.');
}
console.log();

rmSync(dir, { recursive: true, force: true });
