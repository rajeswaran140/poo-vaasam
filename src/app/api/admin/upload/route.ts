/**
 * Admin Media Upload API
 *
 * POST /api/admin/upload — returns a short-lived presigned S3 PUT URL so the
 * browser can upload media directly to S3 (bypassing the serverless
 * request-body size limit). The object is tagged `public=true` so it is
 * publicly readable per the bucket policy and can be played/displayed on the
 * public site.
 *
 * Supports: audio (songs), images (featured images), and short video previews.
 * Full videos are NOT uploaded — those are linked to YouTube via videoUrl.
 *
 * Admin-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { S3Operations, FILE_CONSTRAINTS } from '@/infrastructure/storage/s3-client';

export const dynamic = 'force-dynamic';

// Bucket policy grants public read only to objects carrying this tag.
const PUBLIC_TAG = 'public=true';
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

    const uploadUrl = await S3Operations.getSignedUploadUrl(
      key,
      contentType,
      UPLOAD_URL_TTL_SECONDS,
      { tagging: PUBLIC_TAG }
    );
    const publicUrl = S3Operations.getPublicUrl(key);

    return NextResponse.json({
      success: true,
      data: {
        uploadUrl,
        publicUrl,
        key,
        // The browser must send exactly these headers on the PUT, or the
        // presigned signature (which covers them) will be rejected by S3.
        headers: {
          'Content-Type': contentType,
          'x-amz-tagging': PUBLIC_TAG,
        },
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
