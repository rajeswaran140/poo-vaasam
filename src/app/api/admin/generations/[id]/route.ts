/**
 * DELETE /api/admin/generations/[id]?briefId=… — remove a logged generation.
 * Admin-gated. The briefId query param is required because it addresses the
 * single-table key (BRIEF#<briefId>/GEN#<id>).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { GenerationRepository } from '@/infrastructure/database/GenerationRepository';

export const dynamic = 'force-dynamic';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const { id } = await params;
  const briefId = request.nextUrl.searchParams.get('briefId');
  if (!briefId) {
    return NextResponse.json({ success: false, error: 'briefId query param is required' }, { status: 400 });
  }

  try {
    await new GenerationRepository().delete(briefId, id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/admin/generations/:id] delete failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Failed to delete the generation.' }, { status: 502 });
  }
}
