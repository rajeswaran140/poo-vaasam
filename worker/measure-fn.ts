/**
 * measure-fn — synchronous server-side loudness measurement Lambda.
 *
 * Invoked (RequestResponse) by /api/admin/music-lab/measure. Fetches the take
 * from S3 server-side, runs ONE ffmpeg ebur128+astats pass, and returns
 * { metrics, badge, verdict } via the tested pure parser. ffmpeg comes from the
 * layer at /opt/bin/ffmpeg. One EBU R128 decode is a few seconds — safe sync.
 *
 * Bundled with esbuild (build:measure-fn), @aws-sdk/* left external (Lambda
 * Node 20 runtime provides it). Env: TAKES_BUCKET, AWS_REGION; optional FFMPEG_PATH.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { parseMeasurement, measureArgs } from '@/lib/loudness-measure';

const FFMPEG = process.env.FFMPEG_PATH || '/opt/bin/ffmpeg';
const REGION = process.env.AWS_REGION || 'ca-central-1';
const TAKES_BUCKET = process.env.TAKES_BUCKET;
const s3 = new S3Client({ region: REGION });

interface MeasureEvent {
  s3Key?: string;
  bucket?: string;
  target?: number;
}

export const handler = async (event: MeasureEvent) => {
  const s3Key = event?.s3Key;
  const bucket = event?.bucket || TAKES_BUCKET;
  const target = typeof event?.target === 'number' ? event.target : -14;
  if (!s3Key || !bucket) return { error: 's3Key and bucket are required' };

  const dir = mkdtempSync(join(tmpdir(), 'measure-'));
  const ext = s3Key.match(/\.[a-z0-9]+$/i)?.[0] ?? '';
  const inPath = join(dir, `in${ext}`);
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: s3Key }));
    const bytes = await obj.Body!.transformToByteArray();
    writeFileSync(inPath, Buffer.from(bytes));

    const r = spawnSync(FFMPEG, measureArgs(inPath), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const stderr = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    // ebur128 exits 0; treat "no Summary" as a real failure regardless of code.
    if (!stderr.includes('Summary:')) {
      console.error('[measure-fn] no ebur128 summary; status:', r.status, stderr.slice(-400));
      return { error: 'ffmpeg measurement failed' };
    }
    return parseMeasurement(stderr, target);
  } catch (err) {
    console.error('[measure-fn] failed:', err instanceof Error ? err.message : String(err));
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
