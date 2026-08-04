/**
 * POST /api/admin/mastering/upload — presigned S3 POST so the browser can put a
 * SUNO WAV straight into the mastering workspace, bypassing the serverless
 * request-body limit (sources run to hundreds of MB).
 *
 * A presigned POST (not PUT) is used deliberately: its policy carries a
 * `content-length-range` condition, so S3 itself rejects an oversized upload —
 * with a PUT the cap would only be advisory. Content type is pinned too.
 *
 * Uploads land under `audio/mastering/`, the same bucket the master-worker
 * Lambda reads (`TAKES_BUCKET=tamil-web-media`), which is what lets the job run
 * against the object without any copy step. Admin-gated.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import {
  ACCEPTED_UPLOAD_TYPES,
  ACCEPTED_COVER_TYPES,
  MAX_UPLOAD_BYTES,
  MAX_COVER_BYTES,
  masteringUploadKey,
  masteringCoverKey,
} from '@/lib/mastering-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Long enough for a slow uplink to push a few hundred MB.
const UPLOAD_URL_TTL_SECONDS = 60 * 60;

const uploadSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(127),
  size: z.number().int().positive().optional(),
  /**
   * `cover` uploads the still image the YouTube render is built from. Same
   * workspace, same guards, different allow-list and a much smaller cap — an
   * image has no business being 500 MB.
   */
  kind: z.enum(['audio', 'cover']).optional(),
});

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    // Defence-in-depth CSRF: reject cookie-only auth on a mutation, matching the
    // other admin mutation routes.
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const body = await request.json().catch(() => null);
  const parsed = uploadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Invalid upload request', errors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const { filename, contentType, size, kind } = parsed.data;
  const isCover = kind === 'cover';

  const allowed = isCover ? ACCEPTED_COVER_TYPES : ACCEPTED_UPLOAD_TYPES;
  if (!(allowed as readonly string[]).includes(contentType)) {
    // WAV only for audio. Mastering a lossy source just fixes its level while
    // baking the compression artefacts in — the doc is explicit about this, so
    // the API is too.
    return NextResponse.json(
      {
        success: false,
        error: isCover
          ? 'Upload a JPEG, PNG or WebP cover.'
          : 'Upload a WAV. Mastering an MP3 only re-levels a file that has already lost detail.',
      },
      { status: 400 }
    );
  }
  const cap = isCover ? MAX_COVER_BYTES : MAX_UPLOAD_BYTES;
  if (typeof size === 'number' && size > cap) {
    return NextResponse.json(
      { success: false, error: `File too large — the limit is ${Math.round(cap / (1024 * 1024))}MB.` },
      { status: 400 }
    );
  }

  const nonce = randomUUID().slice(0, 8);
  const key = isCover
    ? masteringCoverKey(filename, contentType, Date.now(), nonce)
    : masteringUploadKey(filename, Date.now(), nonce);
  if (!key) {
    return NextResponse.json({ success: false, error: 'Unsupported cover type.' }, { status: 400 });
  }

  try {
    // S3 stores exactly this content type, and rejects anything over the cap
    // even if the browser lied about `size` above.
    // S3 stores exactly this content type and enforces the cap in its own
    // policy, so a browser lying about `size` above still cannot exceed it.
    const { url, fields } = await S3Operations.getSignedUploadPost(
      key,
      isCover ? contentType : 'audio/wav',
      cap,
      UPLOAD_URL_TTL_SECONDS
    );
    return NextResponse.json({ success: true, uploadUrl: url, fields, key });
  } catch (err) {
    console.error('[api/mastering/upload] presign failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not create the upload URL.' }, { status: 502 });
  }
}
