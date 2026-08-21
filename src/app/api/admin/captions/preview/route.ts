/**
 * POST /api/admin/captions/preview { id }
 *
 * Times a song's stored lyrics against its own auto-caption track and returns
 * the result for inspection. READ-ONLY — it never writes a caption. Publishing
 * is a separate, deliberate step, because a mis-timed track has already shipped
 * on this channel once (all 20 cues inside the first 80 seconds of a 6:24 song)
 * and the whole point of this screen is to see the timings before that happens.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { getRawSongById } from '@/lib/lyrics-content';
import { alignLyrics, parseSrtCues, splitLyricsIntoCards, verifyRoundTrip } from '@/lib/caption-alignment';

export const dynamic = 'force-dynamic';

const Body = z.object({ id: z.string().min(1) });

/** force-ssl access token. The analytics refresh token CANNOT read captions. */
async function writeToken(): Promise<string | null> {
  const id = process.env.YOUTUBE_OAUTH_CLIENT_ID;
  const secret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
  const refresh = process.env.YOUTUBE_DATA_REFRESH_TOKEN;
  if (!id || !secret || !refresh) return null;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }),
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return ((await res.json()) as { access_token?: string }).access_token ?? null;
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
  }

  const song = await getRawSongById(parsed.data.id);
  if (!song) return NextResponse.json({ success: false, error: 'Song not found' }, { status: 404 });
  if (!song.youtubeVideoId) {
    return NextResponse.json({ success: false, error: 'This song has no linked YouTube video' }, { status: 422 });
  }
  const cards = splitLyricsIntoCards(song.body ?? '');
  if (!cards.length) {
    return NextResponse.json({ success: false, error: 'No lyrics stored for this song yet' }, { status: 422 });
  }

  const token = await writeToken();
  if (!token) {
    return NextResponse.json(
      { success: false, error: 'YOUTUBE_DATA_REFRESH_TOKEN is not configured — captions need the force-ssl scope' },
      { status: 503 }
    );
  }
  const auth = { Authorization: `Bearer ${token}` };

  const listRes = await fetch(
    `https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${encodeURIComponent(song.youtubeVideoId)}`,
    { headers: auth, cache: 'no-store' }
  );
  if (!listRes.ok) {
    return NextResponse.json({ success: false, error: `captions.list failed (${listRes.status})` }, { status: 502 });
  }
  const tracks = ((await listRes.json()) as {
    items?: { id: string; snippet: { trackKind: string; language: string; isDraft?: boolean } }[];
  }).items ?? [];

  const asr = tracks.find((t) => t.snippet.trackKind === 'asr');
  if (!asr) {
    return NextResponse.json({
      success: false,
      error:
        'No auto-caption track on this video, so there is no clock to align against. YouTube regenerates one within about a day on videos with no serving captions.',
      tracks: tracks.map((t) => ({ kind: t.snippet.trackKind, language: t.snippet.language, isDraft: !!t.snippet.isDraft })),
    }, { status: 409 });
  }

  const srtRes = await fetch(`https://www.googleapis.com/youtube/v3/captions/${asr.id}?tfmt=srt`, { headers: auth, cache: 'no-store' });
  if (!srtRes.ok) {
    return NextResponse.json({ success: false, error: `caption download failed (${srtRes.status})` }, { status: 502 });
  }
  const asrCues = parseSrtCues(await srtRes.text());
  const result = alignLyrics(cards, asrCues);
  const textPreserved = verifyRoundTrip(result.cues, cards);

  return NextResponse.json({
    success: true,
    videoId: song.youtubeVideoId,
    title: song.title,
    asrCueCount: asrCues.length,
    totalLines: cards.flat().length,
    anchoredLines: result.anchoredLines,
    interpolatedLines: result.interpolatedLines,
    // If this is ever false the caller must refuse to publish: it means the
    // emitted text is no longer character-for-character what Raj wrote.
    textPreserved,
    warnings: result.warnings,
    cues: result.cues,
  });
}
