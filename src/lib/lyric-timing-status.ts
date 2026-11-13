/**
 * The lyric-timing worker's state for one source file, read from its three
 * small S3 files (started / words / error), and how to start it. Shared by
 * Video Text (a project's uploaded video) and Visual Story (a story's master
 * audio). Server-side.
 */
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { awsConfig } from '@/lib/aws-config';
import type { lyricTimingKeys } from '@/lib/video-text/lyric-timing';

export type LyricTimingKeys = ReturnType<typeof lyricTimingKeys>;

const FUNCTION = process.env.LYRIC_TIMING_FUNCTION || 'tamilagaval-lyric-timing';
const BUCKET = process.env.S3_BUCKET || process.env.NEXT_PUBLIC_S3_BUCKET || 'tamil-web-media';
/** The worker's own limit is 15 minutes; past this a run that left no result has died. */
export const STALE_AFTER_MS = 16 * 60 * 1000;
const TOO_LONG = 'Automatic timing took too long and stopped. Try again, or tap to time the lines.';

export async function readJson<T>(key: string): Promise<T | null> {
  try {
    const body = await S3Operations.getFile(key);
    return JSON.parse(await (body as { transformToString: () => Promise<string> }).transformToString()) as T;
  } catch (err) {
    if (err instanceof Error && (err.name === 'NoSuchKey' || err.name === 'NotFound')) return null;
    throw err;
  }
}

export type LyricTimingStatus =
  | { status: 'idle' }
  | { status: 'ready' }
  | { status: 'running'; startedAt: string }
  | { status: 'error'; error: string };

export async function statusFor(keys: LyricTimingKeys, now = Date.now()): Promise<LyricTimingStatus> {
  if (await S3Operations.fileExists(keys.words)) return { status: 'ready' };
  const started = await readJson<{ startedAt: string }>(keys.started);
  const failed = await readJson<{ error?: string; at?: string }>(keys.error);
  // An error written by THIS run (after its start) wins; an older one is history.
  // Compared as times with a few seconds' slack: the worker writes whole seconds
  // and its clock is not ours, so a fast failure could look older than its start.
  const failedAt = Date.parse(failed?.at ?? '');
  const startedAt = started ? Date.parse(started.startedAt) : NaN;
  if (failed && (!started || !Number.isFinite(failedAt) || failedAt >= startedAt - 5000)) {
    return { status: 'error', error: 'Automatic timing failed for this video. Try again, or tap to time the lines.' };
  }
  if (started) {
    if (now - Date.parse(started.startedAt) > STALE_AFTER_MS) return { status: 'error', error: TOO_LONG };
    return { status: 'running', startedAt: started.startedAt };
  }
  return { status: 'idle' };
}

/**
 * Write the start stamp and invoke the worker on `sourceKey`. On an invoke
 * failure the stamp is removed and the error rethrown, so the caller can say so.
 */
export async function startLyricTiming(keys: LyricTimingKeys, sourceKey: string): Promise<{ startedAt: string }> {
  const startedAt = new Date().toISOString();
  await S3Operations.uploadFile({ key: keys.started, file: JSON.stringify({ startedAt }), contentType: 'application/json' });
  try {
    const lambda = new LambdaClient({
      region: awsConfig.region,
      ...(awsConfig.credentials ? { credentials: awsConfig.credentials } : {}),
    });
    await lambda.send(
      new InvokeCommand({
        FunctionName: FUNCTION,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ bucket: BUCKET, sourceKey, wordsKey: keys.words, errorKey: keys.error })),
      })
    );
  } catch (err) {
    await S3Operations.deleteFile(keys.started).catch(() => undefined);
    throw err;
  }
  return { startedAt };
}
