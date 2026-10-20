// src/app/api/admin/music-lab/master/[jobId]/marks/[markId]/route.ts
/**
 * PATCH/DELETE one repair mark. PATCH carries the `version` the client last
 * saw; a mismatch is 409 `stale` (another tab saved first) and writes nothing.
 * `fixedIn` may only name a saved master derived from this one.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';
import { MarkRepository, StaleMarkError } from '@/infrastructure/database/MarkRepository';
import { isValidMasterJobId } from '@/lib/stems';
import { parseMarkPatch, masterDurationSec } from '@/lib/repair-marks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ jobId: string; markId: string }> };

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { jobId, markId } = await params;
  if (!isValidMasterJobId(jobId) || !isValidMasterJobId(markId)) {
    return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });
  }
  const body = await request.json().catch(() => null);
  try {
    const jobs = new MasterJobRepository();
    const repo = new MarkRepository();
    const [job, current] = await Promise.all([jobs.get(jobId), repo.get(jobId, markId)]);
    if (!job || !current) return NextResponse.json({ success: false, error: 'No such mark.' }, { status: 404 });
    const parsed = parseMarkPatch(body, current, masterDurationSec(job));
    if (!parsed.ok) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
    if (parsed.patch.fixedIn) {
      const child = await jobs.get(parsed.patch.fixedIn);
      if (!child?.savedAt || child.derivedFrom?.jobId !== jobId) {
        return NextResponse.json(
          { success: false, code: 'bad-fixed-in', error: 'A fix can only be credited to a saved version made from this master.' },
          { status: 400 }
        );
      }
    }
    const mark = await repo.update(jobId, markId, parsed.version, parsed.patch);
    return NextResponse.json({ success: true, mark });
  } catch (err) {
    if (err instanceof StaleMarkError || (err as { name?: string })?.name === 'StaleMarkError') {
      return NextResponse.json(
        { success: false, code: 'stale', error: 'Changed in another tab — reload to see it.' },
        { status: 409 }
      );
    }
    console.error('[api/marks] update failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not save the mark.' }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { jobId, markId } = await params;
  if (!isValidMasterJobId(jobId) || !isValidMasterJobId(markId)) {
    return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });
  }
  try {
    const repo = new MarkRepository();
    if (!(await repo.get(jobId, markId))) {
      return NextResponse.json({ success: false, error: 'No such mark.' }, { status: 404 });
    }
    await repo.delete(jobId, markId);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/marks] delete failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not delete the mark.' }, { status: 502 });
  }
}
