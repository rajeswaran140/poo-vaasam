/**
 * master-worker — async two-pass loudnorm mastering Lambda (Event-invoked by
 * /api/admin/music-lab/master). Brings a "hot" take to -14 LUFS / -1 dBTP and
 * writes a 24-bit/48k WAV to S3 as `<s3Key>-master.wav`. Progress is recorded on
 * the MASTERJOB#<id> DynamoDB item (the repo's job idiom — NOT SQS); the status
 * route polls it. Never touches CloudFront. Timeout up to 15 min, ~4 GB /tmp.
 *
 * ffmpeg from the layer at /opt/bin/ffmpeg. Bundled with esbuild
 * (build:master-worker), @aws-sdk/* external. Env: TAKES_BUCKET,
 * DYNAMODB_TABLE_NAME, AWS_REGION; optional FFMPEG_PATH.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { parseLoudnormStats, buildPass2Loudnorm } from '@/lib/loudness-measure';

const FFMPEG = process.env.FFMPEG_PATH || '/opt/bin/ffmpeg';
const REGION = process.env.AWS_REGION || 'ca-central-1';
const TAKES_BUCKET = process.env.TAKES_BUCKET;
const TABLE = process.env.DYNAMODB_TABLE_NAME || 'TamilWebContent';
const s3 = new S3Client({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

async function patch(jobId: string, fields: Record<string, unknown>): Promise<void> {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets: string[] = [];
  for (const [k, v] of Object.entries({ ...fields, updatedAt: new Date().toISOString() })) {
    names[`#${k}`] = k;
    values[`:${k}`] = v;
    sets.push(`#${k} = :${k}`);
  }
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `MASTERJOB#${jobId}`, SK: 'METADATA' },
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

const ff = (args: string[]) => spawnSync(FFMPEG, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

interface MasterEvent {
  jobId?: string;
  s3Key?: string;
  bucket?: string;
  target?: number;
}

export const handler = async (event: MasterEvent) => {
  const jobId = event?.jobId;
  const s3Key = event?.s3Key;
  const bucket = event?.bucket || TAKES_BUCKET;
  const target = typeof event?.target === 'number' ? event.target : -14;
  if (!jobId || !s3Key || !bucket) {
    console.error('[master-worker] bad event', JSON.stringify({ jobId: !!jobId, s3Key: !!s3Key, bucket: !!bucket }));
    return { ok: false, error: 'jobId, s3Key and bucket are required' };
  }

  const dir = mkdtempSync(join(tmpdir(), 'master-'));
  const ext = s3Key.match(/\.[a-z0-9]+$/i)?.[0] ?? '';
  const inPath = join(dir, `in${ext}`);
  const outPath = join(dir, 'out.wav');
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: s3Key }));
    writeFileSync(inPath, Buffer.from(await obj.Body!.transformToByteArray()));

    // Pass 1 — measure for linear loudnorm.
    const p1 = ff(['-hide_banner', '-nostats', '-i', inPath, '-af', `loudnorm=I=${target}:TP=-1:LRA=11:print_format=json`, '-f', 'null', '-']);
    const stats = parseLoudnormStats(`${p1.stdout ?? ''}${p1.stderr ?? ''}`);
    if (!stats) {
      await patch(jobId, { status: 'error', error: { code: 'pass1', message: 'loudnorm pass 1 produced no stats' } });
      return { ok: false };
    }

    // Pass 2 — linear normalize → 24-bit / 48 kHz WAV.
    const p2 = ff(['-hide_banner', '-nostats', '-i', inPath, '-af', buildPass2Loudnorm(stats, target), '-ar', '48000', '-c:a', 'pcm_s24le', '-y', outPath]);
    if (p2.status !== 0) {
      await patch(jobId, { status: 'error', error: { code: 'pass2', message: 'loudnorm pass 2 failed' } });
      return { ok: false };
    }

    const masterKey = `${s3Key}-master.wav`;
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: masterKey, Body: readFileSync(outPath), ContentType: 'audio/wav' }));
    await patch(jobId, { status: 'done', masterKey, beforeLufs: stats.input_i, target });
    return { ok: true, masterKey };
  } catch (err) {
    console.error('[master-worker] failed:', err instanceof Error ? err.message : String(err));
    await patch(jobId, { status: 'error', error: { code: 'exception', message: err instanceof Error ? err.message : String(err) } }).catch(() => {});
    return { ok: false };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
