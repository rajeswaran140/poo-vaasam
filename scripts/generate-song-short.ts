/**
 * generate-song-short — auto-cut a hook-first vertical clip for YouTube Shorts
 * and WhatsApp Status from a song's audio + cover.
 *
 * Why: cold viewers are lost in the first ~15s (retention analysis on the
 * channel). A Short should OPEN on the hook, not the intro. This script measures
 * the track's loudness with ffmpeg's `ebur128` filter, picks the most energetic
 * window (≈ the chorus) via src/lib/hook-window.ts, and renders a 1080×1920 MP4:
 * the square cover as a centred card over a blurred full-bleed backdrop, with a
 * short audio fade in/out. No YouTube download — pulls the MP3 from our own CDN.
 *
 *   npx tsx scripts/generate-song-short.ts \
 *     --audio https://d2cdoh43143xxa.cloudfront.net/audio/poem-music/song.mp3 \
 *     --cover https://d2cdoh43143xxa.cloudfront.net/images/song.png \
 *     --out /tmp/song-short.mp4 [--seconds 30] [--min-start 8] [--title "…"]
 *
 * Outputs the MP4 locally for review/upload; it does not publish anything.
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEbur128Loudness, pickHookWindow } from '@/lib/hook-window';

interface Args {
  audio: string;
  cover: string;
  out: string;
  seconds: number;
  minStart: number;
  title?: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const audio = get('--audio');
  const cover = get('--cover');
  const out = get('--out');
  if (!audio || !cover || !out) {
    throw new Error('Required: --audio <url|path> --cover <url|path> --out <file.mp4>');
  }
  return {
    audio,
    cover,
    out,
    seconds: Number(get('--seconds') ?? 30),
    minStart: Number(get('--min-start') ?? 8),
    title: get('--title'),
  };
}

/** Fetch a URL to a local temp file; pass through an existing local path. */
async function localise(src: string, dir: string, name: string): Promise<string> {
  if (!/^https?:\/\//i.test(src)) {
    if (!existsSync(src)) throw new Error(`File not found: ${src}`);
    return src;
  }
  const res = await fetch(src);
  if (!res.ok) throw new Error(`Download failed ${res.status} for ${src}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const path = join(dir, name);
  writeFileSync(path, buf);
  return path;
}

function run(bin: string, args: string[]): { stdout: string; stderr: string } {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${bin} exited ${r.status}\n${r.stderr}`);
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function probeDuration(path: string): number {
  const { stdout } = run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', path,
  ]);
  return Number(stdout.trim());
}

/** Measure short-term loudness across the whole track (one ffmpeg pass). */
function measureLoudness(audioPath: string) {
  // ebur128 prints `t: … M: …` lines to stderr; -f null discards the audio.
  const { stderr } = run('ffmpeg', [
    '-nostats', '-hide_banner', '-i', audioPath,
    '-filter_complex', 'ebur128', '-f', 'null', '-',
  ]);
  return parseEbur128Loudness(stderr);
}

function render(args: Args, coverPath: string, audioPath: string, start: number) {
  const secs = args.seconds;
  const fadeOutStart = Math.max(0, secs - 1);
  const vf = [
    // Blurred, slightly-darkened full-bleed backdrop from the cover.
    '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:4,eq=brightness=-0.06[bg]',
    // The cover itself as a centred card (square covers → ~1000px).
    '[0:v]scale=1000:1000:force_original_aspect_ratio=decrease[fg]',
    '[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]',
  ].join(';');

  run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-loop', '1', '-framerate', '30', '-i', coverPath,
    '-ss', String(start), '-t', String(secs), '-i', audioPath,
    '-filter_complex', vf,
    '-map', '[v]', '-map', '1:a',
    '-af', `afade=t=in:st=0:d=0.4,afade=t=out:st=${fadeOutStart}:d=1`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest',
    args.out,
  ]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = mkdtempSync(join(tmpdir(), 'song-short-'));

  const [audioPath, coverPath] = await Promise.all([
    localise(args.audio, dir, 'audio'),
    localise(args.cover, dir, 'cover'),
  ]);

  const total = probeDuration(audioPath);
  if (!Number.isFinite(total) || total <= 0) throw new Error('Could not read audio duration.');
  if (args.seconds > total) args.seconds = Math.floor(total);

  const samples = measureLoudness(audioPath);
  const hook = pickHookWindow(samples, {
    windowSec: args.seconds,
    minStartSec: args.minStart,
    totalSec: total,
  });
  if (!hook) throw new Error('Could not detect a hook window.');

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  console.log(`🎵 ${args.title ?? args.audio}`);
  console.log(`   track ${mmss(total)} · ${samples.length} loudness samples`);
  console.log(`   hook  ${mmss(hook.start)}–${mmss(hook.end)} (avg ${hook.avgLufs.toFixed(1)} LUFS)`);

  render(args, coverPath, audioPath, hook.start);

  const outDur = probeDuration(args.out);
  console.log(`✅ ${args.out} · ${outDur.toFixed(1)}s · 1080×1920`);
}

main().catch((e) => {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
});
