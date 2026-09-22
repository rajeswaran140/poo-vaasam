/**
 * What does the render actually do to the audio?
 *
 * Output verification is only as good as its tolerances, and tolerances guessed
 * from theory fail in both directions: too tight and every good render is
 * flagged, too loose and the check never fires. So before writing the verifier,
 * measure what a KNOWN-GOOD render changes.
 *
 * Two effects are expected and neither is a fault:
 *   - AAC carries encoder delay and padding, so the encoded stream is normally
 *     a little longer than the PCM that went in.
 *   - Lossy coding moves sample values slightly, which can push inter-sample
 *     peaks UP. A true peak above the master's is normal; well above is not.
 *
 * Anything else — a changed sample rate, a changed channel count, a loudness
 * shift — would mean the video stage had touched the audio, which is the thing
 * the whole check exists to catch.
 *
 * Run: npx tsx scripts/bench-render-deltas.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildComposeArgs, buildVideoArgs, FRAME_EXTENSION } from '../src/lib/master-video';
import { measureArgs, parseMeasurement, parseSourceInfo } from '../src/lib/loudness-measure';
import { verifyRenderedAudio, type AudioSnapshot } from '../src/lib/master-verify';

const SECONDS = 60;
const dir = mkdtempSync(join(tmpdir(), 'deltas-'));
const run = (args: string[]) =>
  execFileSync('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'buffer' });
/** ffmpeg writes measurement output to stderr; read both and merge. */
const log = (args: string[]): string => {
  try {
    const r = execFileSync('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    return r.toString();
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    return `${err.stdout ?? ''}${err.stderr ?? ''}`;
  }
};
const measureLog = (path: string) => {
  const r = execFileSync('bash', ['-c',
    `ffmpeg ${measureArgs(path).map((a) => `'${a}'`).join(' ')} 2>&1`]).toString();
  return r;
};

// Music-like rather than a sine: broadband, with a slow level move so the
// integrated figure has something to integrate. Then loudnormed to -14, so the
// fixture is shaped like a real TamilAgaval master.
run(['-hide_banner', '-nostats', '-f', 'lavfi', '-i',
  `anoisesrc=color=pink:duration=${SECONDS}:sample_rate=48000:amplitude=0.5`,
  '-af', 'aeval=val(0)*(0.55+0.45*sin(2*PI*t/17)):c=same,pan=stereo|c0=c0|c1=c0',
  '-c:a', 'pcm_s24le', '-ar', '48000', '-y', join(dir, 'raw.wav')]);
run(['-hide_banner', '-nostats', '-i', join(dir, 'raw.wav'),
  '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-c:a', 'pcm_s24le', '-ar', '48000',
  '-y', join(dir, 'master.wav')]);

// Cover, and the real render path.
run(['-hide_banner', '-nostats', '-f', 'lavfi', '-i',
  'color=c=teal:s=1672x941,noise=alls=40:allf=t', '-frames:v', '1', '-y', join(dir, 'cover.png')]);
run(buildComposeArgs({
  coverPath: join(dir, 'cover.png'), framePath: join(dir, `frame${FRAME_EXTENSION}`),
  coverAspect: 1672 / 941,
}));
run(buildVideoArgs({
  framePath: join(dir, `frame${FRAME_EXTENSION}`), audioPath: join(dir, 'master.wav'),
  outPath: join(dir, 'out.mp4'),
}));

const read = (path: string, label: string) => {
  const header = log(['-hide_banner', '-i', path]);
  const info = parseSourceInfo(header);
  const m = parseMeasurement(measureLog(path), -14);
  console.log(`\n${label}`);
  console.log(`  duration    ${info?.durationSec ?? '?'} s`);
  console.log(`  sample rate ${info?.sampleRate ?? '?'} Hz`);
  console.log(`  channels    ${info?.channels ?? '?'} (${info?.channelLayout ?? '?'})`);
  console.log(`  codec       ${info?.codec ?? '?'}`);
  console.log(`  LUFS        ${m.metrics.lufs}`);
  console.log(`  true peak   ${m.metrics.truePeak} dBTP`);
  console.log(`  LRA         ${m.metrics.lra}`);
  return { info, m };
};

const a = read(join(dir, 'master.wav'), 'MASTER (the authority)');
const b = read(join(dir, 'out.mp4'), 'RENDERED MP4');

console.log('\nDELTA  (output − master)');
const d = (x: number | null | undefined, y: number | null | undefined) =>
  typeof x === 'number' && typeof y === 'number' ? (y - x) : NaN;
const dur = d(a.info?.durationSec, b.info?.durationSec);
console.log(`  duration    ${dur >= 0 ? '+' : ''}${dur.toFixed(2)} s`);
console.log(`  LUFS        ${(b.m.metrics.lufs - a.m.metrics.lufs >= 0 ? '+' : '')}${(b.m.metrics.lufs - a.m.metrics.lufs).toFixed(2)} LU`);
console.log(`  true peak   ${(b.m.metrics.truePeak - a.m.metrics.truePeak >= 0 ? '+' : '')}${(b.m.metrics.truePeak - a.m.metrics.truePeak).toFixed(2)} dB`);
console.log(`  LRA         ${(b.m.metrics.lra - a.m.metrics.lra >= 0 ? '+' : '')}${(b.m.metrics.lra - a.m.metrics.lra).toFixed(2)} LU`);
console.log(`  sample rate ${a.info?.sampleRate === b.info?.sampleRate ? 'unchanged' : 'CHANGED'}`);
console.log(`  channels    ${a.info?.channels === b.info?.channels ? 'unchanged' : 'CHANGED'}`);

/* --------------------------------------------------------------------------
 * Does the check actually FIRE?
 *
 * Tolerances proven loose enough by a passing render say nothing about whether
 * they are tight enough. Unit tests answer that against invented numbers; this
 * answers it against ffmpeg, by breaking the render in each of the ways the
 * audio rule forbids and confirming the verifier notices.
 * ------------------------------------------------------------------------ */
const snap = (path: string): AudioSnapshot => {
  const info = parseSourceInfo(log(['-hide_banner', '-i', path]));
  const m = parseMeasurement(measureLog(path), -14).metrics;
  const finite = (n: number | null | undefined) =>
    typeof n === 'number' && Number.isFinite(n) ? n : null;
  return {
    durationSec: finite(info?.durationSec), sampleRate: finite(info?.sampleRate),
    channels: finite(info?.channels), lufs: finite(m.lufs),
    truePeak: finite(m.truePeak), lra: finite(m.lra),
  };
};

const master = snap(join(dir, 'master.wav'));

/** Each fault is a real re-encode of the real master, not a doctored number. */
const faults: Array<[string, string[], 'failed' | 'passed']> = [
  ['a correct render', [], 'passed'],
  ['resampled to 44.1k', ['-ar', '44100'], 'failed'],
  ['downmixed to mono', ['-ac', '1'], 'failed'],
  ['re-levelled +3 dB', ['-af', 'volume=3dB'], 'failed'],
  ['truncated by 20 s', ['-t', String(SECONDS - 20)], 'failed'],
  ['limited / compressed', ['-af', 'acompressor=threshold=-24dB:ratio=8:makeup=6'], 'failed'],
];

console.log('\nDOES THE CHECK FIRE?  (each fault is a real re-encode)\n');
let wrong = 0;
for (const [label, extra, want] of faults) {
  const out = join(dir, `f-${label.replace(/\W+/g, '-')}.mp4`);
  run(['-hide_banner', '-nostats', '-i', join(dir, 'out.mp4'),
    '-map', '0:v', '-map', '0:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '384k',
    ...extra, '-y', out]);
  const check = verifyRenderedAudio(master, snap(out));
  const ok = check.status === want;
  if (!ok) wrong += 1;
  console.log(`  ${ok ? 'OK  ' : 'WRONG'}  ${label.padEnd(22)} -> ${check.status}`);
  for (const f of check.findings) console.log(`           ${f.message}`);
}
console.log(`\n  ${wrong === 0 ? 'every case behaved as intended' : `${wrong} case(s) WRONG`}\n`);

rmSync(dir, { recursive: true, force: true });
