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
  MAX_UPLOAD_BYTES,
  masteringUploadKey,
} from '@/lib/mastering-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Long enough for a slow uplink to push a few hundred MB.
const UPLOAD_URL_TTL_SECONDS = 60 * 60;

const uploadSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(127),
  size: z.number().int().positive().optional(),
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
  const { filename, contentType, size } = parsed.data;

  // WAV only. Mastering a lossy source just fixes its level while baking the
  // compression artefacts in — the doc is explicit about this, so the API is too.
  if (!(ACCEPTED_UPLOAD_TYPES as readonly string[]).includes(contentType)) {
    return NextResponse.json(
      { success: false, error: 'Upload a WAV. Mastering an MP3 only re-levels a file that has already lost detail.' },
      { status: 400 }
    );
  }
  if (typeof size === 'number' && size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { success: false, error: `File too large — the limit is ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB.` },
      { status: 400 }
    );
  }

  const key = masteringUploadKey(filename, Date.now(), randomUUID().slice(0, 8));

  try {
    // S3 stores exactly this content type, and rejects anything over the cap
    // even if the browser lied about `size` above.
    const { url, fields } = await S3Operations.getSignedUploadPost(
      key,
      'audio/wav',
      MAX_UPLOAD_BYTES,
      UPLOAD_URL_TTL_SECONDS
    );
    return NextResponse.json({ success: true, uploadUrl: url, fields, key });
  } catch (err) {
    console.error('[api/mastering/upload] presign failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not create the upload URL.' }, { status: 502 });
  }
}
