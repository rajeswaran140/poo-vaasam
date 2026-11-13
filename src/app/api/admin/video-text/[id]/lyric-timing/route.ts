/**
 * Automatic lyric timing for a Video Text project.
 *
 *   GET                              → { status: idle | running | ready | error, error?, startedAt? }
 *   POST { op: 'start' }             → starts the worker for the project's video (or says it is ready)
 *   POST { op: 'align', lyricsText } → { lines: TimedLine[] } from the saved words, in about a second
 *
 * The worker (tamilagaval-lyric-timing) only measures: it writes the words it
 * heard and the vocal's loudness to S3. The words belong to the VIDEO, not to
 * the lyrics, so re-aligning after a lyric edit reuses them for free. State is
 * three small S3 files per source video (started / words / error); no table.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { VideoTextRepository } from '@/infrastructure/database/VideoTextRepository';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { awsConfig } from '@/lib/aws-config';
import { isValidProjectId, isVideoTextKeyFor } from '@/lib/video-text/keys';
import { lyricTimingKeys, timeLyricLines, type LyricTimingWords } from '@/lib/video-text/lyric-timing';
import type { VideoTextProject } from '@/types/videoText';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FUNCTION = process.env.LYRIC_TIMING_FUNCTION || 'tamilagaval-lyric-timing';
const BUCKET = process.env.S3_BUCKET || process.env.NEXT_PUBLIC_S3_BUCKET || 'tamil-web-media';
/** The worker's own limit is 15 minutes; past this a run that left no result has died. */
const STALE_AFTER_MS = 16 * 60 * 1000;
const START_FAILED = 'Automatic timing could not be started. Try again.';
const TOO_LONG = 'Automatic timing took too long and stopped. Try again, or tap to time the lines.';

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const body = await S3Operations.getFile(key);
    return JSON.parse(await (body as { transformToString: () => Promise<string> }).transformToString()) as T;
  } catch (err) {
    if (err instanceof Error && (err.name === 'NoSuchKey' || err.name === 'NotFound')) return null;
    throw err;
  }
}

type Status =
  | { status: 'idle' }
  | { status: 'ready' }
  | { status: 'running'; startedAt: string }
  | { status: 'error'; error: string };

async function statusFor(keys: ReturnType<typeof lyricTimingKeys>, now = Date.now()): Promise<Status> {
  if (await S3Operations.fileExists(keys.words)) return { status: 'ready' };
  const started = await readJson<{ startedAt: string }>(keys.started);
  const failed = await readJson<{ error?: string; at?: string }>(keys.error);
  // An error written by THIS run (after its start) wins; an older one is history.
  if (failed && (!started || (failed.at ?? '') >= started.startedAt)) {
    return { status: 'error', error: 'Automatic timing failed for this video. Try again, or tap to time the lines.' };
  }
  if (started) {
    if (now - Date.parse(started.startedAt) > STALE_AFTER_MS) return { status: 'error', error: TOO_LONG };
    return { status: 'running', startedAt: started.startedAt };
  }
  return { status: 'idle' };
}

/** The project and its live video, or the response that explains why not. Auth is checked by each handler first. */
async function load(id: string): Promise<{ project: VideoTextProject } | Response> {
  if (!isValidProjectId(id)) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  const project = await new VideoTextRepository().get(id);
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  if (!project.source || !isVideoTextKeyFor(id, project.source.key)) {
    return NextResponse.json({ error: 'Upload a video first.' }, { status: 400 });
  }
  if (new Date(project.source.expiresAt).getTime() <= Date.now()) {
    return NextResponse.json({ error: 'The uploaded video was deleted after 30 days. Upload it again first.' }, { status: 410 });
  }
  return { project };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { id } = await params;
  try {
    const got = await load(id);
    if (got instanceof Response) return got;
    return NextResponse.json(await statusFor(lyricTimingKeys(id, got.project.source!.key)));
  } catch (err) {
    console.error('[api/video-text/lyric-timing] status failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Could not check automatic timing. Try again.' }, { status: 502 });
  }
}

const schema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('start') }),
  z.object({ op: z.literal('align'), lyricsText: z.string().max(20000) }),
]);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  try {
    const got = await load(id);
    if (got instanceof Response) return got;
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
    const source = got.project.source!;
    const keys = lyricTimingKeys(id, source.key);

    if (parsed.data.op === 'align') {
      const sensor = await readJson<LyricTimingWords>(keys.words);
      if (!sensor) return NextResponse.json({ error: 'The video has not been listened to yet. Press Time lyrics automatically.' }, { status: 409 });
      const result = timeLyricLines(parsed.data.lyricsText, sensor);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
      return NextResponse.json({ lines: result.lines });
    }

    const now = await statusFor(keys);
    if (now.status === 'ready' || now.status === 'running') return NextResponse.json(now);

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
          Payload: Buffer.from(JSON.stringify({ bucket: BUCKET, sourceKey: source.key, wordsKey: keys.words, errorKey: keys.error })),
        })
      );
    } catch (err) {
      console.error('[api/video-text/lyric-timing] invoke failed:', err instanceof Error ? err.message : String(err));
      await S3Operations.deleteFile(keys.started).catch(() => undefined);
      return NextResponse.json({ error: START_FAILED }, { status: 502 });
    }
    return NextResponse.json({ status: 'running', startedAt }, { status: 202 });
  } catch (err) {
    console.error('[api/video-text/lyric-timing] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: START_FAILED }, { status: 502 });
  }
}
