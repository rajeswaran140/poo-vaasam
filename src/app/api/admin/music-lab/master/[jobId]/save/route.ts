/**
 * POST /api/admin/music-lab/master/[jobId]/save — keep a finished master.
 *
 * Mastering jobs carry a 24h ttl so throwaway experiments clean themselves up.
 * The WAV in S3 was always permanent; what expired was the record that explains
 * it — loudness, range, normalization type, the report, the A/B compare. A day
 * later the file was an orphan with a machine-generated name.
 *
 * Saving records a title and REMOVES the ttl, which is what makes it durable.
 * Deliberately an explicit action rather than automatic on completion: not every
 * master is worth keeping, and auto-keeping everything would silently grow the
 * table with takes nobody wants.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';
import { sanitizeMasterFilename } from '@/lib/mastering-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  title: z.string().trim().max(120).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
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
    return NextResponse.json({ success: false, error: 'Invalid title' }, { status: 400 });
  }

  try {
    const job = await new MasterJobRepository().get(jobId);
    if (!job) return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    // Only a finished master is worth keeping. Saving a processing job would
    // strip the ttl from a record that may never complete, leaking it forever.
    if (job.status !== 'done') {
      return NextResponse.json(
        { success: false, error: `Cannot save a ${job.status} job — only completed masters can be saved` },
        { status: 409 }
      );
    }

    // Reuse the download-name sanitiser so a saved title and the filename it
    // produces can never disagree about what characters are allowed.
    const raw = parsed.data.title?.trim();
    const title = raw ? sanitizeMasterFilename(raw) || null : null;

    await new MasterJobRepository().save(jobId, title);
    return NextResponse.json({ success: true, title });
  } catch (err) {
    console.error('[api/music-lab/master/:jobId/save] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Failed to save master' }, { status: 502 });
  }
}
