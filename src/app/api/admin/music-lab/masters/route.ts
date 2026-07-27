/**
 * GET /api/admin/music-lab/masters — the saved-masters library, newest first.
 *
 * Read-only, so cookie auth is sufficient (no requireBearer — that guards
 * mutations). Returns whole MasterJob records: the library rows show loudness
 * and range, and re-opening one has to drive the same compare player and report
 * as a fresh job, which needs every field.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LIMIT = 200;

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const raw = Number(new URL(request.url).searchParams.get('limit'));
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_LIMIT) : 100;

  try {
    const masters = await new MasterJobRepository().listSaved(limit);
    return NextResponse.json({ success: true, masters, count: masters.length });
  } catch (err) {
    console.error('[api/music-lab/masters] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Failed to list masters' }, { status: 502 });
  }
}
