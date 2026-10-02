/**
 * PUT /api/admin/music-lab/master/[jobId]/slides — save the slideshow's image
 * list on the master.
 *
 * WHY IT EXISTS. The added images lived only in the open page. A reload — and
 * every deploy asks for one — emptied the list, and each image had to be
 * uploaded again. The files themselves were already safe in the workspace;
 * what was lost was the LIST. This stores it.
 *
 * The list is REPLACED, never merged: the page holds the whole list and sends
 * the whole list, so the stored copy is always exactly what the operator last
 * saw. An empty list clears it.
 *
 * ⚠️ It does not touch `updatedAt`. The YouTube upload guard reads that field
 * to decide whether an upload is still in flight, and editing a list of images
 * must not make a stale upload look fresh.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';
import { isMasteringKey } from '@/lib/mastering-storage';
import { MAX_SLIDESHOW_COVERS } from '@/lib/master-video';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  slides: z
    .array(
      z.object({
        coverKey: z.string().min(1).max(512),
        name: z.string().max(200),
        // Kept as the operator typed it, so a time in progress survives a reload.
        at: z.string().max(16),
        auto: z.boolean(),
      })
    )
    // The cover is image 1 and is not in this list.
    .max(MAX_SLIDESHOW_COVERS - 1),
});

export async function PUT(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const { jobId } = await params;
  if (!jobId) return NextResponse.json({ success: false, error: 'jobId required' }, { status: 400 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: `A slideshow holds the cover and up to ${MAX_SLIDESHOW_COVERS - 1} more images.` },
      { status: 400 }
    );
  }
  // This list is later sent to the worker, whose role can read the whole
  // bucket — so every key is held to the workspace here, at the door.
  if (parsed.data.slides.some((s) => !isMasteringKey(s.coverKey))) {
    return NextResponse.json(
      { success: false, error: 'An image is not in the mastering workspace.' },
      { status: 400 }
    );
  }

  try {
    const repo = new MasterJobRepository();
    const job = await repo.get(jobId);
    if (!job) return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    await repo.setSlides(jobId, parsed.data.slides);
    return NextResponse.json({ success: true, slides: parsed.data.slides });
  } catch (err) {
    console.error(
      '[api/music-lab/master/:jobId/slides] failed:',
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json({ success: false, error: 'Could not save the image list.' }, { status: 502 });
  }
}
