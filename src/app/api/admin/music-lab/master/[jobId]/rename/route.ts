/**
 * PATCH /api/admin/music-lab/master/[jobId]/rename — rename a saved master.
 *
 * Separate from `save` on purpose. `save` records a title AND re-stamps
 * `savedAt` (that timestamp is what makes the record durable), so reusing it to
 * fix a typo would silently move the library's "saved on" date. This touches
 * the title alone.
 *
 * The title is sanitised with `sanitizeMasterTitle`, NOT the filename
 * sanitiser: that one appends ".wav" and falls back to "master", which is how
 * every saved master ended up named like a file. The download filename is
 * derived from the title at download time, so the extension never needs
 * storing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';
import { sanitizeMasterTitle } from '@/lib/mastering-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  title: z.string().trim().max(120),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    await requireAdmin(request);
    // Mutation — reject cookie-only auth, matching the other admin writes.
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

  // A TITLE sanitiser, not the filename one — see sanitizeMasterTitle. Using
  // the filename sanitiser here is what put ".wav" into every library name.
  const cleaned = sanitizeMasterTitle(parsed.data.title);
  if (!cleaned) {
    return NextResponse.json(
      { success: false, error: 'That name has no usable characters.' },
      { status: 400 }
    );
  }

  try {
    const repo = new MasterJobRepository();
    const job = await repo.get(jobId);
    if (!job) return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    // Renaming an UNSAVED job would leave a 24h-expiring record wearing a
    // permanent-looking name. Refusing is the honest outcome.
    if (!job.savedAt) {
      return NextResponse.json(
        { success: false, error: 'Only a saved master can be renamed — save it to the library first.' },
        { status: 409 }
      );
    }

    await repo.rename(jobId, cleaned);
    return NextResponse.json({ success: true, title: cleaned });
  } catch (err) {
    console.error(
      '[api/music-lab/master/:jobId/rename] failed:',
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json({ success: false, error: 'Failed to rename master' }, { status: 502 });
  }
}
