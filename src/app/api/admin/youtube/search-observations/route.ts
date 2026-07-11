/**
 * Search-position observation log — the manual, human-observed layer.
 *
 * GET  ?videoId=ID  → the song's scorecard: each tracked query with its latest
 *                     observed position + Opportunity Score/gap (sorted by gap).
 * POST { videoId, query, position, region?, viewsAtObservation?, videoAgeHours? }
 *      → record one spot-check ("searched X, saw the song at #N"; position null =
 *        not found). The query must belong to the song's tracked set.
 *
 * Admin-gated. Positions are HUMAN-observed — never a search.list API rank.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { querySetFor } from '@/config/song-search-queries';
import { logObservation, readLatestObservations, buildScorecard } from '@/lib/search-observation-store';
import { isValidYouTubeId } from '@/lib/youtube-api';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const videoId = request.nextUrl.searchParams.get('videoId')?.trim();
  if (!videoId || !isValidYouTubeId(videoId)) {
    return NextResponse.json({ success: false, error: 'valid videoId is required' }, { status: 400 });
  }
  const set = querySetFor(videoId);
  if (!set) {
    return NextResponse.json({ success: false, error: 'no tracked query set for this song' }, { status: 404 });
  }
  const latest = await readLatestObservations(videoId);
  return NextResponse.json({ success: true, videoId, label: set.label, scorecard: buildScorecard(set, latest) });
}

const observationSchema = z.object({
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  query: z.string().min(1).max(200),
  position: z.number().int().positive().max(1000).nullable(),
  region: z.string().max(40).optional(),
  viewsAtObservation: z.number().int().nonnegative().optional(),
  videoAgeHours: z.number().nonnegative().optional(),
});

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  let input: z.infer<typeof observationSchema>;
  try {
    input = observationSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { success: false, error: 'Invalid observation', details: err instanceof z.ZodError ? err.issues : undefined },
      { status: 400 }
    );
  }
  const set = querySetFor(input.videoId);
  if (!set || !set.queries.some((q) => q.query === input.query)) {
    return NextResponse.json({ success: false, error: 'query is not in this song\'s tracked set' }, { status: 400 });
  }
  await logObservation({ ...input, checkedAt: new Date().toISOString() });
  return NextResponse.json({ success: true });
}
