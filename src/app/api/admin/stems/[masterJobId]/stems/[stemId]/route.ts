/**
 * PATCH /api/admin/stems/[masterJobId]/stems/[stemId] — rename a stem.
 * DELETE /api/admin/stems/[masterJobId]/stems/[stemId] — remove a stem.
 *
 * `stemId` comes straight off the URL, so it is checked against a plain
 * token shape before it ever reaches a DynamoDB expression attribute name —
 * same reasoning as every other path segment in this module, just applied
 * to a map key instead of an S3 key.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { StemSetRepository } from '@/infrastructure/database/StemSetRepository';
import { isValidMasterJobId } from '@/lib/stems';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STEM_ID_RE = /^[A-Za-z0-9_-]{1,120}$/;

function badIds(masterJobId: string, stemId: string) {
  if (!isValidMasterJobId(masterJobId)) return { success: false as const, error: 'Bad id' };
  if (!STEM_ID_RE.test(stemId)) return { success: false as const, error: 'Bad stem id' };
  return null;
}

const patchSchema = z.object({ name: z.string().min(1).max(80) });

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ masterJobId: string; stemId: string }> }
) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const { masterJobId, stemId } = await params;
  const bad = badIds(masterJobId, stemId);
  if (bad) return NextResponse.json(bad, { status: 400 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'name is required.' }, { status: 400 });
  }

  try {
    await new StemSetRepository().renameStem(masterJobId, stemId, parsed.data.name);
    return NextResponse.json({ success: true });
  } catch (err) {
    if ((err as { code?: string }).code === 'ConditionalCheckFailedException') {
      return NextResponse.json(
        { success: false, error: 'That stem is no longer in the set.' },
        { status: 404 }
      );
    }
    console.error('[api/admin/stems] rename failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not rename the stem.' }, { status: 502 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ masterJobId: string; stemId: string }> }
) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const { masterJobId, stemId } = await params;
  const bad = badIds(masterJobId, stemId);
  if (bad) return NextResponse.json(bad, { status: 400 });

  try {
    // removeStem is itself idempotent — a stem that's already gone just
    // returns, no error. A ConditionalCheckFailedException here means its
    // own retry loop lost a race three times running, not that the stem
    // is gone, so (unlike PATCH) that is not a 404.
    await new StemSetRepository().removeStem(masterJobId, stemId);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/admin/stems] remove failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not remove the stem.' }, { status: 502 });
  }
}
