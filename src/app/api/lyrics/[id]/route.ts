/**
 * Gated lyrics read API.
 *
 * GET /api/lyrics/[id] — returns a song's lyrics ONLY when the request carries a
 * valid signed gate cookie (set by POST /api/lyrics/unlock after the fan gives
 * their email). This is the server-side enforcement: lyrics are never returned
 * without a valid gate cookie. Even with the gate, lyrics are only served for a
 * PUBLISHED song that an admin has flipped `showLyrics` on and that has a body.
 */

import { NextRequest, NextResponse } from 'next/server';
import { LYRICS_GATE_COOKIE, verifyGateToken } from '@/lib/lyrics-gate';
import { getRawSongById, lyricsVisible } from '@/lib/lyrics-content';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Gate check FIRST — never touch the DB (or leak existence) for a locked request.
  const token = request.cookies.get(LYRICS_GATE_COOKIE)?.value;
  if (!verifyGateToken(token)) {
    return NextResponse.json({ success: false, error: 'locked' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const song = await getRawSongById(id);
    if (!lyricsVisible(song)) {
      return NextResponse.json({ success: false, error: 'not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      lyrics: {
        id: song!.id,
        title: song!.title,
        body: song!.body,
        titleSlug: song!.titleSlug,
        featuredImage: song!.featuredImage,
      },
    });
  } catch (error) {
    console.error('[API:LYRICS_GET] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Could not load lyrics.' },
      { status: 500 }
    );
  }
}
