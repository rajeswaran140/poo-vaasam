/**
 * Automatic lyric timing for a Visual Story, on the story's own song (design
 * 2026-11-13 §4; the same worker and alignment as Video Text).
 *
 *   GET                              → { status: idle | running | ready | error, error?, startedAt? }
 *   POST { op: 'start' }             → listens to the story's master audio (or says it is ready)
 *   POST { op: 'align', lyricsText } → { lines: WindowLine[], heard, total } in window time
 *
 * The pasted lyrics are used for this answer only and are not stored (phase 1).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { readJson, startLyricTiming, statusFor } from '@/lib/lyric-timing-status';
import { storyLyricTimingKeys, timeLyricLines, type LyricTimingWords } from '@/lib/video-text/lyric-timing';
import { linesInWindow } from '@/lib/visual-story-lyric-fit';
import { fail, limitMutation } from '@/lib/visual-story-route';
import { isVsId, type VisualStory } from '@/types/visualStory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ vsId: string }> };

const START_FAILED = 'Listening could not be started. Try again.';

async function load(vsId: string): Promise<VisualStory | Response> {
  if (!isVsId(vsId)) return fail('That story no longer exists.', 404);
  const story = await new VisualStoryRepository().findById(vsId);
  if (!story) return fail('That story no longer exists.', 404);
  return story;
}

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { vsId } = await params;
  try {
    const story = await load(vsId);
    if (story instanceof Response) return story;
    return NextResponse.json(await statusFor(storyLyricTimingKeys(vsId, story.audioKey)));
  } catch (err) {
    console.error('[api/visual-story/lyric-timing] status failed:', err instanceof Error ? err.message : String(err));
    return fail('Could not check the listening. Try again.', 502);
  }
}

const schema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('start') }),
  z.object({ op: z.literal('align'), lyricsText: z.string().max(20000) }),
]);

export async function POST(request: NextRequest, { params }: Ctx) {
  let auth: { userId?: string; email?: string };
  try {
    auth = await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const limited = limitMutation(auth, request);
  if (limited) return limited;
  const { vsId } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  try {
    const story = await load(vsId);
    if (story instanceof Response) return story;
    if (!parsed.success) return fail('Invalid request.', 400);
    const keys = storyLyricTimingKeys(vsId, story.audioKey);

    if (parsed.data.op === 'align') {
      const sensor = await readJson<LyricTimingWords>(keys.words);
      if (!sensor) return fail('Press Listen to the song first.', 409);
      // Timed over the whole song (whole-song lyrics are normal, e.g. from Video Text);
      // linesInWindow keeps the lines that start inside the story's part.
      const durationSec = Number(sensor.durationSec) > 0 ? Number(sensor.durationSec) : story.windowEndSec;
      const result = timeLyricLines(parsed.data.lyricsText, { ...sensor, durationSec });
      if (!result.ok) return fail(result.error, 422);
      const lines = linesInWindow(result.lines, story.windowStartSec, story.windowEndSec);
      return NextResponse.json({ lines, heard: lines.filter((l) => l.heard).length, total: lines.length });
    }

    const now = await statusFor(keys);
    if (now.status === 'ready' || now.status === 'running') return NextResponse.json(now);
    try {
      const { startedAt } = await startLyricTiming(keys, story.audioKey);
      return NextResponse.json({ status: 'running', startedAt }, { status: 202 });
    } catch (err) {
      console.error('[api/visual-story/lyric-timing] invoke failed:', err instanceof Error ? err.message : String(err));
      return fail(START_FAILED, 502);
    }
  } catch (err) {
    console.error('[api/visual-story/lyric-timing] failed:', err instanceof Error ? err.message : String(err));
    return fail(START_FAILED, 502);
  }
}
