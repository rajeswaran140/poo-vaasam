/**
 * GET /api/performers/songs/[id]/track — the gated karaoke backing track.
 *
 * Streams the instrumental MP3 straight from S3 behind `requirePerformer`. This
 * route IS the gate: unlike a presigned/CDN URL (the media bucket sits behind a
 * public CloudFront distribution, so any URL into it is effectively public once
 * the key leaks), the bytes here only flow to an authenticated performer and the
 * S3 object has no publicly fetchable address. The <audio> element reaches this
 * same-origin URL with the Cognito session cookie, which validateAuth accepts.
 *
 * Range is forwarded to S3 so the browser can seek (206 Partial Content).
 */

import { NextRequest } from 'next/server';
import { requirePerformer, authErrorResponse } from '@/lib/auth-helper';
import { getPerformableSong, streamInstrumental } from '@/lib/performer-songs';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePerformer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const { id } = await params;
  if (!id || !/^cnt_[a-z0-9_]+$/i.test(id)) {
    return new Response(JSON.stringify({ success: false, error: 'Bad song id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const song = await getPerformableSong(id);
  if (!song) {
    return new Response(JSON.stringify({ success: false, error: 'Song not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const range = request.headers.get('range') ?? undefined;
    const s = await streamInstrumental(song.instrumentalKey, range);
    const headers = new Headers();
    headers.set('Content-Type', s.contentType);
    headers.set('Accept-Ranges', 'bytes');
    // Private to this performer — never cache in shared/CDN caches.
    headers.set('Cache-Control', 'private, no-store');
    if (s.contentLength !== undefined) headers.set('Content-Length', String(s.contentLength));
    if (s.contentRange) headers.set('Content-Range', s.contentRange);
    return new Response(s.body, { status: s.statusCode, headers });
  } catch (err) {
    if ((err as { name?: string }).name === 'NoSuchKey') {
      return new Response(JSON.stringify({ success: false, error: 'Track not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    console.error(`[GET /api/performers/songs/${id}/track] failed`, err);
    return new Response(JSON.stringify({ success: false, error: 'Failed to stream track' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
