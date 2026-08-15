/**
 * POST /api/admin/compositions/[id]/versions — snapshot the current spec.
 *
 * A version is a deliberate act, which is why it is its own endpoint rather
 * than a flag on PUT: autosaving the working state must never silently create
 * versions, and creating a version must never be a side effect of typing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { CompositionRepository } from '@/infrastructure/database/CompositionRepository';
import { addCompositionVersionSchema } from '@/types/composition';

export const dynamic = 'force-dynamic';

const validId = (id: string) => /^cmp_[a-z0-9_]+$/i.test(id);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { id } = await params;
  if (!validId(id)) return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const parsed = addCompositionVersionSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid version' }, { status: 400 });
  }
  try {
    const data = await new CompositionRepository().addVersion(id, parsed.data);
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && /not found/i.test(err.message)) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    console.error('[POST /api/admin/compositions/[id]/versions] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to save version' }, { status: 500 });
  }
}
