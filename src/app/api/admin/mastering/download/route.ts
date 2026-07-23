/**
 * GET /api/admin/mastering/download?key=...[&mode=play] — a short-lived
 * presigned GET for a workspace WAV.
 *
 * Two modes:
 *  - default (download): Content-Disposition: attachment, so the browser saves
 *    the mastered WAV for Adobe rather than playing it inline. Short TTL.
 *  - `mode=play`: no attachment, so an <audio> element can stream it for the
 *    before/after comparison. Longer TTL, because seeking a 7-minute WAV issues
 *    range requests minutes after the URL was minted, and a SigV4 URL that has
 *    expired would 403 the seek mid-listen.
 *
 * The bucket is private (no direct S3 GET), so a presigned S3 GET is the way
 * out. NB: CloudFront fronts the whole bucket by default, so `audio/mastering/*`
 * is kept off the public CDN by an explicit bucket-policy Deny on the CloudFront
 * principal (Sid DenyCloudFrontOnMasteringWorkspace) — not by the prefix being
 * absent from the CDN. The key is constrained to the mastering prefix: without
 * that check this route would presign ANY object in the bucket for anyone
 * holding an admin session, which is a much wider door than this feature needs.
 *
 * Returns a URL rather than proxying the bytes — a 60 MB WAV through the SSR
 * Lambda would be slow and would burn the response-size ceiling.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { isMasteringKey, downloadFilename } from '@/lib/mastering-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Just long enough to click through to a download.
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;
// Long enough to audition a full song and seek around it well after minting.
const PLAY_URL_TTL_SECONDS = 60 * 60;

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const key = request.nextUrl.searchParams.get('key') ?? '';
  if (!isMasteringKey(key)) {
    return NextResponse.json(
      { success: false, error: 'That key is not in the mastering workspace.' },
      { status: 400 }
    );
  }
  const play = request.nextUrl.searchParams.get('mode') === 'play';

  try {
    const filename = downloadFilename(key);
    const ttl = play ? PLAY_URL_TTL_SECONDS : DOWNLOAD_URL_TTL_SECONDS;
    // Attachment only for download; play mode leaves the audio/wav type intact
    // so <audio> streams it. See getSignedUrl's `downloadAs`.
    const url = await S3Operations.getSignedUrl(key, ttl, play ? undefined : filename);
    return NextResponse.json({
      success: true,
      url,
      filename,
      expiresInSeconds: ttl,
    });
  } catch (err) {
    console.error('[api/mastering/download] presign failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not create the download link.' }, { status: 502 });
  }
}
