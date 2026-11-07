/** POST — presigned S3 POST for the source video (size-capped, type-pinned). */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { VideoTextRepository } from '@/infrastructure/database/VideoTextRepository';
import { MAX_VIDEO_TEXT_BYTES, isValidProjectId, sourceKey } from '@/lib/video-text/keys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPLOAD_URL_TTL_SECONDS = 60 * 60;
const ACCEPTED = ['video/mp4', 'video/quicktime'];

const schema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(127),
  size: z.number().int().positive(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { id } = await params;
  if (!isValidProjectId(id)) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid upload request.' }, { status: 400 });
  const { filename, contentType, size } = parsed.data;

  if (!ACCEPTED.includes(contentType)) {
    return NextResponse.json({ error: 'Upload an MP4 or MOV video.' }, { status: 400 });
  }
  if (size > MAX_VIDEO_TEXT_BYTES) {
    return NextResponse.json({ error: 'Videos up to 1 GB can be used.' }, { status: 400 });
  }

  const key = sourceKey(id, filename, contentType, Date.now(), randomUUID().slice(0, 8));
  try {
    // No upload URL for a project that does not exist (it would only leave an orphan file).
    if (!(await new VideoTextRepository().get(id))) {
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    }
    const { url, fields } = await S3Operations.getSignedUploadPost(
      key,
      contentType,
      MAX_VIDEO_TEXT_BYTES,
      UPLOAD_URL_TTL_SECONDS
    );
    return NextResponse.json({ url, fields, key });
  } catch (err) {
    console.error('[api/video-text/upload] presign failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Could not create the upload URL.' }, { status: 502 });
  }
}
