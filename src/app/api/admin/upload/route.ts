/**
 * Admin Media Upload API
 *
 * POST /api/admin/upload — returns a short-lived presigned S3 POST (url +
 * fields) so the browser can upload media directly to S3 (bypassing the
 * serverless request-body size limit). A POST policy carries a
 * `content-length-range` condition, so S3 *enforces* the size cap server-side
 * (a presigned PUT can't — there the cap was only advisory). Objects land under
 * a public-read prefix per the bucket policy and play/display on the site.
 *
 * Supports: audio (songs), images (featured images), and short video previews.
 * Full videos are NOT uploaded — those are linked to YouTube via videoUrl.
 *
 * Admin-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { S3Operations, FILE_CONSTRAINTS, normalizeContentType } from '@/infrastructure/storage/s3-client';

export const dynamic = 'force-dynamic';

// Presigned URLs are short-lived; allow enough time for large (up to ~1GB) uploads.
const UPLOAD_URL_TTL_SECONDS = 60 * 60;

const FOLDER_BY_KIND = {
  audio: 'audio',
  image: 'images',
  video: 'video',
} as const;

const uploadSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(127),
  kind: z.enum(['audio', 'image', 'video']),
  size: z.number().int().positive().optional(),
});

export async function POST(request: NextRequest) {
  // Admin authentication
  let auth;
  try {
    auth = await requireAdmin(request);
    // Defense-in-depth CSRF: reject cookie-only auth on this mutation (matches
    // the pattern on the other admin mutation routes).
    requireBearer(request);
  } catch (authError) {
    return authErrorResponse(authError);
  }

  try {
    const body = await request.json();
    const parsed = uploadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid upload request',
          errors: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { filename, contentType, kind, size } = parsed.data;

    // Validate content type against the allow-list for this media kind.
    const allowedTypes = FILE_CONSTRAINTS.allowedTypes[kind];
    if (!allowedTypes.includes(contentType)) {
      return NextResponse.json(
        {
          success: false,
          error: `Unsupported ${kind} type "${contentType}". Allowed: ${allowedTypes.join(', ')}`,
        },
        { status: 400 }
      );
    }

    // Store the canonical MIME type (e.g. browser-sent audio/mp3 -> audio/mpeg)
    // so every object has a standard Content-Type. The presigned POST below
    // pins this value, so S3 stores exactly this.
    const storedContentType = normalizeContentType(contentType);

    // Enforce the size cap server-side (the browser also checks, but don't trust it).
    const maxSize = FILE_CONSTRAINTS.maxSize[kind];
    if (typeof size === 'number' && size > maxSize) {
      return NextResponse.json(
        {
          success: false,
          error: `File too large. Maximum ${Math.round(maxSize / (1024 * 1024))}MB for ${kind}.`,
        },
        { status: 400 }
      );
    }

    const key = S3Operations.generateFileKey({
      folder: FOLDER_BY_KIND[kind],
      filename,
      userId: auth.userId,
    });

    // Presigned POST with a content-length-range condition — S3 rejects an
    // upload over the cap even if the client lied about `size` above.
    const { url, fields } = await S3Operations.getSignedUploadPost(
      key,
      storedContentType,
      maxSize,
      UPLOAD_URL_TTL_SECONDS
    );
    const publicUrl = S3Operations.getPublicUrl(key);

    return NextResponse.json({
      success: true,
      data: {
        // The browser POSTs multipart/form-data to `uploadUrl` with every entry
        // of `fields` first and the file part LAST. (Public read is granted by
        // path via the bucket policy, so no per-object tagging is needed.)
        uploadUrl: url,
        fields,
        publicUrl,
        key,
      },
    });
  } catch (error) {
    console.error('[API:ADMIN_UPLOAD] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create upload URL' },
      { status: 500 }
    );
  }
}
