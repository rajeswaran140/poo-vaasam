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
import {
  parseLoudnormStats,
  buildPass2Loudnorm,
  isValidTarget,
  masterKeyFor,
  isMasterKey,
  parseSourceInfo,
} from '@/lib/loudness-measure';
import { isMasteringKey } from '@/lib/mastering-storage';

const FFMPEG = process.env.FFMPEG_PATH || '/opt/bin/ffmpeg';
const REGION = process.env.AWS_REGION || 'ca-central-1';
const TAKES_BUCKET = process.env.TAKES_BUCKET;
const TABLE = process.env.DYNAMODB_TABLE_NAME || 'TamilWebContent';
// S3 (takes bucket) may be in a different region than the Lambda + DynamoDB.
const S3_REGION = process.env.TAKES_BUCKET_REGION || REGION;
const s3 = new S3Client({ region: S3_REGION });
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
  target?: number;
}

export const handler = async (event: MasterEvent) => {
  const jobId = event?.jobId;
  const s3Key = event?.s3Key;
  // The bucket is NOT taken from the event. The worker's IAM role can read and
  // write anywhere in tamil-web-media, so an attacker-shaped payload naming
  // another bucket (or the route regressing to pass one) would widen what this
  // function touches for no feature benefit. It masters what is in its own.
  const bucket = TAKES_BUCKET;
  const target = event?.target === undefined ? -14 : event.target;
  if (!jobId || !s3Key || !bucket) {
    console.error('[master-worker] bad event', JSON.stringify({ jobId: !!jobId, s3Key: !!s3Key, bucket: !!bucket }));
    return { ok: false, error: 'jobId, s3Key and TAKES_BUCKET are required' };
  }
  // The route validates these too; re-check here because the Lambda is
  // Event-invoked and a bad payload would otherwise fail deep inside ffmpeg.
  //
  // The prefix check is the important one: the role holds s3:GetObject and
  // s3:PutObject on the WHOLE bucket, so without it a bad key would let this
  // function read — and, via masterKeyFor, write next to — published catalogue
  // audio. The route already refuses such a key; this is the second lock.
  if (!isMasteringKey(s3Key)) {
    await patch(jobId, { status: 'error', error: { code: 'bad-key', message: 'that key is not in the mastering workspace' } });
    return { ok: false };
  }
  if (!isValidTarget(target)) {
    await patch(jobId, { status: 'error', error: { code: 'bad-target', message: `target must be a number in [-70, -5], got ${target}` } });
    return { ok: false };
  }
  if (isMasterKey(s3Key)) {
    await patch(jobId, { status: 'error', error: { code: 'already-mastered', message: 'that key is already a mastering output; master the original source instead' } });
    return { ok: false };
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
    const p1Log = `${p1.stdout ?? ''}${p1.stderr ?? ''}`;
    const stats = parseLoudnormStats(p1Log);
    // Free: pass 1 already prints the input header, so recording what the source
    // WAS costs no extra decode. Never fatal — a master with an unreadable
    // header is still a valid master.
    const source = parseSourceInfo(p1Log);
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

    // Pass 3 — re-measure the output so the job records what it actually landed
    // on. Saves the operator downloading the file to confirm the target was hit;
    // a few seconds against a 15 min budget.
    const p3 = ff(['-hide_banner', '-nostats', '-i', outPath, '-af', `loudnorm=I=${target}:TP=-1:LRA=11:print_format=json`, '-f', 'null', '-']);
    const after = parseLoudnormStats(`${p3.stdout ?? ''}${p3.stderr ?? ''}`);

    const masterKey = masterKeyFor(s3Key, target);
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: masterKey, Body: readFileSync(outPath), ContentType: 'audio/wav' }));
    await patch(jobId, {
      status: 'done',
      masterKey,
      beforeLufs: stats.input_i,
      beforeTp: stats.input_tp,
      afterLufs: after?.input_i ?? null,
      afterTp: after?.input_tp ?? null,
      source,
      target,
    });
    return { ok: true, masterKey };
  } catch (err) {
    console.error('[master-worker] failed:', err instanceof Error ? err.message : String(err));
    await patch(jobId, { status: 'error', error: { code: 'exception', message: err instanceof Error ? err.message : String(err) } }).catch(() => {});
    return { ok: false };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
