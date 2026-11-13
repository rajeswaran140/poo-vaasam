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
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { VideoTextRepository } from '@/infrastructure/database/VideoTextRepository';
import { readJson, startLyricTiming, statusFor } from '@/lib/lyric-timing-status';
import { floorCentis, isValidProjectId, isVideoTextKeyFor } from '@/lib/video-text/keys';
import { lyricTimingKeys, timeLyricLines, type LyricTimingWords } from '@/lib/video-text/lyric-timing';
import type { VideoTextProject } from '@/types/videoText';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const START_FAILED = 'Automatic timing could not be started. Try again.';

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
      // The worker's length is the audio's, unrounded; the editor checks against the
      // stored video length (floored to 0.01 s). Clamp to the shorter, so a line
      // running to the very end is never refused for a hundredth of a second.
      const durationSec = floorCentis(Math.min(Number(sensor.durationSec) || source.durationSec, source.durationSec));
      const result = timeLyricLines(parsed.data.lyricsText, { ...sensor, durationSec });
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
      return NextResponse.json({ lines: result.lines });
    }

    const now = await statusFor(keys);
    if (now.status === 'ready' || now.status === 'running') return NextResponse.json(now);

    let startedAt: string;
    try {
      ({ startedAt } = await startLyricTiming(keys, source.key));
    } catch (err) {
      console.error('[api/video-text/lyric-timing] invoke failed:', err instanceof Error ? err.message : String(err));
      return NextResponse.json({ error: START_FAILED }, { status: 502 });
    }
    return NextResponse.json({ status: 'running', startedAt }, { status: 202 });
  } catch (err) {
    console.error('[api/video-text/lyric-timing] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: START_FAILED }, { status: 502 });
  }
}
