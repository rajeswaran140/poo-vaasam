// src/app/api/admin/music-lab/master/[jobId]/marks/route.ts
/**
 * GET/POST /api/admin/music-lab/master/[jobId]/marks — a saved master's
 * repair marks. Marks belong to ONE version (this master); see the 2026-10-20
 * repair-marks spec. Unsaved jobs expire after 24h, so they take no marks.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';
import { MarkRepository } from '@/infrastructure/database/MarkRepository';
import { isValidMasterJobId } from '@/lib/stems';
import { parseNewMark, masterDurationSec, MAX_MARKS_PER_MASTER } from '@/lib/repair-marks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ jobId: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { jobId } = await params;
  if (!isValidMasterJobId(jobId)) return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });
  try {
    const job = await new MasterJobRepository().get(jobId);
    if (!job) return NextResponse.json({ success: false, error: 'No master with that id.' }, { status: 404 });
    const marks = await new MarkRepository().list(jobId);
    return NextResponse.json({ success: true, marks });
  } catch (err) {
    console.error('[api/marks] list failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not load the marks.' }, { status: 502 });
  }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { jobId } = await params;
  if (!isValidMasterJobId(jobId)) return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });
  const body = await request.json().catch(() => null);
  try {
    const job = await new MasterJobRepository().get(jobId);
    if (!job) return NextResponse.json({ success: false, error: 'No master with that id.' }, { status: 404 });
    if (!job.savedAt) {
      return NextResponse.json(
        { success: false, code: 'not-saved', error: 'Save this master before marking it.' },
        { status: 409 }
      );
    }
    const parsed = parseNewMark(body, masterDurationSec(job));
    if (!parsed.ok) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
    const repo = new MarkRepository();
    // A soft cap: two creates racing at 499 can land 501. The limit exists to
    // stop a runaway, not to be exact.
    if ((await repo.list(jobId)).length >= MAX_MARKS_PER_MASTER) {
      return NextResponse.json(
        { success: false, code: 'too-many', error: `A master holds at most ${MAX_MARKS_PER_MASTER} marks.` },
        { status: 409 }
      );
    }
    const mark = await repo.create(jobId, parsed.value);
    return NextResponse.json({ success: true, mark }, { status: 201 });
  } catch (err) {
    console.error('[api/marks] create failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not save the mark.' }, { status: 502 });
  }
}
