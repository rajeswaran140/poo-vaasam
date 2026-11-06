/**
 * Does a looped video background end with the song, decode cleanly, and keep
 * its shape — on the PRODUCTION ffmpeg?
 *
 * Runs the real arg builders from src/lib/master-background.ts over generated
 * fixtures that exercise what testsrc alone does not: a portrait phone video
 * stored as rotated HEVC in a MOV, a VP9 WebM, and a square GIF with uneven
 * frame delays. For each render it reports the video and audio STREAM lengths
 * separately — the container's Duration is the longer of the two and would
 * hide a picture that outruns the song (see buildVideoArgs for that history).
 *
 * Production runs `tamilagaval-ffmpeg:1` (7.0.2); this box runs 6.1.1, and
 * they differ on exactly this kind of question. Point FFMPEG_PATH at the
 * layer's binary or the numbers describe the wrong program. ffprobe (any
 * version) is used only to measure.
 *
 * Run: FFMPEG_PATH=/path/to/layer/bin/ffmpeg npx tsx scripts/verify-background.ts
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  backgroundFilterFrom,
  backgroundMaxrateFor,
  buildBackgroundFirstFrameArgs,
  buildBackgroundLoopArgs,
  buildBackgroundTrackArgs,
  buildBackgroundMuxArgs,
} from '../src/lib/master-background';
import { buildVideoFilter, VIDEO_CRF, VIDEO_AUDIO_BITRATE } from '../src/lib/master-video';
import { buildShortFrameFilter, SHORT_FADE_IN_SEC, shortFadeOutFor } from '../src/lib/master-short';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const SONG = 125.37;
const dir = mkdtempSync(join(tmpdir(), 'bgverify-'));
const p = (n: string) => join(dir, n);
const ff = (args: string[]) => execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args]);

const videoSeconds = (file: string) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=duration', '-of', 'csv=p=0', file]).toString().trim());
// The audio is measured by DECODING it and counting samples. ffprobe's stream
// duration for AAC moves by ~16 ms with how the muxer interleaved it (measured:
// 125.354 vs 125.370 for byte-identical decoded audio), so it cannot tell a
// trimmed song from a whole one.
const audioSeconds = (file: string) =>
  execFileSync(FFMPEG, ['-v', 'error', '-i', file, '-map', '0:a', '-f', 's16le', '-ac', '2', '-ar', '48000', '-'],
    { maxBuffer: 1 << 30 }).length / 4 / 48000;

function aspectOf(file: string): number {
  ff(buildBackgroundFirstFrameArgs(file, p('first.ppm')).slice(1));
  const log = spawnSync(FFMPEG, ['-hide_banner', '-i', p('first.ppm')], { encoding: 'utf8' }).stderr;
  const m = /Video:.*?\s(\d{2,5})x(\d{2,5})/.exec(log);
  return m ? Number(m[1]) / Number(m[2]) : NaN;
}

// ---- fixtures ---------------------------------------------------------------
ff(['-f', 'lavfi', '-i', 'sine=f=440:r=48000', '-ac', '2', '-t', String(SONG), '-y', p('master.wav')]);
ff(['-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30', '-f', 'lavfi', '-i', 'sine=f=300', '-t', '5',
  '-c:v', 'libx265', '-preset', 'ultrafast', '-tag:v', 'hvc1', '-c:a', 'aac', '-y', p('raw.mov')]);
ff(['-display_rotation', '90', '-i', p('raw.mov'), '-c', 'copy', '-y', p('phone.mov')]);
ff(['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=24', '-t', '5', '-c:v', 'libvpx-vp9', '-deadline', 'realtime',
  '-cpu-used', '8', '-b:v', '1M', '-y', p('clip.webm')]);
for (const [i, c] of ['224080', '664080', 'aa4080', 'ee4080'].entries()) {
  ff(['-f', 'lavfi', '-i', `color=c=0x${c}:s=400x400`, '-frames:v', '1', '-y', p(`f${i}.png`)]);
}
writeFileSync(p('gif.txt'), ['f0', 'f1', 'f2', 'f3'].map((f, i) =>
  `file ${p(`${f}.png`)}\nduration ${[0.1, 0.7, 0.25, 1.3][i]}\n`).join('') + `file ${p('f3.png')}\n`);
ff(['-f', 'concat', '-safe', '0', '-i', p('gif.txt'), '-vf', 'split[a][b];[a]palettegen[p];[b][p]paletteuse',
  '-fps_mode', 'vfr', '-y', p('square.gif')]);

// ---- renders ----------------------------------------------------------------
type Kind = '16:9' | 'clip' | 'full';
const rows: string[] = [];
let failed = false;
for (const src of ['phone.mov', 'clip.webm', 'square.gif']) {
  const aspect = aspectOf(p(src));
  for (const kind of ['16:9', 'clip', 'full'] as Kind[]) {
    const still = kind === '16:9' ? buildVideoFilter(1440, aspect) : buildShortFrameFilter(aspect);
    const loop = p('loop.mp4');
    const out = p('out.mp4');
    const t0 = Date.now();
    ff(buildBackgroundLoopArgs({
      srcPath: p(src), outPath: loop, filter: backgroundFilterFrom(still),
      crf: kind === '16:9' ? VIDEO_CRF : 20, maxrate: backgroundMaxrateFor(kind === '16:9' ? 1440 : 1080),
    }).slice(1));
    const t1 = Date.now();
    const secs = kind === 'clip' ? 30 : SONG;
    const fade = shortFadeOutFor(secs);
    ff(buildBackgroundTrackArgs({ loopPath: loop, outPath: p('track.mp4'), seconds: secs }).slice(1));
    const r = spawnSync(FFMPEG, buildBackgroundMuxArgs({
      videoPath: p('track.mp4'), audioPath: p('master.wav'), outPath: out,
      ...(kind === 'clip' ? { window: { startSec: 40, seconds: secs } } : {}),
      ...(kind === '16:9' ? {} : {
        audioFilter: `afade=t=in:st=0:d=${SHORT_FADE_IN_SEC},afade=t=out:st=${(secs - fade).toFixed(3)}:d=${fade}`,
      }),
      audioBitrate: kind === '16:9' ? VIDEO_AUDIO_BITRATE : '192k',
    }), { encoding: 'utf8' });
    const t2 = Date.now();
    const warnings = (r.stderr.match(/non-monotonic|Invalid|Error/gi) ?? []).length;
    const decodeErrors = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-v', 'error', '-i', out, '-f', 'null', '-'],
      { encoding: 'utf8' }).stderr.trim().split('\n').filter(Boolean).length;
    const v = videoSeconds(out);
    const a = audioSeconds(out);
    // The song is whole (AAC only ever ADDS a few ms of padding), and the
    // picture ends within one frame (0.04 s) before it, never after.
    const ok = r.status === 0 && warnings === 0 && decodeErrors === 0 &&
      a >= secs - 0.001 && v <= secs + 0.001 && secs - v <= 0.04;
    if (!ok) failed = true;
    rows.push(`${ok ? 'ok  ' : 'FAIL'} ${src.padEnd(11)} ${kind.padEnd(5)} aspect ${aspect.toFixed(3)}  ` +
      `loop ${((t1 - t0) / 1000).toFixed(1)}s render ${((t2 - t1) / 1000).toFixed(1)}s  ` +
      `video ${v.toFixed(3)} audio ${a.toFixed(3)}  warnings ${warnings} decodeErrors ${decodeErrors}  ` +
      `${(statSync(out).size / 1048576).toFixed(1)} MB`);
  }
}
console.log(execFileSync(FFMPEG, ['-version']).toString().split('\n')[0]);
console.log(rows.join('\n'));
rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
