/**
 * GET /api/admin/captions — songs that are candidates for lyric captions.
 *
 * Deliberately makes NO YouTube calls. `captions.list` costs 50 quota units per
 * video, so checking caption state for the whole catalogue on every page load
 * would burn ~2,750 of the 10,000/day budget just to render a list. Track state
 * is fetched per song, on demand, by the preview route.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { listRawSongs } from '@/lib/lyrics-content';
import { splitLyricsIntoCards } from '@/lib/caption-alignment';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  try {
    const songs = await listRawSongs();
    const rows = songs
      .map((s) => {
        const body = s.body ?? '';
        return {
          id: s.id,
          title: s.title,
          youtubeVideoId: s.youtubeVideoId ?? null,
          hasBody: body.trim().length > 0,
          cardCount: body.trim() ? splitLyricsIntoCards(body).length : 0,
        };
      })
      .sort((a, b) => Number(b.hasBody) - Number(a.hasBody) || a.title.localeCompare(b.title));
    return NextResponse.json({
      success: true,
      songs: rows,
      ready: rows.filter((r) => r.hasBody && r.youtubeVideoId).length,
    });
  } catch (err) {
    console.error('[captions] list failed:', err);
    return NextResponse.json({ success: false, error: 'Failed to load songs' }, { status: 500 });
  }
}
