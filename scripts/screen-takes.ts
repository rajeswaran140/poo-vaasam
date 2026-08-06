/**
 * screen-takes — remove the takes that CANNOT work, before you listen.
 *
 *   npx tsx scripts/screen-takes.ts <folder> [--role lead-in] [--expect 251] [--json]
 *
 * WHY A SCRIPT AND NOT A PAGE. Screening a song's 50-70 generations means
 * reading ~4 GB of WAV. Uploading that to look at it would be absurd, and the
 * files are already sitting in a download folder. This runs where they are.
 *
 * Read-only: it measures and prints. It never moves, renames or deletes a file
 * — the durable asset is the prompt→outcome record, and a screen that discards
 * audio would destroy the evidence it was wrong.
 *
 * Every rule lives in src/lib/take-screen.ts and is unit-tested; this file only
 * runs ffmpeg and formats.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import {
  screenTake, summariseScreen, type TakeMeasurements, type TakeRole,
} from '@/lib/take-screen';
import {
  buildSilenceArgs, buildTimelineArgs, parseSilences, parseTimeline,
  leadingSilenceSec, trailingSilenceSec, tailDropLu,
} from '@/lib/master-analysis';
import { parseSourceInfo } from '@/lib/loudness-measure';

const AUDIO = new Set(['.wav', '.mp3', '.flac', '.m4a', '.aiff', '.aif']);
const ff = (a: string[]) => spawnSync('ffmpeg', a, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const log = (r: { stdout?: string; stderr?: string }) => `${r.stdout ?? ''}${r.stderr ?? ''}`;

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] ?? null : null;
};

/** Two ffmpeg passes per file — the same ones the Studio's analysis uses. */
function measure(path: string, file: string): TakeMeasurements {
  const header = log(ff(['-hide_banner', '-i', path]));
  const durationSec = parseSourceInfo(header)?.durationSec ?? null;

  const spans = parseSilences(log(ff(buildSilenceArgs(path))), durationSec ?? 0);
  const trailing = trailingSilenceSec(spans, durationSec ?? 0);

  const tl = log(ff(buildTimelineArgs(path)));
  const integrated = [...tl.matchAll(/I:\s*(-?[\d.]+)\s*LUFS/g)].pop();
  const lra = [...tl.matchAll(/LRA:\s*(-?[\d.]+)\s*LU/g)].pop();
  const peak = [...tl.matchAll(/Peak:\s*(-?[\d.]+)\s*dBFS/g)].pop();

  return {
    file,
    durationSec,
    leadingSilenceSec: leadingSilenceSec(spans),
    trailingSilenceSec: trailing,
    tailDropLu: tailDropLu(parseTimeline(tl), trailing),
    integratedLufs: integrated ? Number(integrated[1]) : null,
    lra: lra ? Number(lra[1]) : null,
    truePeakDbtp: peak ? Number(peak[1]) : null,
  };
}

function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: screen-takes.ts <folder> [--role lead-in] [--expect <seconds>] [--json]');
  const role = (arg('--role') as TakeRole) ?? 'song';
  const expectRaw = arg('--expect');
  const expectedDurationSec = expectRaw ? Number(expectRaw) : null;

  const files = readdirSync(dir)
    .filter((f) => AUDIO.has(extname(f).toLowerCase()))
    .filter((f) => statSync(join(dir, f)).isFile())
    .sort();
  if (!files.length) { console.log(`No audio files in ${dir}`); return; }

  const results = files.map((f, i) => {
    if (!process.argv.includes('--json')) process.stderr.write(`\rmeasuring ${i + 1}/${files.length}…`);
    return screenTake(measure(join(dir, f), f), { role, expectedDurationSec });
  });
  process.stderr.write('\r');

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ role, expectedDurationSec, results, summary: summariseScreen(results) }, null, 2));
    return;
  }

  const s = summariseScreen(results);
  console.log(`\nScreened ${s.total} take(s) as "${role}".\n`);
  console.log(`  SHORTLIST  ${s.shortlisted}   ← worth listening to`);
  console.log(`  rejected   ${s.rejected}`);
  if (s.unmeasured) console.log(`  unmeasured ${s.unmeasured}   (ffmpeg could not read these — NOT rejected)`);

  console.log('\n— SHORTLIST —');
  for (const r of results.filter((x) => x.verdict === 'shortlist')) {
    const fixes = r.findings.map((f) => f.code).join(', ');
    console.log(`  ${r.file}${fixes ? `   (${fixes})` : ''}`);
  }
  if (s.rejected) {
    console.log('\n— rejected, with the reason —');
    for (const r of results.filter((x) => x.verdict === 'reject')) {
      console.log(`  ${r.file}`);
      for (const f of r.findings.filter((x) => x.severity === 'blocker')) console.log(`     ${f.detail}`);
    }
  }
  if (s.unmeasured) {
    console.log('\n— unmeasured (look at these yourself) —');
    for (const r of results.filter((x) => x.verdict === 'unmeasured')) console.log(`  ${r.file}`);
  }
  console.log(`\n${s.rejected} of ${s.total} removed from the listening pile. Nothing was moved or deleted.`);
}

main();
