/**
 * GET /api/performers/songs/[id] — a single performable song for the portal.
 *
 * Returns the gated lyrics plus a SHORT-LIVED presigned URL for the karaoke
 * backing track (the raw S3 key never reaches the browser). Gated by
 * `requirePerformer`; 404 when the song is missing / unpublished / not
 * performable. force-dynamic — the presigned URL must be freshly minted per
 * request and the read happens at request time.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requirePerformer, authErrorResponse } from '@/lib/auth-helper';
import { getPerformableSong, presignInstrumental, INSTRUMENTAL_URL_TTL_SECONDS } from '@/lib/performer-songs';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePerformer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const { id } = await params;
  if (!id || !/^cnt_[a-z0-9_]+$/i.test(id)) {
    return NextResponse.json({ success: false, error: 'Bad song id' }, { status: 400 });
  }

  try {
    const song = await getPerformableSong(id);
    if (!song) {
      return NextResponse.json({ success: false, error: 'Song not found' }, { status: 404 });
    }
    const instrumentalUrl = await presignInstrumental(song.instrumentalKey);
    return NextResponse.json({
      success: true,
      song: song.toDetailJSON(),
      instrumentalUrl,
      expiresIn: INSTRUMENTAL_URL_TTL_SECONDS,
    });
  } catch (err) {
    console.error(`[GET /api/performers/songs/${id}] failed`, err);
    return NextResponse.json({ success: false, error: 'Failed to load song' }, { status: 500 });
  }
}
