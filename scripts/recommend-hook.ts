/**
 * recommend-hook — print the Studio-Trim recommendation for a song WITHOUT
 * rendering a clip. The lightweight half of the first-15s hook tool: point it at
 * a song's CDN MP3 and it tells you where the chorus starts and exactly how to
 * trim the main video to open on it (the channel's #1 retention lever).
 *
 *   npx tsx scripts/recommend-hook.ts \
 *     --audio https://d2cdoh43143xxa.cloudfront.net/audio/poem-music/song.mp3 \
 *     [--window 30] [--min-start 8] [--title "…"]
 *
 * No YouTube download — pulls the MP3 from our own CDN. The pick + advice logic
 * is pure and unit-tested (hook-window.ts, hook-recommendation.ts); this script
 * is just the ffmpeg measurement + I/O around them.
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEbur128Loudness, pickHookWindow } from '@/lib/hook-window';
import { buildHookRecommendation, formatClock } from '@/lib/hook-recommendation';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function localise(src: string, dir: string): Promise<string> {
  if (!/^https?:\/\//i.test(src)) {
    if (!existsSync(src)) throw new Error(`File not found: ${src}`);
    return src;
  }
  const res = await fetch(src);
  if (!res.ok) throw new Error(`Download failed ${res.status} for ${src}`);
  const path = join(dir, 'audio');
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  return path;
}

function run(bin: string, args: string[]): string {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${bin} exited ${r.status}\n${r.stderr}`);
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
}

async function main() {
  const audio = arg('--audio');
  if (!audio) throw new Error('Required: --audio <url|path> [--window 30] [--min-start 8] [--title "…"]');
  const windowSec = Number(arg('--window') ?? 30);
  const minStart = Number(arg('--min-start') ?? 8);
  const title = arg('--title');

  const dir = mkdtempSync(join(tmpdir(), 'hook-rec-'));
  const audioPath = await localise(audio, dir);

  const durOut = run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', audioPath,
  ]);
  const total = Number(durOut.trim());
  if (!Number.isFinite(total) || total <= 0) throw new Error('Could not read audio duration.');

  const stderr = run('ffmpeg', ['-nostats', '-hide_banner', '-i', audioPath, '-filter_complex', 'ebur128', '-f', 'null', '-']);
  const samples = parseEbur128Loudness(stderr);
  const hook = pickHookWindow(samples, { windowSec: Math.min(windowSec, total), minStartSec: minStart, totalSec: total });
  if (!hook) throw new Error('Could not detect a hook window.');

  const rec = buildHookRecommendation(hook);
  console.log(`🎵 ${title ?? audio}`);
  console.log(`   track ${formatClock(total)} · ${samples.length} loudness samples`);
  console.log(`   hook  ${rec.windowLabel} (avg ${hook.avgLufs.toFixed(1)} LUFS) · verdict: ${rec.verdict}`);
  console.log(`✂️  ${rec.trimInstruction}`);
}

main().catch((e) => {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
});
