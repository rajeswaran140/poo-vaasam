/**
 * GET /api/admin/briefs/[id] — fetch one saved brief (Music Director, Phase 2).
 * Admin-gated. 404 if not found.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { BriefRepository } from '@/infrastructure/database/BriefRepository';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const { id } = await params;
  try {
    const repo = new BriefRepository();
    const brief = await repo.findById(id);
    if (!brief) {
      return NextResponse.json({ success: false, error: 'Brief not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: brief });
  } catch (err) {
    console.error('[api/admin/briefs/:id] fetch failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Failed to fetch the brief.' }, { status: 502 });
  }
}
