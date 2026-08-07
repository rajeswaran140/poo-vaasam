/**
 * align-lyrics — time Raj's verbatim lyrics against a song's own audio, with no
 * dependency on YouTube.
 *
 *   npx tsx scripts/align-lyrics.ts <audio.wav> --lyrics <lyrics.txt>
 *                                   [--out song.srt] [--model small] [--json]
 *
 * WHY A SCRIPT. Separation and recognition need Python, a few hundred MB of
 * model, and minutes of CPU per song; the masters are already sitting on disk.
 * Uploading gigabytes to analyse them would be absurd — the same reasoning as
 * screen-takes.ts. The judgement is all in libraries (local-asr-clock,
 * caption-alignment) so it stays unit-tested; this file only runs the tools and
 * formats.
 *
 * WHAT IT GUARANTEES. Timings come from the machine, words come from Raj, and
 * `verifyRoundTrip` fails the whole run rather than let a recognised word reach
 * a caption. The recogniser mishears freely — measured on வானவில்லே it heard
 * மலை for மழை — and that is fine, because its text is never published.
 *
 * READ-ONLY on the input. Writes only the .srt you ask for.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  alignLyrics,
  verifyRoundTrip,
  toSrt,
  splitLyricsIntoCards,
} from '@/lib/caption-alignment';
import {
  wordsToCues,
  clockCoverage,
  captionShapeProblem,
  type AsrWord,
} from '@/lib/local-asr-clock';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] ?? null : null;
};
const has = (name: string) => process.argv.includes(name);

interface SensorOutput {
  durationSec: number;
  source: string;
  separated: boolean;
  words: AsrWord[];
}

function runSensor(audio: string, model: string, workdir: string): SensorOutput {
  const res = spawnSync(
    'python3',
    ['scripts/lib/asr_words.py', audio, '--model', model, '--workdir', workdir],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] }
  );
  if (res.status !== 0) throw new Error(`asr_words.py failed (exit ${res.status})`);
  return JSON.parse(res.stdout) as SensorOutput;
}

function main() {
  const audio = process.argv[2];
  const lyricsPath = arg('--lyrics');
  if (!audio || !lyricsPath) {
    throw new Error('usage: align-lyrics.ts <audio.wav> --lyrics <file.txt> [--out out.srt] [--model small] [--json]');
  }
  if (!existsSync(audio)) throw new Error(`no such audio: ${audio}`);
  if (!existsSync(lyricsPath)) throw new Error(`no such lyrics: ${lyricsPath}`);

  const lyrics = readFileSync(lyricsPath, 'utf8');
  const cards = splitLyricsIntoCards(lyrics);
  if (!cards.length) throw new Error('lyrics file produced no cards — check the file');

  // Separation + recognition is ~15 minutes of CPU per song. Re-aligning the
  // SAME song against corrected lyrics should not pay that twice — the words
  // are a property of the audio, not of the lyrics file.
  const wordsIn = arg('--words');
  let sensor: SensorOutput;
  if (wordsIn) {
    if (!existsSync(wordsIn)) throw new Error(`no such words file: ${wordsIn}`);
    sensor = JSON.parse(readFileSync(wordsIn, 'utf8')) as SensorOutput;
    console.log(`(reusing ${sensor.words.length} recognised words from ${wordsIn})`);
  } else {
    const workdir = mkdtempSync(join(tmpdir(), 'align-'));
    sensor = runSensor(audio, arg('--model') ?? 'small', workdir);
    const save = arg('--save-words');
    if (save) writeFileSync(save, JSON.stringify(sensor));
  }

  const cues = wordsToCues(sensor.words);
  const coverage = clockCoverage(cues, sensor.durationSec);
  const result = alignLyrics(cards, cues);

  // The line that must never be softened: his text, byte for byte, or nothing.
  const intact = verifyRoundTrip(result.cues, cards);
  if (!intact) {
    throw new Error(
      'ROUND-TRIP FAILED — the aligned cues do not reproduce the lyrics byte-for-byte. ' +
      'Refusing to emit a caption file; a machine word must never reach a caption.'
    );
  }

  // ⚠️ A GOOD CLOCK AND AN INTACT ROUND-TRIP ARE NOT ENOUGH — see
  // captionShapeProblem. Both passed on 2026-08-07 while the file held all 128
  // lines in one six-second caption. Refuse to write rather than hand over
  // something that looks fine in the summary and is useless in Studio.
  const shape = captionShapeProblem(result.cues, sensor.durationSec);
  if (shape) throw new Error(`UNUSABLE CAPTION FILE — ${shape}`);

  const srt = toSrt(result.cues);
  const out = arg('--out');
  if (out) writeFileSync(out, srt);

  if (has('--json')) {
    console.log(JSON.stringify({
      audio,
      durationSec: sensor.durationSec,
      separated: sensor.separated,
      words: sensor.words.length,
      cues: cues.length,
      coverage,
      anchoredLines: result.anchoredLines,
      interpolatedLines: result.interpolatedLines,
      warnings: result.warnings,
      roundTrip: intact,
      out,
    }, null, 2));
    return;
  }

  const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  console.log(`\n${audio}  (${mins(sensor.durationSec)})`);
  console.log(`  vocal separated : ${sensor.separated ? 'yes' : 'NO — accuracy will be worse'}`);
  console.log(`  words recognised: ${sensor.words.length}`);
  console.log(`  clock cues      : ${cues.length}`);
  console.log(`  clock coverage  : ${(coverage * 100).toFixed(1)}% of the track`);
  console.log(`  lines anchored  : ${result.anchoredLines} (interpolated ${result.interpolatedLines})`);
  console.log(`  round-trip      : PASS — every caption is Raj's text verbatim`);
  for (const warning of result.warnings) console.log(`  ⚠️  ${warning}`);

  // Coverage is the number that catches the failure this exists to prevent: a
  // clock that stops early yields captions that drift and then stop.
  if (coverage < 0.75) {
    console.log(`\n  ⚠️  COVERAGE LOW — the clock reaches only ${(coverage * 100).toFixed(0)}% of the song.`);
    console.log('     Captions past that point are interpolated guesses. Check the tail for an');
    console.log('     instrumental outro (fine) versus the recogniser giving up (not fine).');
  }

  if (out) console.log(`\n  wrote ${out}`);
  else console.log('\n  (no --out given; nothing written)');
}

main();
