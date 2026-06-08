/**
 * Transcode published SONGS whose audio is WAV → MP3 for low-bandwidth delivery
 * (rural India/Sri Lanka). Keeps the WAV master in S3; uploads an .mp3 alongside
 * it and repoints the song's audioUrl. Idempotent: skips songs already on MP3.
 *
 * WAV (~50MB, ~176KB/s) can't stream on a weak 3G link; a 192kbps MP3 (~6MB,
 * ~24KB/s) plays smoothly and costs ~10x less data.
 *
 * Needs ffmpeg on PATH (or FFMPEG=/path/to/ffmpeg). After a WRITE run, redeploy
 * (the /songs list is build-time).
 *
 *   Dry run:  AWS_REGION=ca-central-1 npx tsx --env-file=.env.local scripts/transcode-wav-to-mp3.ts
 *   Write:    WRITE=1 AWS_REGION=ca-central-1 npx tsx --env-file=.env.local scripts/transcode-wav-to-mp3.ts
 *   Options:  BITRATE=128k  FFMPEG=/tmp/ffmpeg
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentType, ContentStatus } from '@/types/content';
import { S3Operations } from '@/infrastructure/storage/s3-client';

const WRITE = process.env.WRITE === '1';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const BITRATE = process.env.BITRATE || '192k';
const S3_BASE = 'https://tamil-web-media.s3.us-east-1.amazonaws.com';

const keyFromUrl = (url: string) => decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ''));
const urlFromKey = (key: string) => `${S3_BASE}/${key.split('/').map(encodeURIComponent).join('/')}`;

async function main() {
  const repo = new ContentRepository();
  const page = await repo.findByType(ContentType.SONGS, { status: ContentStatus.PUBLISHED, limit: 300 });
  const songs = page.items.map((c) => ({ entity: c, obj: c.toObject() as Record<string, unknown> }));
  const wavs = songs.filter((s) => /\.wav(\?|$)/i.test(String(s.obj.audioUrl || '')));

  console.log(`mode=${WRITE ? 'WRITE' : 'DRY-RUN'}  bitrate=${BITRATE}  published=${songs.length}  on WAV=${wavs.length}`);
  if (WRITE) {
    const probe = spawnSync(FFMPEG, ['-version']);
    if (probe.status !== 0) {
      console.error(`ffmpeg not runnable ('${FFMPEG}'). Install it or set FFMPEG=/path/to/ffmpeg.`);
      process.exit(1);
    }
  }

  const tmp = mkdtempSync(join(tmpdir(), 'mp3-'));
  let done = 0;
  for (const s of wavs) {
    const wavKey = keyFromUrl(String(s.obj.audioUrl));
    const mp3Key = wavKey.replace(/\.wav$/i, '.mp3');
    console.log(`${WRITE ? 'CONVERT' : 'PLAN  '}: ${String(s.obj.title)}\n        ${wavKey} -> ${mp3Key}`);
    if (!WRITE) { done++; continue; }

    // 1) download the WAV master (public URL).
    const wavPath = join(tmp, 'in.wav');
    const mp3Path = join(tmp, 'out.mp3');
    const res = await fetch(urlFromKey(wavKey));
    if (!res.ok) { console.error(`        skip: WAV not reachable (${res.status})`); continue; }
    writeFileSync(wavPath, Buffer.from(await res.arrayBuffer()));

    // 2) transcode → MP3 (libmp3lame).
    const ff = spawnSync(FFMPEG, ['-y', '-i', wavPath, '-codec:a', 'libmp3lame', '-b:a', BITRATE, mp3Path], { stdio: 'ignore' });
    if (ff.status !== 0) { console.error('        skip: ffmpeg failed'); continue; }

    // 3) upload the MP3 (the WAV master stays).
    await S3Operations.uploadFile({ key: mp3Key, file: readFileSync(mp3Path), contentType: 'audio/mpeg' });

    // 4) repoint audioUrl.
    s.entity.update({ audioUrl: urlFromKey(mp3Key) });
    await repo.update(s.entity);
    console.log(`        done -> ${urlFromKey(mp3Key)}`);
    done++;
  }
  console.log(`${WRITE ? `converted ${done}` : `${done} to convert`}.${WRITE && done ? ' Now redeploy Amplify.' : ''}`);
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
