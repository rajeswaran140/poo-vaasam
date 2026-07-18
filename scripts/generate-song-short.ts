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
 *     --out /tmp/song-short.mp4 [--seconds 30] [--min-start 8] [--title "…"] \
 *     [--lead-in 4] [--lyrics path/to/full-song.srt]
 *
 * With --lyrics, the cues overlapping the chosen hook window are burned onto the
 * clip as synchronised Tamil lyrics in a rounded lozenge (Pillow shapes Tamil;
 * ffmpeg's drawtext/libass do not on this box — see scripts/lib/render-lyric-cards.py).
 *
 * Outputs the MP4 locally for review/upload; it does not publish anything.
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEbur128Loudness, pickHookWindow } from '@/lib/hook-window';
import { parseSrt, selectWindowCues, type WindowedCue } from '@/lib/lyric-cues';

/**
 * WhatsApp Status splits any clip longer than 30s into two segments (a clean 30s
 * piece + a broken remainder). Cap output UNDER 30s with a safety margin so every
 * clip posts as one clean Status. This is a hard ceiling, not just a default.
 */
const STATUS_MAX_SECONDS = 29;

/**
 * Open the clip this many seconds BEFORE the loudest moment so it rises into the
 * hook rather than peaking at second ~3 and deflating. Retention curves on the
 * channel's Shorts show a cliff at ~5–15s when clips front-load the peak; a
 * short build-in keeps energy climbing through the seconds viewers were leaving.
 */
const DEFAULT_LEAD_IN_SECONDS = 4;

interface Args {
  audio: string;
  cover: string;
  out: string;
  seconds: number;
  minStart: number;
  leadIn: number;
  title?: string;
  lyrics?: string;
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
  const lyrics = get('--lyrics');
  if (lyrics && !existsSync(lyrics)) throw new Error(`Lyrics SRT not found: ${lyrics}`);
  return {
    audio,
    cover,
    out,
    seconds: Math.min(Number(get('--seconds') ?? STATUS_MAX_SECONDS), STATUS_MAX_SECONDS),
    minStart: Number(get('--min-start') ?? 8),
    leadIn: Number(get('--lead-in') ?? DEFAULT_LEAD_IN_SECONDS),
    title: get('--title'),
    lyrics,
  };
}

const HERE = dirname(fileURLToPath(import.meta.url));
const LYRIC_FONT = join(HERE, 'assets/fonts/BalooThambi2-600.ttf');
const LYRIC_RENDERER = join(HERE, 'lib/render-lyric-cards.py');
/** Caption line sits at 75% of frame height — off the busy lower third, matching
 *  the on-YouTube caption position Raj signed off on for the full song. */
const CAPTION_CENTER_FRAC = 0.75;

interface CaptionCard extends WindowedCue {
  png: string;
}

/** Render one rounded lyric PNG per windowed cue via the Pillow helper. */
function renderCaptionCards(cues: WindowedCue[], dir: string): CaptionCard[] {
  if (cues.length === 0) return [];
  const spec = {
    font: LYRIC_FONT,
    width: 1080,
    height: 1920,
    centerY: Math.round(1920 * CAPTION_CENTER_FRAC),
    outDir: dir,
    cues: cues.map((c, i) => ({ i, text: c.text })),
  };
  const specPath = join(dir, 'cues.json');
  writeFileSync(specPath, JSON.stringify(spec));
  const r = spawnSync('python3', [LYRIC_RENDERER, specPath], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(
      `Lyric card render failed (python3 + Pillow-with-raqm required).\n${r.stderr ?? r.error}`,
    );
  }
  return cues.map((c, i) => ({ ...c, png: join(dir, `cap_${i}.png`) }));
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

function render(
  args: Args,
  coverPath: string,
  audioPath: string,
  start: number,
  captions: CaptionCard[] = [],
) {
  const secs = args.seconds;
  const fadeOutStart = Math.max(0, secs - 1);

  // Blurred full-bleed backdrop + centred cover card (square covers → ~1000px).
  const base =
    '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:4,eq=brightness=-0.06[bg];' +
    '[0:v]scale=1000:1000:force_original_aspect_ratio=decrease[fg];' +
    '[bg][fg]overlay=(W-w)/2:(H-h)/2';

  // Each caption PNG is an extra input, overlaid only during its cue's window.
  // Caption inputs start at ffmpeg index 2 (0=cover, 1=audio).
  let vf: string;
  if (captions.length === 0) {
    vf = `${base},format=yuv420p[v]`;
  } else {
    const parts = [`${base}[base]`];
    let prev = 'base';
    captions.forEach((c, k) => {
      const next = k === captions.length - 1 ? 'cap' : `o${k}`;
      const en = `between(t,${c.start.toFixed(3)},${c.end.toFixed(3)})`;
      parts.push(`[${prev}][${k + 2}:v]overlay=0:0:enable='${en}'[${next}]`);
      prev = next;
    });
    parts.push(`[${prev}]format=yuv420p[v]`);
    vf = parts.join(';');
  }

  const captionInputs = captions.flatMap((c) => ['-i', c.png]);

  run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-loop', '1', '-framerate', '30', '-i', coverPath,
    '-ss', String(start), '-t', String(secs), '-i', audioPath,
    ...captionInputs,
    '-filter_complex', vf,
    '-map', '[v]', '-map', '1:a',
    '-af', `afade=t=in:st=0:d=0.4,afade=t=out:st=${fadeOutStart}:d=1`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest',
    // Hard-cap the muxed OUTPUT: -shortest alone lets x264 flush frames past the
    // audio (~0.7s), pushing clips over WhatsApp's 30s limit. Output -t is exact.
    '-t', String(secs),
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
    leadInSec: args.leadIn,
  });
  if (!hook) throw new Error('Could not detect a hook window.');

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  console.log(`🎵 ${args.title ?? args.audio}`);
  console.log(`   track ${mmss(total)} · ${samples.length} loudness samples`);
  console.log(`   hook  ${mmss(hook.start)}–${mmss(hook.end)} (avg ${hook.avgLufs.toFixed(1)} LUFS)`);

  let captions: CaptionCard[] = [];
  if (args.lyrics) {
    const cues = selectWindowCues(parseSrt(readFileSync(args.lyrics, 'utf8')), hook.start, args.seconds);
    captions = renderCaptionCards(cues, dir);
    console.log(`   lyrics ${captions.length} cue(s) burned in from ${args.lyrics}`);
    if (captions.length === 0) {
      console.warn('   ⚠️ no lyric cues fall in the hook window — rendering without captions');
    }
  }

  render(args, coverPath, audioPath, hook.start, captions);

  const outDur = probeDuration(args.out);
  console.log(`✅ ${args.out} · ${outDur.toFixed(1)}s · 1080×1920${captions.length ? ` · ${captions.length} lyric cards` : ''}`);
}

main().catch((e) => {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
});
