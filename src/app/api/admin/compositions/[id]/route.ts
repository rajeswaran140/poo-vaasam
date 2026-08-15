/**
 * GET    /api/admin/compositions/[id] — full record incl. every version.
 * PUT    /api/admin/compositions/[id] — update the WORKING state only.
 * DELETE /api/admin/compositions/[id] — remove the notebook entry.
 *
 * ⚠️ PUT never touches stored versions (§16). Editing the working spec and
 * snapshotting it are separate acts, so an edit can never overwrite an earlier
 * creative decision.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { CompositionRepository } from '@/infrastructure/database/CompositionRepository';
import { updateCompositionSchema } from '@/types/composition';

export const dynamic = 'force-dynamic';

const validId = (id: string) => /^cmp_[a-z0-9_]+$/i.test(id);

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { id } = await params;
  if (!validId(id)) return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });

  try {
    const data = await new CompositionRepository().findById(id);
    if (!data) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error('[GET /api/admin/compositions/[id]] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to load composition' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { id } = await params;
  if (!validId(id)) return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const parsed = updateCompositionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid update' }, { status: 400 });
  }
  try {
    const data = await new CompositionRepository().update(id, parsed.data);
    return NextResponse.json({ success: true, data });
  } catch (err) {
    if (err instanceof Error && /not found/i.test(err.message)) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    console.error('[PUT /api/admin/compositions/[id]] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to update composition' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { id } = await params;
  if (!validId(id)) return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });

  try {
    await new CompositionRepository().delete(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/admin/compositions/[id]] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to delete composition' }, { status: 500 });
  }
}
