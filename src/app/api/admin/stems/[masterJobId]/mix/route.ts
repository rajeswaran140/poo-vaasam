/**
 * PUT /api/admin/stems/[masterJobId]/mix — save the mixer's fader levels and
 * mutes for a saved master's stem set.
 *
 * The body may carry ids for stems that aren't (or are no longer) in the
 * set — the mixer UI's local state can lag a stem's removal by one render.
 * Those are dropped here before the write: `saveMix` replaces the whole
 * `#mix` map, so letting a stale id through would resurrect a mix entry for
 * a stem that no longer exists. `gainDb` is clamped to the fader range for
 * the same reason the planner clamps it — a crafted value outside
 * [MIN_GAIN_DB, MAX_GAIN_DB] must never reach a render.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';
import { StemSetRepository } from '@/infrastructure/database/StemSetRepository';
import { isValidMasterJobId, MIN_GAIN_DB, MAX_GAIN_DB } from '@/lib/stems';
import type { StemMixEntry } from '@/types/stemSet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function savedMaster(masterJobId: string) {
  const job = await new MasterJobRepository().get(masterJobId);
  return job && job.savedAt ? job : null;
}

const mixSchema = z.object({
  mix: z.record(
    z.string().regex(/^[A-Za-z0-9_-]{1,120}$/),
    z.object({ gainDb: z.number().finite(), muted: z.boolean() })
  ),
});

const clamp = (n: number) => Math.min(MAX_GAIN_DB, Math.max(MIN_GAIN_DB, n));

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ masterJobId: string }> }
) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const { masterJobId } = await params;
  if (!isValidMasterJobId(masterJobId)) {
    return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });
  }

  const parsed = mixSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'mix is required.' }, { status: 400 });
  }

  try {
    const job = await savedMaster(masterJobId);
    if (!job) {
      return NextResponse.json(
        { success: false, error: 'No saved master with that id.' },
        { status: 404 }
      );
    }

    const repo = new StemSetRepository();
    const set = await repo.get(masterJobId);
    if (!set) {
      // Nothing to save against: an UpdateItem here would create a bare
      // STEMSET# row with only #mix and #updatedAt — no order, stems,
      // masterJobId or Type — breaking the GET route's "set is null until
      // stems exist" contract.
      return NextResponse.json({ success: false, error: 'No stems to mix yet.' }, { status: 409 });
    }
    const validIds = new Set(set.order);
    const mix: Record<string, StemMixEntry> = {};
    for (const [id, entry] of Object.entries(parsed.data.mix)) {
      if (!validIds.has(id)) continue;
      mix[id] = { gainDb: clamp(entry.gainDb), muted: entry.muted };
    }

    await repo.saveMix(masterJobId, mix);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/admin/stems] save mix failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not save the mix.' }, { status: 502 });
  }
}
