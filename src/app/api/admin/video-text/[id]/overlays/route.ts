/** POST — presigned S3 POSTs for a render's text PNGs, one per block (and one for the logo when it shows). */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { VideoTextRepository } from '@/infrastructure/database/VideoTextRepository';
import { isValidProjectId, overlayKey } from '@/lib/video-text/keys';
import { LOGO_OVERLAY_ID, logoShown } from '@/lib/video-text/logo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPLOAD_URL_TTL_SECONDS = 60 * 60;
const MAX_OVERLAY_BYTES = 5 * 1024 * 1024;
/** The logo's PNG is photographic: a big logo on a 4K frame measured 5.3 MB (2026-11-09). */
const MAX_LOGO_OVERLAY_BYTES = 25 * 1024 * 1024;
const MAX_OVERLAYS = 400;

const schema = z.object({
  renderId: z.string(),
  blockIds: z.array(z.string()).min(1).max(MAX_OVERLAYS),
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
  if (!parsed.success || !isValidProjectId(parsed.data.renderId)) {
    return NextResponse.json({ error: 'Invalid overlay request.' }, { status: 400 });
  }
  const { renderId, blockIds } = parsed.data;

  try {
    // Consistent: this follows the pre-render save (PATCH); a stale read would miss it.
    const project = await new VideoTextRepository().get(id, { consistent: true });
    if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });

    // Only keys for blocks that exist: stops the client presigning arbitrary keys.
    // The logo's PNG too, when this project shows the logo.
    const known = new Set(project.blocks.map((b) => b.id));
    if (logoShown(project.style)) known.add(LOGO_OVERLAY_ID);
    if (!blockIds.every((b) => isValidProjectId(b) && known.has(b))) {
      return NextResponse.json({ error: 'Some text blocks are not in this project — reload and try again.' }, { status: 400 });
    }

    const uploads = await Promise.all(
      blockIds.map(async (blockId) => {
        const key = overlayKey(id, renderId, blockId);
        const { url, fields } = await S3Operations.getSignedUploadPost(
          key,
          'image/png',
          blockId === LOGO_OVERLAY_ID ? MAX_LOGO_OVERLAY_BYTES : MAX_OVERLAY_BYTES,
          UPLOAD_URL_TTL_SECONDS
        );
        return { blockId, url, fields, key };
      })
    );
    return NextResponse.json({ uploads });
  } catch (err) {
    console.error('[api/video-text/overlays] presign failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Could not create the upload URLs.' }, { status: 502 });
  }
}
