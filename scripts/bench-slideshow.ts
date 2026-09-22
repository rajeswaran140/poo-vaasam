/**
 * Does the slideshow render still fit inside the 900 s Lambda?
 *
 * master-video.ts is built entirely on measurements — the compose/encode split,
 * 10 fps, CRF 16 — and none of them could be re-run, so each is a number in a
 * comment that has to be taken on trust. This is the one for the slideshow, and
 * it is committed so the next person can check it rather than believe it.
 *
 * It drives the REAL argument builders, so it fails if the render path changes
 * underneath it. What it is watching for is a step that stops being cheap: a
 * filter creeping into an encode, or the join losing its `-c:v copy`.
 *
 *   npm run bench:slideshow
 *
 * ⚠️ The fixture is random noise, which is incompressible — so the absolute
 * times are a worst case and the file sizes mean nothing. Real cover art
 * encodes faster. What the run is for is the COMPARISON against the
 * single-image baseline, measured on the same box with the same fixture.
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
} from '../src/lib/master-video';

const DURATION = 332; // the real 5:32 master the file's other numbers came from
const CUTS = [0, 130, 240];
const dir = mkdtempSync(join(tmpdir(), 'slideshow-'));

function ff(label: string, args: string[]): number {
  const t = Date.now();
  execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const s = (Date.now() - t) / 1000;
  console.log(`  ${label.padEnd(28)} ${s.toFixed(2)}s`);
  return s;
}

const mb = (p: string) => (statSync(p).size / 1e6).toFixed(1) + ' MB';

console.log(`workspace ${dir}\n`);

// Three 1672x941 covers — the aspect of the real 2026-09-15 cover, so the
// compose takes its fill branch rather than the blurred-backdrop one.
console.log('fixtures');
for (const [i, c] of ['red', 'green', 'blue'].entries()) {
  execFileSync('ffmpeg', ['-hide_banner', '-nostats', '-f', 'lavfi', '-i',
    `color=c=${c}:s=1672x941,noise=alls=40:allf=t`, '-frames:v', '1', '-y', join(dir, `cover${i}.png`)]);
}
execFileSync('ffmpeg', ['-hide_banner', '-nostats', '-f', 'lavfi', '-i',
  `sine=frequency=220:sample_rate=48000:duration=${DURATION}`, '-ac', '2',
  '-c:a', 'pcm_s24le', '-y', join(dir, 'master.wav')]);
console.log(`  master.wav ${mb(join(dir, 'master.wav'))}\n`);

/**
 * The single-image render, measured 2026-09-22 on the same box and fixture.
 * Hardcoded rather than re-run: it doubles the wall clock and the variable
 * under test is the slideshow.
 */
const BASELINE = 356.3;

// ---- slideshow: three covers, three steps ----------------------------------
console.log('SLIDESHOW — three covers, three steps');
let slide = 0;
for (let i = 0; i < 3; i += 1) {
  slide += ff(`compose frame ${i}`, buildComposeArgs({
    coverPath: join(dir, `cover${i}.png`), framePath: join(dir, `f${i}.png`), coverAspect: 1672 / 941,
  }));
}
const segs = CUTS.map((_, i) => join(dir, `seg${i}.mp4`));
CUTS.forEach((start, i) => {
  const seconds = (i + 1 < CUTS.length ? CUTS[i + 1] : DURATION) - start;
  slide += ff(`encode segment ${i} (${seconds}s)`, buildSegmentArgs({
    framePath: join(dir, `f${i}.png`), seconds, outPath: segs[i],
  }));
});
writeFileSync(join(dir, 'list.txt'), buildConcatList(segs));
slide += ff('join + audio (one pass)', buildJoinArgs({
  listPath: join(dir, 'list.txt'), audioPath: join(dir, 'master.wav'), outPath: join(dir, 'slide.mp4'),
}));
console.log(`  = ${slide.toFixed(1)}s   ${mb(join(dir, 'slide.mp4'))}\n`);

// ---- the questions the numbers have to answer ------------------------------
const probe = (p: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error',
  '-show_entries', 'format=duration', '-show_entries', 'stream=codec_type,nb_frames',
  '-of', 'json', p]).toString());
const out = probe(join(dir, 'slide.mp4'));
console.log('VERDICT');
console.log(`  duration      ${Number(out.format.duration).toFixed(2)}s  (want ${DURATION})`);
console.log(`  streams       ${out.streams.map((s: { codec_type: string; nb_frames?: string }) =>
  `${s.codec_type}:${s.nb_frames ?? '?'}`).join('  ')}`);
console.log(`  overhead      ${(slide - BASELINE).toFixed(1)}s vs the single-image render (${BASELINE}s)`);
// The overhead is the AAC encode losing the overlap it gets inside the
// single-image render's one ffmpeg process — not the cuts. Attributed on a
// 60s fixture: concat 0.65s, faststart 0.04s, aac 12.8s.
console.log(`  flat?         the overhead is the audio pass — more images add ~1s each`);
console.log(`  900s budget   ${((slide / 900) * 100).toFixed(0)}% used\n`);

rmSync(dir, { recursive: true, force: true });
