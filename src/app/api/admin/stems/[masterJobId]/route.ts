/**
 * GET /api/admin/stems/[masterJobId] — a saved master's stem set, if any.
 *
 * `set` is null (not 404) when the master is saved but has no stems yet —
 * only a missing or unsaved master is a 404. The guard here (and repeated in
 * the sibling route files, deliberately not shared via import — see the
 * implementer brief) is: admin-only, then a valid id, then a saved master.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';
import { StemSetRepository } from '@/infrastructure/database/StemSetRepository';
import { isValidMasterJobId } from '@/lib/stems';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function savedMaster(masterJobId: string) {
  const job = await new MasterJobRepository().get(masterJobId);
  return job && job.savedAt ? job : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ masterJobId: string }> }
) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const { masterJobId } = await params;
  if (!isValidMasterJobId(masterJobId)) {
    return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });
  }

  try {
    const job = await savedMaster(masterJobId);
    if (!job) {
      return NextResponse.json(
        { success: false, error: 'No saved master with that id.' },
        { status: 404 }
      );
    }
    const set = await new StemSetRepository().get(masterJobId);
    return NextResponse.json({
      success: true,
      set,
      master: { id: job.id, title: job.title ?? null, target: job.target },
    });
  } catch (err) {
    console.error('[api/admin/stems] read failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not load the stems.' }, { status: 502 });
  }
}
