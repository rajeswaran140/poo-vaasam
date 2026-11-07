/** GET — a 15-minute presigned download link for the finished render. */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { VideoTextRepository } from '@/infrastructure/database/VideoTextRepository';
import { isValidProjectId, isVideoTextKeyFor } from '@/lib/video-text/keys';
import { sanitizeMasterFilename } from '@/lib/mastering-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DOWNLOAD_URL_TTL_SECONDS = 15 * 60;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { id } = await params;
  if (!isValidProjectId(id)) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });

  try {
    const project = await new VideoTextRepository().get(id);
    if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    const key = project.render.outputKey;
    if (project.render.status !== 'done' || !key || !isVideoTextKeyFor(id, key)) {
      return NextResponse.json({ error: 'There is no finished video to download yet.' }, { status: 404 });
    }
    if (project.render.outputExpiresAt && new Date(project.render.outputExpiresAt).getTime() <= Date.now()) {
      return NextResponse.json({ error: 'That video was deleted after 30 days — render it again.' }, { status: 410 });
    }
    const filename = `${sanitizeMasterFilename(project.name, '').trim() || 'video'}-text.mp4`;
    const url = await S3Operations.getSignedUrl(key, DOWNLOAD_URL_TTL_SECONDS, filename);
    return NextResponse.json({ url });
  } catch (err) {
    console.error('[api/video-text/download] presign failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Could not create the download link.' }, { status: 502 });
  }
}
