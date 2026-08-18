/**
 * build-status-clip — render a WhatsApp-Status clip for one song.
 *
 *   npx tsx scripts/build-status-clip.ts --slug eelathu --video tw49AjsZs1E \
 *     --audio "s3://tamilagaval-audio-masters/audio/poem-music/ஈழத்து மண்ணே.wav" \
 *     --start 72 --content cnt_… [--artwork blurred-fill|portrait] [--portrait ./art.jpg]
 *
 * ⚠️ RECORD PROVENANCE. `masterAsset` + `clipStart` + `songId` are stored
 * together because MASTER DURATION != PUBLISHED VIDEO DURATION — measured on
 * ஈழத்து மண்ணே: master 6:41 vs video 6:02. A timestamp is only meaningful
 * against the exact WAV it was chosen in, so a start time must never be carried
 * over from a video, or from a different master variant of the same song (that
 * song has TEN variants in S3).
 *
 * WHY THIS EXISTS. `STATUS_CLIPS` is hand-maintained, so coverage froze around
 * the catalogue that existed when the feature was built. Measured 2026-08-18:
 * 12 clips covering **9.6% of lifetime views**, and **0 of the top 12 songs**.
 * The songs a listener would most want to share are exactly the ones missing.
 *
 * ⚠️ THE OUTPUT MUST BE A SAME-ORIGIN FILE under public/clips/. The share card
 * hands the actual MP4 to `navigator.share({files})` so it becomes a WhatsApp
 * Status POST — the recipient hears the song without deciding to open a link.
 * A YouTube URL cannot do that; it would only ever be a link preview. That
 * distinction is the entire point of the feature (Raj, 2026-08-18).
 *
 * ⚠️ 29.000s EXACTLY. WhatsApp Status caps at 30s. `-shortest` alone overshoots
 * to ~30.7s because of AAC frame padding on a looped still — measured — so the
 * duration is pinned on the OUTPUT and the frame count fixed at 870 (29 x 30fps).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FPS = 30;
const SECONDS = 29;
const FRAMES = FPS * SECONDS; // 870 — pinned, see header
const W = 1080;
const H = 1920;

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const ff = (args: string[]) => execFileSync('ffmpeg', ['-v', 'error', ...args], { stdio: 'inherit' });

/**
 * Compose the 9:16 frame.
 *
 * ⚠️ NEVER CROP. Raj's thumbnails carry the Tamil title and the
 * "Lyrics: Raj | Music: Tamilagaval.com" branding on the LEFT, so a centre-crop
 * to fill 9:16 slices the title in half and truncates the branding to
 * "milagaval.com" — verified on ஈழத்து மண்ணே. Because the text placement is
 * consistent across the artwork, that failure applies to every song.
 *
 * `blurred-fill` therefore preserves the whole landscape image over a blurred,
 * darkened copy of itself. `portrait` is for real 9:16 art, which is the
 * PREFERRED treatment when it exists — blurred-fill is the automated fallback,
 * deliberately kept switchable so it never becomes a permanent design ceiling.
 */
function composeStill(src: string, out: string, mode: 'blurred-fill' | 'portrait') {
  if (mode === 'portrait') {
    ff(['-i', src, '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`,
        '-frames:v', '1', out, '-y']);
    return;
  }
  ff(['-i', src, '-filter_complex',
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=40:2,eq=brightness=-0.12[bg];` +
      `[0:v]scale=${W}:-1[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`,
      '-frames:v', '1', out, '-y']);
}

async function main() {
  const slug = arg('slug');
  const video = arg('video');
  const audio = arg('audio');
  const start = Number(arg('start') ?? NaN);
  const mode = (arg('artwork') ?? 'blurred-fill') as 'blurred-fill' | 'portrait';
  const portraitArt = arg('portrait');
  if (!slug || !audio || Number.isNaN(start)) {
    throw new Error('Required: --slug <name> --audio <path|s3://…> --start <seconds> [--video <ytId>] [--artwork portrait --portrait <file>]');
  }
  if (mode === 'portrait' && !portraitArt) throw new Error('--artwork portrait requires --portrait <file>');
  if (!video && mode !== 'portrait') throw new Error('--video <ytId> is required for the blurred-fill fallback (its thumbnail is the source art)');

  const tmp = join(tmpdir(), `statusclip-${slug}`);
  mkdirSync(tmp, { recursive: true });
  const clipsDir = join(process.cwd(), 'public', 'clips');

  // 1. Source artwork. The YouTube thumbnail already carries title + branding,
  //    so nothing is composited on top — no new design step.
  const srcArt = mode === 'portrait' ? portraitArt! : join(tmp, 'thumb.jpg');
  if (mode !== 'portrait') {
    execFileSync('curl', ['-sS', '-f', '-o', srcArt,
      `https://i.ytimg.com/vi/${video}/maxresdefault.jpg`]);
  }
  const still = join(tmp, 'still.jpg');
  composeStill(srcArt, still, mode);

  // 2. Audio. Accept a local path or an s3:// URI so the pipeline never depends
  //    on where the master happens to live.
  let audioPath = audio;
  if (audio.startsWith('s3://')) {
    audioPath = join(tmp, 'song.wav');
    execFileSync('aws', ['s3', 'cp', audio, audioPath, '--quiet']);
  }
  if (!existsSync(audioPath)) throw new Error(`audio not found: ${audioPath}`);

  // 3. Render. Duration pinned on the OUTPUT and frames fixed — see header.
  const mp4 = join(clipsDir, `${slug}-short.mp4`);
  ff(['-loop', '1', '-framerate', String(FPS), '-i', still,
      '-ss', String(start), '-t', String(SECONDS), '-i', audioPath,
      '-c:v', 'libx264', '-preset', 'medium', '-tune', 'stillimage',
      '-pix_fmt', 'yuv420p', '-r', String(FPS), '-frames:v', String(FRAMES),
      '-c:a', 'aac', '-b:a', '128k', '-t', String(SECONDS),
      '-movflags', '+faststart', mp4, '-y']);

  // 4. Poster — 540x960, matching the existing convention.
  const jpg = join(clipsDir, `${slug}-short.jpg`);
  ff(['-i', still, '-vf', 'scale=540:960', '-q:v', '4', jpg, '-y']);

  // ⚠️ ASSERT, DO NOT EYEBALL. Raj's instruction 2026-08-18: once the pipeline is
  // frozen, no human should be re-checking technical properties per render. A
  // clip that violates any of these is REJECTED and deleted rather than shipped,
  // because a silently-wrong clip is worse than a missing one — it reaches a
  // listener's contacts before anyone notices.
  const probe = (path: string, entries: string) =>
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'default=nw=1:nk=1', path])
      .toString().trim().split('\n');
  const [dur] = probe(mp4, 'format=duration');
  const [vcodec, w, h, frames, acodec] = probe(mp4, 'stream=codec_name,width,height,nb_frames');
  const sizeMb = statSync(mp4).size / 1024 / 1024;
  const fail: string[] = [];
  // 29s is the WhatsApp Status ceiling. `-shortest` alone overshoots to ~30.7s
  // (AAC frame padding on a looped still), which WhatsApp would reject.
  if (Math.abs(Number(dur) - SECONDS) > 0.05) fail.push(`duration ${dur}s != ${SECONDS}s`);
  if (Number(w) !== W || Number(h) !== H) fail.push(`dimensions ${w}x${h} != ${W}x${H}`);
  if (vcodec !== 'h264') fail.push(`video codec ${vcodec} != h264`);
  if (acodec !== 'aac') fail.push(`audio codec ${acodec} != aac`);
  if (frames && Number(frames) !== FRAMES) fail.push(`${frames} frames != ${FRAMES}`);
  // The file is fetched into memory and handed to navigator.share on a phone,
  // often on mobile data. Existing hand-made clips are ~1.3 MB; 3 MB is a
  // generous ceiling that still catches a runaway encode.
  if (sizeMb > 3) fail.push(`${sizeMb.toFixed(2)} MB exceeds the 3 MB ceiling`);
  if (fail.length) {
    unlinkSync(mp4);
    if (existsSync(jpg)) unlinkSync(jpg);
    throw new Error(`REJECTED, output deleted:\n  - ${fail.join('\n  - ')}`);
  }

  console.log(`clip   ${mp4}  ${Number(dur).toFixed(3)}s  ${sizeMb.toFixed(2)} MB  ${w}x${h} ${vcodec}/${acodec} ${frames}f`);
  console.log(`poster ${jpg}  ${(statSync(jpg).size / 1024).toFixed(0)} KB`);
  console.log(`\n✓ all assertions passed. Register it:`);
  console.log(`  {`);
  console.log(`    songId: '${arg('content') ?? '<contentId>'}',`);
  console.log(`    clip: '/clips/${slug}-short.mp4',`);
  console.log(`    masterAsset: '${audio}',`);
  console.log(`    clipStart: ${start},`);
  console.log(`  },`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
