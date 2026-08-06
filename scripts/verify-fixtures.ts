/**
 * verify-fixtures — check the measurement chain against audio whose correct
 * answer is known independently of the chain.
 *
 *   bash scripts/make-fixtures.sh
 *   npx tsx scripts/verify-fixtures.ts [dir] [--write]
 *
 * WHY THIS IS NOT A JEST TEST. It needs ffmpeg and ~35 MB of generated WAV, and
 * CI has neither. So it runs on demand, and what it produces — golden.json — is
 * what the hermetic suite asserts against. The division matters: this script
 * establishes ground truth, __tests__/lib/loudness-calibration.test.ts pins the
 * RULES to it without ffmpeg.
 *
 * It deliberately goes through the SAME functions the Lambda worker calls
 * (measureArgs, parseLoudnormStats, buildPass2Loudnorm, parseNormalizationType,
 * buildTimelineArgs, parseTimeline). A corpus that measured audio its own way
 * would prove the corpus correct and say nothing about production.
 *
 * `--write` refreshes the measured half of golden.json. It never touches the
 * derived half: an arithmetic expectation is not something a measurement gets
 * to overwrite. If they disagree, that is the finding.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPass1Loudnorm, parseLoudnormStats, buildPass2Loudnorm, parseNormalizationType,
} from '@/lib/loudness-measure';
import { buildTimelineArgs } from '@/lib/master-analysis';
import { predictedLinearOutputPeak, TRUE_PEAK_CEILING_DBTP } from '@/lib/take-screen';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const ff = (a: string[]) => spawnSync(FFMPEG, a, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const log = (r: { stdout?: string; stderr?: string }) => `${r.stdout ?? ''}${r.stderr ?? ''}`;

const TARGET = -14;

interface Measured {
  integratedLufs: number | null;
  lra: number | null;
  truePeakDbtp: number | null;
  samplePeakDbfs: number | null;
  normalizationType: 'linear' | 'dynamic' | null;
}

interface Golden {
  ffmpegVersions: string[];
  fixtures: Record<string, {
    /**
     * `arithmetic` — the value follows from BS.1770 and is not negotiable.
     * `frozen`     — the value is whatever ffmpeg said on the day, kept to
     *                detect drift. A frozen value failing means a dependency
     *                changed; a derived value failing means something is wrong.
     */
    source: 'arithmetic' | 'frozen';
    derived?: Partial<Measured>;
    tolerance: { integratedLu?: number; lraLu?: number; truePeakDb?: number };
    asserts: string[];
    measured?: Measured;
  }>;
}

/** Sample peak via astats — the only way to show true peak exceeding it. */
function samplePeak(path: string): number | null {
  const out = log(ff(['-hide_banner', '-nostdin', '-nostats', '-i', path, '-af', 'astats=metadata=1', '-f', 'null', '-']));
  const m = out.match(/Peak level dB:\s*(-?[\d.]+|inf)/);
  return m && m[1] !== 'inf' ? Number(m[1]) : null;
}

function measure(path: string): Measured {
  const timeline = log(ff(buildTimelineArgs(path)));
  const grab = (re: RegExp) => { const m = [...timeline.matchAll(re)].pop(); return m ? Number(m[1]) : null; };

  const pass1 = log(ff([
    '-hide_banner', '-nostats', '-i', path, '-af', buildPass1Loudnorm(TARGET), '-f', 'null', '-',
  ]));
  const stats = parseLoudnormStats(pass1);
  let normalizationType: 'linear' | 'dynamic' | null = null;
  if (stats) {
    const pass2 = log(ff([
      '-hide_banner', '-nostdin', '-nostats', '-i', path,
      '-af', buildPass2Loudnorm(stats, TARGET), '-f', 'null', '-',
    ]));
    normalizationType = parseNormalizationType(pass2);
  }

  return {
    integratedLufs: grab(/I:\s*(-?[\d.]+)\s*LUFS/g),
    lra: grab(/LRA:\s*(-?[\d.]+)\s*LU/g),
    truePeakDbtp: grab(/Peak:\s*(-?[\d.]+)\s*dBFS/g),
    samplePeakDbfs: samplePeak(path),
    normalizationType,
  };
}

const near = (a: number | null | undefined, b: number | null | undefined, tol: number) =>
  typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol;

function main() {
  const dir = process.argv.find((a, i) => i >= 2 && !a.startsWith('--')) ?? 'test/fixtures/audio';
  const goldenPath = join(dir, 'golden.json');
  if (!existsSync(goldenPath)) throw new Error(`no golden.json in ${dir}`);
  const golden: Golden = JSON.parse(readFileSync(goldenPath, 'utf8'));

  const version = (log(ff(['-version'])).split('\n')[0] ?? '').replace(/\s+Copyright.*$/, '').trim();
  console.log(`${version}\n`);

  let failures = 0;
  for (const [file, spec] of Object.entries(golden.fixtures)) {
    const path = join(dir, file);
    if (!existsSync(path)) {
      console.log(`SKIP  ${file} — not generated (run scripts/make-fixtures.sh)`);
      continue;
    }
    const m = measure(path);
    const problems: string[] = [];

    // Derived expectations first — these are the ones that carry authority.
    if (spec.derived) {
      const d = spec.derived;
      if (typeof d.integratedLufs === 'number' && !near(m.integratedLufs, d.integratedLufs, spec.tolerance.integratedLu ?? 0.1))
        problems.push(`integrated ${m.integratedLufs} vs derived ${d.integratedLufs}`);
      if (typeof d.truePeakDbtp === 'number' && !near(m.truePeakDbtp, d.truePeakDbtp, spec.tolerance.truePeakDb ?? 0.7))
        problems.push(`true peak ${m.truePeakDbtp} vs derived ${d.truePeakDbtp}`);
      if (typeof d.samplePeakDbfs === 'number' && !near(m.samplePeakDbfs, d.samplePeakDbfs, 0.02))
        problems.push(`sample peak ${m.samplePeakDbfs} vs derived ${d.samplePeakDbfs}`);
      if (d.normalizationType && m.normalizationType !== d.normalizationType)
        problems.push(`normalization ${m.normalizationType} vs expected ${d.normalizationType}`);
    }

    // Then drift against whatever was frozen last time.
    const prev = spec.measured;
    if (prev && !process.argv.includes('--write')) {
      if (!near(m.integratedLufs, prev.integratedLufs, 0.1)) problems.push(`DRIFT integrated ${prev.integratedLufs} → ${m.integratedLufs}`);
      if (!near(m.lra, prev.lra, 0.5)) problems.push(`DRIFT lra ${prev.lra} → ${m.lra}`);
      if (m.normalizationType !== prev.normalizationType) problems.push(`DRIFT normalization ${prev.normalizationType} → ${m.normalizationType}`);
    }

    // The predictor must agree with what loudnorm actually decided. This is the
    // whole point of the ladder fixture: take-screen refuses a take because it
    // predicts compression, and here that prediction is checked against ffmpeg
    // rather than against another test.
    if (typeof m.integratedLufs === 'number' && typeof m.truePeakDbtp === 'number' && m.normalizationType) {
      const predicted = predictedLinearOutputPeak(m.integratedLufs, m.truePeakDbtp, TARGET);
      const predictsDynamic = predicted > TRUE_PEAK_CEILING_DBTP;
      const actuallyDynamic = m.normalizationType === 'dynamic';
      // A flat source is dynamic for an unrelated reason — see the LRA=0.00
      // trap — so it cannot corroborate the predictor either way.
      if (m.lra !== 0 && predictsDynamic !== actuallyDynamic)
        problems.push(`predictor says ${predictsDynamic ? 'dynamic' : 'linear'} (peak would be ${predicted}), ffmpeg did ${m.normalizationType}`);
    }

    spec.measured = m;
    const ok = problems.length === 0;
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${file}`);
    console.log(`        I=${m.integratedLufs} LRA=${m.lra} TP=${m.truePeakDbtp} SP=${m.samplePeakDbfs} pass2=${m.normalizationType}`);
    for (const p of problems) console.log(`        ✗ ${p}`);
  }

  if (process.argv.includes('--write')) {
    if (!golden.ffmpegVersions.includes(version)) golden.ffmpegVersions.push(version);
    writeFileSync(goldenPath, `${JSON.stringify(golden, null, 2)}\n`);
    console.log(`\nwrote ${goldenPath}`);
  }

  console.log(failures ? `\n${failures} fixture(s) failed` : '\nall fixtures agree');
  process.exitCode = failures ? 1 : 0;
}

main();
