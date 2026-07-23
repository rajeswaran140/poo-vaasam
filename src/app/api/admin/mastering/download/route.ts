/**
 * GET /api/admin/mastering/download?key=... — a short-lived presigned GET so
 * the admin can pull a mastered WAV down for Adobe.
 *
 * The bucket is private (CloudFront + OAC serves only *published* media), and
 * these working files are deliberately not on the CDN, so a presigned S3 GET is
 * the way out. The key is constrained to the mastering prefix: without that
 * check this route would presign ANY object in the bucket for anyone holding an
 * admin session, which is a much wider door than this feature needs.
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

  try {
    const url = await S3Operations.getSignedUrl(key, DOWNLOAD_URL_TTL_SECONDS);
    return NextResponse.json({
      success: true,
      url,
      filename: downloadFilename(key),
      expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
    });
  } catch (err) {
    console.error('[api/mastering/download] presign failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not create the download link.' }, { status: 502 });
  }
}
