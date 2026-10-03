/**
 * verify-stem-remix — real ffmpeg checks for `buildRemixArgs`/`planRemix`
 * (src/lib/stems.ts) against real stem WAVs, run with the PRODUCTION ffmpeg
 * (7.0.2 on Lambda) rather than whatever `ffmpeg` resolves to on this box —
 * see scripts/verify-frame-format.ts for why that distinction mattered once
 * before (a `-shortest` difference between 7.0.2 and 6.1.1 hid a 2.4 s
 * overrun on every render for months).
 *
 * It goes through the SAME path the worker does (`renderStemMix` in
 * worker/master-worker.ts): build a StemSet → planRemix → probe each file
 * with `ffmpeg -i` (never trust the stored record) → the longest PROBED
 * duration → remixNotes → the real buildRemixArgs. A script that built its
 * own filter graph would prove its own graph correct and say nothing about
 * production.
 *
 * Checks, all against real stem WAVs:
 *   (a) sum check      — all 9 stems at 0 dB vs. a reference sum built by
 *                         hand with a plain `amix=normalize=0` (no apad, no
 *                         `-t`) on the same files. RMS must agree within
 *                         0.01 dB; the output's peak may exceed 0 dBFS
 *                         (float can hold the overs; that is not a fault).
 *   (b) mute check     — one stem muted via `planRemix` (set.mix.muted),
 *                         not dropped from the array by hand, vs. a
 *                         hand-built sum of the other 8. Same 0.01 dB bar.
 *   (c) length check   — (c1) the full set's output length against the
 *                         longest stem's own length; (c2) one stem trimmed
 *                         short, to actually exercise apad/`-t` rather than
 *                         finding two equal lengths and calling it proven.
 *                         Both gated as 0 <= delta <= LENGTH_GATE_SAMPLES,
 *                         delta = output − longest stem, at 48 kHz. Never
 *                         negative: a render shorter than the longest stem
 *                         has cut its tail. The upper bound is the worker's
 *                         own `-t` headroom (REMIX_BOUND_HEADROOM_SEC, 0.06 s)
 *                         plus the worst a probe can under-read a length
 *                         (0.055 s: ffmpeg's Duration is rounded to 0.01 s,
 *                         then parseSourceInfo rounds to 0.1 s) — the padded
 *                         silence `-t` may legitimately keep past the end.
 *   (d) resample check — a stem copied to 44.1 kHz among otherwise-48 kHz
 *                         stems renders at 48 kHz with no ffmpeg error.
 *
 * A null-residual detector (two files summed with opposite polarity via
 * `volume=-1` then a plain `amix normalize=0`, then measured with astats)
 * is self-tested once against a known match and a known 0.1 dB mismatch
 * before any of (a)/(b) trust it — an untested null detector that always
 * reports "match" would make every check pass for the wrong reason.
 *
 * Usage:
 *   npx tsx scripts/verify-stem-remix.ts --dir <folder of stem WAVs> \
 *     [--ffmpeg <path>] [--work <scratch dir>] [--any-ffmpeg]
 *
 * Flag/env precedence for the ffmpeg binary: --ffmpeg, then FFMPEG_PATH
 * (honoured the way verify-frame-format.ts honours it), then the Lambda
 * layer binary extracted under this box's scratchpad.
 *
 * The whole point of this script is to check production's own ffmpeg, not
 * "some ffmpeg" — a `-shortest` difference between 7.0.2 and 6.1.1 is what
 * hid the 2.4 s overrun this house precedent exists because of. So after
 * the version banner is printed, the binary must self-report as 7.0.2 or
 * the script refuses to run any check against it. `--any-ffmpeg` overrides
 * that refusal, for the rare case of deliberately probing a different
 * ffmpeg build (e.g. reproducing a version-specific bug like the `weights`
 * one found below) rather than verifying production.
 */

import { spawnSync, execSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRemixArgs, planRemix, remixNotes, remixBoundSec, REMIX_BOUND_HEADROOM_SEC } from '@/lib/stems';
import { parseSourceInfo, parseAudioSampleCount } from '@/lib/loudness-measure';
import type { StemSet, StemMixEntry } from '@/types/stemSet';

// ---------------------------------------------------------------------------
// Args / binary selection
// ---------------------------------------------------------------------------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const LAMBDA_LAYER_FFMPEG =
  '/tmp/claude-1000/-home-devuser-projects-ecommporter/fa9a03a5-53c0-4ed0-b456-4073a1115144/scratchpad/layer/bin/ffmpeg';

const FFMPEG = arg('--ffmpeg') || process.env.FFMPEG_PATH || LAMBDA_LAYER_FFMPEG;
const DIR_ARG = arg('--dir');
const WORK = arg('--work') || tmpdir();
const ANY_FFMPEG = process.argv.includes('--any-ffmpeg');

if (!DIR_ARG) {
  console.error('usage: verify-stem-remix.ts --dir <folder of stem WAVs> [--ffmpeg <path>] [--work <scratch dir>] [--any-ffmpeg]');
  process.exit(1);
}
const DIR: string = DIR_ARG;

/**
 * Self-protecting: a missing/unspawnable binary fails loudly, once, with a
 * message that names the path — rather than every probe/measure silently
 * parsing an empty log and reporting nonsense numbers down the line.
 *
 * `spawnSync`'s `.error` isn't only "binary not found": it's also set on a
 * timeout (`ETIMEDOUT`, from the 10-minute cap below — the exact case this
 * script exists to catch, an `apad`/`amix duration=longest` render that
 * never ends) and on exceeding `maxBuffer`. Those must NOT be reported as
 * "not found" — only ENOENT/EACCES, an actually-missing-or-unexecutable
 * binary, get that message; anything else names its own error code.
 */
const ff = (args: string[]) => {
  const r = spawnSync(FFMPEG, args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 10 * 60 * 1000 });
  if (r.error) {
    const code = (r.error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EACCES') throw new Error(`ffmpeg binary not found at ${FFMPEG}`);
    throw new Error(`ffmpeg failed (${code ?? r.error.message})`);
  }
  return r;
};
const logOf = (r: { stdout?: string; stderr?: string }) => `${r.stdout ?? ''}${r.stderr ?? ''}`;

/** The self-test's own bar: a true null measures −inf; anything below this
 *  is close enough to call a match. (a)/(b) are gated by the identical bar,
 *  not just printed, so a real mismatch fails the check instead of scrolling by. */
const NULL_RESIDUAL_GATE_DB = -80;
const isNullResidual = (db: number) => db === -Infinity || db < NULL_RESIDUAL_GATE_DB;

/** (c1)/(c2)'s upper bound, in 48 kHz samples — see the docblock: the
 *  `-t` headroom plus the worst probe under-read (≈5520). */
const PROBE_WORST_UNDERREAD_SEC = 0.055;
const LENGTH_GATE_SAMPLES = Math.round((REMIX_BOUND_HEADROOM_SEC + PROBE_WORST_UNDERREAD_SEC) * 48000);
const lengthOk = (delta: number | null): delta is number => delta !== null && delta >= 0 && delta <= LENGTH_GATE_SAMPLES;

function parseDbToken(tok: string): number {
  if (/^-inf$/i.test(tok)) return -Infinity;
  if (/^inf$/i.test(tok)) return Infinity;
  return Number(tok);
}

function extractDb(text: string, label: string): number {
  const m = text.match(new RegExp(`${label}:\\s+(-?inf|-?\\d+(?:\\.\\d+)?)`, 'i'));
  return m ? parseDbToken(m[1]) : NaN;
}

function probe(path: string) {
  return parseSourceInfo(logOf(ff(['-hide_banner', '-i', path])));
}

/** RMS/peak/sample-count of a single rendered file, via one astats pass. */
function measureFile(path: string) {
  const text = logOf(ff(['-hide_banner', '-nostats', '-i', path, '-af', 'astats=metadata=1:measure_perchannel=0', '-f', 'null', '-']));
  return { rmsDb: extractDb(text, 'RMS level dB'), peakDb: extractDb(text, 'Peak level dB'), samples: parseAudioSampleCount(text) };
}

/**
 * The exact sample count a file would have AT 48 kHz, via a forced
 * `aresample=48000` ahead of astats — not the file's own native-rate
 * sample count, which is not a valid comparison against a 48 kHz mix
 * output when the source isn't already 48 kHz. (This is also why (c1)
 * doesn't compare against `round(probedDurationSec * 48000)`: that would
 * just re-derive the target from the same one-decimal-rounded duration
 * the render's `-t` bound is itself derived from, making the check circular rather
 * than an independent ground truth.)
 */
function measure48kSampleCount(path: string): number | null {
  const text = logOf(ff(['-hide_banner', '-nostats', '-i', path, '-af', 'aresample=48000,astats=metadata=1:measure_perchannel=0', '-f', 'null', '-']));
  return parseAudioSampleCount(text);
}

/**
 * RMS of (a − b), computed entirely in the filter graph (no file written).
 *
 * ⚠️ amix's own `weights` option did NOT invert on this build — measured
 * directly, with `normalize=0`: `weights=1 -1` and `weights=1 1` produced
 * the identical RMS, so a negative weight was not applied as a polarity
 * flip here (it may well be taken as |weight| rather than ignored; this
 * only rules out inversion, not every other use of the option).
 * `volume=-1` (negative linear gain, a genuine polarity flip) before a
 * plain `normalize=0` sum is what actually cancels: a file against itself
 * this way measures −inf, which the self-test below checks before
 * anything trusts it.
 */
function nullResidualRmsDb(a: string, b: string): number {
  const text = logOf(ff([
    '-hide_banner', '-nostats', '-i', a, '-i', b, '-filter_complex',
    '[1:a]volume=-1[neg];[0:a][neg]amix=inputs=2:normalize=0:duration=longest,astats=metadata=1:measure_perchannel=0',
    '-f', 'null', '-',
  ]));
  return extractDb(text, 'RMS level dB');
}

let maxScratchBytes = 0;
function duBytes(dir: string): number {
  try {
    const out = execSync(`du -sb "${dir}"`, { encoding: 'utf8' });
    const n = Number(out.split(/\s+/)[0]);
    if (Number.isFinite(n)) maxScratchBytes = Math.max(maxScratchBytes, n);
    return n;
  } catch {
    return 0;
  }
}

function fmtBytes(n: number): string {
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}

// ---------------------------------------------------------------------------
// The worker's own pipeline, mirrored: StemSet → planRemix → probe → notes →
// buildRemixArgs. See worker/master-worker.ts's renderStemMix.
// ---------------------------------------------------------------------------

interface StemFile {
  id: string;
  path: string;
  name: string;
}

function buildSet(files: StemFile[], mixOverride: Record<string, Partial<StemMixEntry>> = {}): StemSet {
  const stems: StemSet['stems'] = {};
  const mix: StemSet['mix'] = {};
  for (const f of files) {
    stems[f.id] = {
      key: f.path,
      name: f.name,
      previewKey: null,
      previewError: null,
      previewRequestedAt: null,
      durationSec: null,
      sampleRate: null,
      channels: null,
    };
    mix[f.id] = { gainDb: 0, muted: false, ...mixOverride[f.id] };
  }
  return {
    masterJobId: 'verify-stem-remix',
    order: files.map((f) => f.id),
    stems,
    mix,
    remix: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

interface RenderResult {
  status: number | null;
  outPath: string;
  longestSec: number | null;
  notes: string[];
  ms: number;
}

/**
 * planRemix → re-probe each surviving input (the file is the authority, not
 * the record — exactly what renderStemMix does) → longest PROBED duration →
 * remixNotes (against that length) → the real buildRemixArgs, bounded at
 * `remixBoundSec` of it, as the worker is.
 */
function renderMix(files: StemFile[], mixOverride: Record<string, Partial<StemMixEntry>>, outPath: string): RenderResult {
  const set = buildSet(files, mixOverride);
  const plan = planRemix(set);
  if (!plan.ok) throw new Error(`planRemix refused: ${plan.message}`);

  const inputs: Array<{ path: string; gainDb: number; sampleRate: number | null }> = [];
  const probed: Array<{ name: string; sampleRate: number | null; durationSec: number | null }> = [];
  for (const i of plan.inputs) {
    const info = probe(i.key);
    const sampleRate = info?.sampleRate ?? i.sampleRate;
    inputs.push({ path: i.key, gainDb: i.gainDb, sampleRate });
    probed.push({ name: i.name, sampleRate, durationSec: info?.durationSec ?? i.durationSec });
  }
  const probedLengths = probed.map((p) => p.durationSec).filter((d): d is number => typeof d === 'number');
  const longestSec = probedLengths.length ? Math.max(...probedLengths) : plan.longestSec;
  const notes = remixNotes(probed, longestSec);

  const durationSec = longestSec === null ? null : remixBoundSec(longestSec);
  const args = buildRemixArgs({ inputs, outPath, durationSec });
  const t0 = Date.now();
  const r = ff(args);
  const ms = Date.now() - t0;
  if (r.status !== 0) console.error(logOf(r));
  return { status: r.status, outPath, longestSec, notes, ms };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const t0 = Date.now();
  const failures: string[] = [];
  const fail = (msg: string) => {
    failures.push(msg);
    console.error(`FAIL: ${msg}`);
  };

  console.log(`ffmpeg: ${FFMPEG}`);
  const versionLine = logOf(ff(['-version'])).split('\n')[0];
  console.log(`  ${versionLine}`);
  if (!ANY_FFMPEG && !versionLine.includes('7.0.2')) {
    console.error(
      `refusing to run: expected ffmpeg 7.0.2 (the production Lambda layer's version), got: "${versionLine}". ` +
      'Pass --any-ffmpeg to check a different build on purpose.'
    );
    process.exit(1);
  }

  const wavNames = readdirSync(DIR).filter((f) => /\.wav$/i.test(f)).sort();
  if (wavNames.length === 0) {
    console.error(`no WAVs found in ${DIR}`);
    process.exit(1);
  }
  const files: StemFile[] = wavNames.map((f) => ({
    id: f,
    path: join(DIR, f),
    name: f.match(/_\d+_(.+)\.wav$/i)?.[1]?.replace(/_/g, ' ') ?? f,
  }));

  console.log(`stems (${files.length}):`);
  const stemProbe = files.map((f) => {
    const info = probe(f.path);
    console.log(`  ${f.name.padEnd(20)} ${String(info?.sampleRate ?? '?').padStart(6)} Hz   ${(info?.durationSec ?? NaN).toFixed(2)} s`);
    return { f, info };
  });

  const scratch = mkdtempSync(join(WORK, 'verify-remix-'));
  const cleanup = (...paths: string[]) => { for (const p of paths) rmSync(p, { force: true }); };

  try {
    // -----------------------------------------------------------------
    // Self-test the null-residual detector before trusting it for (a)/(b).
    // -----------------------------------------------------------------
    console.log('\nself-test: null-residual detector');
    const selfMatch = nullResidualRmsDb(files[0].path, files[0].path);
    console.log(`  a file against itself:            ${selfMatch === -Infinity ? '-inf' : selfMatch.toFixed(2)} dB`);
    if (!isNullResidual(selfMatch)) fail(`null-residual self-test: a file against itself measured ${selfMatch} dB, expected -inf or below ${NULL_RESIDUAL_GATE_DB} dB`);

    const shifted = join(scratch, 'self-shifted.wav');
    ff(['-hide_banner', '-nostats', '-i', files[0].path, '-af', 'volume=0.1dB', '-y', shifted]);
    const selfMismatch = nullResidualRmsDb(files[0].path, shifted);
    console.log(`  a file against itself +0.1 dB:    ${selfMismatch.toFixed(2)} dB`);
    if (!Number.isFinite(selfMismatch) || isNullResidual(selfMismatch)) fail(`null-residual self-test: a 0.1 dB mismatch measured ${selfMismatch} dB, expected a clearly non-silent residual (above ${NULL_RESIDUAL_GATE_DB} dB)`);
    cleanup(shifted);
    duBytes(scratch);

    // -----------------------------------------------------------------
    // (a) Sum check
    // -----------------------------------------------------------------
    console.log(`\n(a) sum check — all ${files.length} stems at 0 dB vs. a hand-built amix=normalize=0 reference`);
    const aOut = join(scratch, 'a-full.wav');
    const aRender = renderMix(files, {}, aOut);
    if (aRender.status !== 0) fail('(a) buildRemixArgs render failed');

    // The global constraint: 32-bit float WAV at 48 kHz. buildRemixArgs sets
    // this unconditionally; check it against a real render, not just the args.
    const aOutInfo = probe(aOut);
    console.log(`  output format: ${aOutInfo?.codec} @ ${aOutInfo?.sampleRate} Hz`);
    if (aOutInfo?.codec !== 'pcm_f32le' || aOutInfo?.sampleRate !== 48000) {
      fail(`(a) output format: expected pcm_f32le @ 48000 Hz, got ${aOutInfo?.codec} @ ${aOutInfo?.sampleRate} Hz`);
    }

    const aRef = join(scratch, 'a-ref.wav');
    const refArgs = [
      '-hide_banner', '-nostats',
      ...files.flatMap((f) => ['-i', f.path]),
      '-filter_complex', `amix=inputs=${files.length}:normalize=0:duration=longest[m]`,
      '-map', '[m]', '-c:a', 'pcm_f32le', '-ar', '48000', '-y', aRef,
    ];
    const refResult = ff(refArgs);
    if (refResult.status !== 0) {
      console.error(logOf(refResult));
      fail('(a) reference amix render failed');
    }
    duBytes(scratch);

    const aFull = measureFile(aOut);
    const aRefM = measureFile(aRef);
    const aDiff = Math.abs(aFull.rmsDb - aRefM.rmsDb);
    const aNull = nullResidualRmsDb(aOut, aRef);
    console.log(`  full-mix  RMS ${aFull.rmsDb.toFixed(3)} dB   peak ${aFull.peakDb.toFixed(3)} dBFS   samples ${aFull.samples}`);
    console.log(`  reference RMS ${aRefM.rmsDb.toFixed(3)} dB   peak ${aRefM.peakDb.toFixed(3)} dBFS   samples ${aRefM.samples}`);
    console.log(`  |RMS diff| ${aDiff.toFixed(4)} dB   null-residual RMS ${aNull === -Infinity ? '-inf' : aNull.toFixed(2)} dB`);
    if (!(aDiff < 0.01)) fail(`(a) sum check: RMS differs by ${aDiff.toFixed(4)} dB (limit 0.01 dB)`);
    if (!isNullResidual(aNull)) fail(`(a) sum check: null-residual RMS ${aNull} dB is not -inf or below ${NULL_RESIDUAL_GATE_DB} dB — full-mix and reference are not actually the same signal`);

    // (c1) length check — reuse (a)'s full-mix output before deleting it.
    // Measured at a FORCED 48 kHz, not the stem's own native-rate sample
    // count: comparing sample counts across different sample rates would be
    // invalid even though it happens to coincide here (every real stem is
    // already 48 kHz).
    console.log('\n(c1) length check — full set vs. the longest stem\'s own length, both at 48 kHz');
    const longestStem = stemProbe.reduce((best, s) => ((s.info?.durationSec ?? 0) > (best.info?.durationSec ?? 0) ? s : best), stemProbe[0]);
    const longestStemSamples = measure48kSampleCount(longestStem.f.path);
    const c1DeltaSamples = longestStemSamples !== null && aFull.samples !== null ? aFull.samples - longestStemSamples : null;
    console.log(`  longest stem (${longestStem.f.name}) samples, forced to 48kHz: ${longestStemSamples}`);
    console.log(`  full-mix output samples @48kHz:                           ${aFull.samples}`);
    console.log(`  delta: ${c1DeltaSamples} samples (gate 0..${LENGTH_GATE_SAMPLES})`);
    if (!lengthOk(c1DeltaSamples)) fail(`(c1) length check: output minus the longest stem is ${c1DeltaSamples} samples (gate 0..${LENGTH_GATE_SAMPLES})`);

    cleanup(aOut, aRef);
    duBytes(scratch);

    // -----------------------------------------------------------------
    // (b) Mute check
    // -----------------------------------------------------------------
    console.log(`\n(b) mute check — one stem muted via planRemix vs. a hand-built sum of the other ${files.length - 1}`);
    const muteId = files[0].id;
    const bOut = join(scratch, 'b-muted.wav');
    const bRender = renderMix(files, { [muteId]: { muted: true } }, bOut);
    if (bRender.status !== 0) fail('(b) muted-set render failed');

    const others = files.filter((f) => f.id !== muteId);
    const bRef = join(scratch, 'b-ref.wav');
    const bRefArgs = [
      '-hide_banner', '-nostats',
      ...others.flatMap((f) => ['-i', f.path]),
      '-filter_complex', `amix=inputs=${others.length}:normalize=0:duration=longest[m]`,
      '-map', '[m]', '-c:a', 'pcm_f32le', '-ar', '48000', '-y', bRef,
    ];
    const bRefResult = ff(bRefArgs);
    if (bRefResult.status !== 0) {
      console.error(logOf(bRefResult));
      fail('(b) reference amix render failed');
    }
    duBytes(scratch);

    const bMuted = measureFile(bOut);
    const bRefM = measureFile(bRef);
    const bDiff = Math.abs(bMuted.rmsDb - bRefM.rmsDb);
    const bNull = nullResidualRmsDb(bOut, bRef);
    console.log(`  muted ("${muteId}" out)  RMS ${bMuted.rmsDb.toFixed(3)} dB   samples ${bMuted.samples}`);
    console.log(`  sum of the other ${others.length}       RMS ${bRefM.rmsDb.toFixed(3)} dB   samples ${bRefM.samples}`);
    console.log(`  |RMS diff| ${bDiff.toFixed(4)} dB   null-residual RMS ${bNull === -Infinity ? '-inf' : bNull.toFixed(2)} dB`);
    if (!(bDiff < 0.01)) fail(`(b) mute check: RMS differs by ${bDiff.toFixed(4)} dB (limit 0.01 dB)`);
    if (!isNullResidual(bNull)) fail(`(b) mute check: null-residual RMS ${bNull} dB is not -inf or below ${NULL_RESIDUAL_GATE_DB} dB — muted-set and reference are not actually the same signal`);

    cleanup(bOut, bRef);
    duBytes(scratch);

    // -----------------------------------------------------------------
    // (c2) Padding — a real length mismatch, not two equal stems.
    // -----------------------------------------------------------------
    console.log('\n(c2) length check — one stem trimmed short, to actually exercise apad/-t');
    const trimId = files[1].id;
    const trimmed = join(scratch, 'c2-trimmed.wav');
    const fullSetLongestSec = Math.max(...stemProbe.map((s) => s.info?.durationSec ?? 0));
    const trimTo = Math.round(fullSetLongestSec * 0.95 * 100) / 100; // ~5% shorter than the rest
    ff(['-hide_banner', '-nostats', '-i', files[1].path, '-t', String(trimTo), '-c', 'copy', '-y', trimmed]);
    const trimmedFiles = files.map((f) => (f.id === trimId ? { ...f, path: trimmed } : f));
    const c2Out = join(scratch, 'c2-out.wav');
    const c2Render = renderMix(trimmedFiles, {}, c2Out);
    if (c2Render.status !== 0) fail('(c2) padded render failed');
    const c2Out_m = measureFile(c2Out);
    const fullLengthSamples = longestStemSamples; // the other stems are unchanged
    const c2Delta = fullLengthSamples !== null && c2Out_m.samples !== null ? c2Out_m.samples - fullLengthSamples : null;
    const padNote = c2Render.notes.find((n) => n.includes('padded by'));
    console.log(`  trimmed "${trimId}" to ${trimTo} s; longestSec used: ${c2Render.longestSec} (-t ${c2Render.longestSec === null ? 'none' : remixBoundSec(c2Render.longestSec)})`);
    console.log(`  notes: ${JSON.stringify(c2Render.notes)}`);
    console.log(`  output samples ${c2Out_m.samples} vs. full-length ${fullLengthSamples} — delta ${c2Delta} (gate 0..${LENGTH_GATE_SAMPLES})`);
    if (!lengthOk(c2Delta)) fail(`(c2) padding check: padded output minus full length is ${c2Delta} samples (gate 0..${LENGTH_GATE_SAMPLES})`);
    if (!padNote) fail('(c2) padding check: no "padded by" note was produced for the trimmed stem');
    cleanup(trimmed, c2Out);
    duBytes(scratch);

    // -----------------------------------------------------------------
    // (d) Resample check
    // -----------------------------------------------------------------
    console.log('\n(d) resample check — one stem copied to 44.1 kHz among otherwise-48 kHz stems');
    const resampleId = files[2].id;
    const resampled = join(scratch, 'd-44100.wav');
    ff(['-hide_banner', '-nostats', '-i', files[2].path, '-ar', '44100', '-y', resampled]);
    const resampledInfo = probe(resampled);
    console.log(`  made a 44.1 kHz copy of "${resampleId}": probed at ${resampledInfo?.sampleRate} Hz`);
    const resampledFiles = files.map((f) => (f.id === resampleId ? { ...f, path: resampled } : f));
    const dOut = join(scratch, 'd-out.wav');
    const dRender = renderMix(resampledFiles, {}, dOut);
    const dOutInfo = probe(dOut);
    const resampleNote = dRender.notes.find((n) => n.includes('resampled from'));
    console.log(`  render exit status: ${dRender.status}`);
    console.log(`  output sample rate: ${dOutInfo?.sampleRate} Hz`);
    console.log(`  notes: ${JSON.stringify(dRender.notes)}`);
    if (dRender.status !== 0) fail('(d) resample check: the render did not exit 0');
    if (dOutInfo?.sampleRate !== 48000) fail(`(d) resample check: output sample rate was ${dOutInfo?.sampleRate}, expected 48000`);
    if (!resampleNote) fail('(d) resample check: no "resampled from" note was produced');
    cleanup(resampled, dOut);
    duBytes(scratch);

    // -----------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------
    const elapsedMs = Date.now() - t0;
    console.log('\n--- summary ---');
    console.log(`elapsed: ${(elapsedMs / 1000).toFixed(1)} s`);
    console.log(`peak scratch size (this run's work dir): ${fmtBytes(maxScratchBytes)}`);
    console.log(`render time, ${files.length}-stem buildRemixArgs call (dev box, ffmpeg 7.0.2): ${aRender.ms} ms`);
    if (failures.length) {
      console.log(`\n${failures.length} check(s) FAILED:`);
      for (const f of failures) console.log(`  - ${f}`);
      process.exitCode = 1;
    } else {
      console.log('\nall checks PASSED.');
      process.exitCode = 0;
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
